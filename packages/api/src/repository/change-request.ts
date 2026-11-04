import { randomUUID } from "node:crypto";

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  Actor,
  ApplyOutcome,
  ChangeRequest,
  ChangeRequestKind,
  ChangeRequestStatus,
  LocalizedMessage,
  RoleLock,
} from "@rolust/core";
import { localized } from "@rolust/core";

import { loadConfig } from "../config.js";
import { ConflictError, NotFoundError, awsErrorDetail, carriedLocalized } from "../errors.js";
import {
  batchGetAll,
  getDocumentClient,
  isConditionalCheckFailed,
  queryAllWith,
  withStorageErrors,
} from "../ddb/client.js";
import type { BaseItem } from "../ddb/keys.js";
import {
  CHANGE_REQUESTS_PK,
  CHANGE_REQUEST_SK_PREFIX,
  changeRequestKey,
  roleLockKey,
} from "../ddb/keys.js";

/**
 * ChangeRequest のリポジトリ（FR-4.4〜FR-4.8 / FR-5.5 / FR-5.6）。
 *
 * FR-4.6（1 IamRole につき未反映の申請は同時に 1 件まで）は、
 * `ROLELOCK#<roleArn>` アイテムを `attribute_not_exists(pk)` 条件付きで作ることで
 * **原子的に**担保する。詳細は `packages/api/TABLE-DESIGN.md`。
 */

interface ChangeRequestItem extends BaseItem {
  itemType: "ChangeRequest";
  changeRequestId: string;
  poolId: string;
  roleArn: string;
  addUserArns: string[];
  removeUserArns: string[];
  status: ChangeRequestStatus;
  createdAt: string;
  /** #120 より前のアイテムは持たない。 */
  createdBy?: Actor | null;
  appliedAt: string | null;
  /** #120 より前のアイテムは持たない。 */
  appliedBy?: Actor | null;
  result: ApplyOutcome | null;
  /** 乖離を直す申請の種別（Issue #172）。通常の申請と、#172 より前のアイテムは持たない。 */
  kind?: ChangeRequestKind;
  /** 反映の claim（Issue #121）。API の応答には出さない。反映中だけ持つ。 */
  applyingToken?: string;
  applyingUntil?: string;
}

export type { RoleLock };

interface RoleLockItem extends BaseItem {
  itemType: "RoleLock";
  roleArn: string;
  changeRequestId: string;
  status: ChangeRequestStatus;
  createdAt: string;
}

/** ロック取得の結果。競合したら既存のロックを返す（既存申請は破棄しない — FR-4.6）。 */
export type LockResult =
  | { acquired: true }
  | { acquired: false; existing: RoleLock | null };

/**
 * FR-4.6 のロールロックを取得する。
 *
 * 既に未反映の申請があれば `acquired: false` と既存ロックを返す。
 * 呼び出し側は当該ロールを作成対象から除外し、除外した旨を警告する。
 */
export async function acquireRoleLock(
  roleArn: string,
  changeRequestId: string,
  status: ChangeRequestStatus,
  now: string,
): Promise<LockResult> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const item: RoleLockItem = {
    ...roleLockKey(roleArn),
    itemType: "RoleLock",
    roleArn,
    changeRequestId,
    status,
    createdAt: now,
  };

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return { acquired: true };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { acquired: false, existing: await getRoleLock(roleArn) };
    }
    return await withStorageErrors("PutItem(RoleLock)", () => Promise.reject(error));
  }
}

/**
 * ロックを解放する。**この module の外へは公開しない。**
 *
 * 自分の申請 ID を条件に付ける。付けないと、解放しようとした申請より新しい
 * ロックを誤って消し、FR-4.6 の「1 件まで」が破れる。
 *
 * 非公開なのは意図的である。この関数は条件不一致以外の DynamoDB 障害で
 * `StorageError` を**投げる**。状態を確定させた後に呼ぶ経路（反映成功後・破棄後）で
 * 直接使うと B-1 が再発するため、外部には投げない `tryReleaseRoleLock` だけを
 * 公開し、危険な呼び方をコンパイル時に不可能にしている。
 *
 * @returns 実際に解放したか（既に別の申請がロックを持っていれば false）
 */
async function releaseRoleLock(
  roleArn: string,
  changeRequestId: string,
): Promise<boolean> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: roleLockKey(roleArn),
        ConditionExpression: "changeRequestId = :id",
        ExpressionAttributeValues: { ":id": changeRequestId },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return false;
    }
    return await withStorageErrors("DeleteItem(RoleLock)", () => Promise.reject(error));
  }
}

/**
 * ロック解放の結果。**解放できなかった理由を呼び出し側が区別できる**ようにする。
 *
 * - `held-by-other`: 別の申請がロックを保持していた。ロックが残るのは正しい状態である。
 * - `release-failed`: 解放そのものに失敗した。**ロックが漏れる** — 当該 IamRole は
 *   新しい申請を作れなくなる（FR-4.6）。運用で手動解放するまで解消しない。
 */
export type LockReleaseOutcome =
  | { released: true }
  | { released: false; reason: "held-by-other" }
  | { released: false; reason: "release-failed"; cause: LocalizedMessage | null };

/**
 * ロックの解放を試み、**失敗しても例外にせず**結果として返す。
 *
 * **状態を確定させた後（`applied` / `discarded`）は必ずこちらを使うこと。**
 * `releaseRoleLock` は `StorageError` を投げるため、確定後に呼ぶと呼び出し側の
 * `catch` に落ち、確定済みの状態を「失敗」へ巻き戻してしまう
 * （`requirements.md` § Assignment と ChangeRequest の関係「反映した内容と監査記録は必ず一致する」が破れる）。
 *
 * 漏れたロックは運用で解放でき、記録の取り違えは復旧できない。
 * したがってここでは**過剰にロックする方向**へ倒し、事実は握り潰さず
 * ログと戻り値の両方で必ず可視化する。
 */
export async function tryReleaseRoleLock(
  roleArn: string,
  changeRequestId: string,
): Promise<LockReleaseOutcome> {
  try {
    return (await releaseRoleLock(roleArn, changeRequestId))
      ? { released: true }
      : { released: false, reason: "held-by-other" };
  } catch (error) {
    console.error(
      `[rolust] ロールロックを解放できませんでした。手動での解放が必要です: roleArn=${roleArn}, changeRequestId=${changeRequestId}`,
      error,
    );
    return {
      released: false,
      reason: "release-failed",
      // `StorageError` などは自分の localized を、文だけの例外は common.rawDetail を、文も無ければ null。
      cause: carriedLocalized(error) ?? rawDetailOf(error),
    };
  }
}

function rawDetailOf(error: unknown): LocalizedMessage | null {
  const detail = awsErrorDetail(error);
  return detail === null ? null : localized("common.rawDetail", { detail });
}

export async function getRoleLock(roleArn: string): Promise<RoleLock | null> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(RoleLock)", () =>
    client.send(new GetCommand({ TableName: tableName, Key: roleLockKey(roleArn) })),
  );

  const item = result.Item as RoleLockItem | undefined;
  return item ? toRoleLock(item) : null;
}

/**
 * 複数ロールのロックをまとめて取得する（FR-7.2 の「未反映の申請」列、#19 D-2 の外せない理由）。
 *
 * BatchGetItem は 1 回 100 件まで。NFR-1 に従いページングは作り込まないが、
 * 分割は API の制約であって業務上のページングではないため 100 件ごとに刻む（`batchGetAll`）。
 * 未処理のキーを取りこぼすと「ロックが無い」と誤って判定し、未反映の申請があるロールの
 * 紐づけを外させてしまうため、読み切れなければ `StorageError` を投げる（Issue #35 で修正）。
 */
export async function getRoleLocks(roleArns: string[]): Promise<Map<string, RoleLock>> {
  const items = await batchGetAll(
    loadConfig().changeRequestTableName,
    "BatchGetItem(RoleLock)",
    roleArns.map((roleArn) => ({ ...roleLockKey(roleArn) })),
    localized("storage.roleLockIncomplete", {}),
  );
  const locks = new Map<string, RoleLock>();
  for (const raw of items) {
    const item = raw as unknown as RoleLockItem;
    locks.set(item.roleArn, toRoleLock(item));
  }
  return locks;
}

/**
 * ChangeRequest 本体を書き込む（FR-4.4 / FR-4.5）。
 *
 * 凍結入力（addUserArns / removeUserArns）はここで確定し、以後変化しない。
 */
export async function putChangeRequest(changeRequest: ChangeRequest): Promise<void> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const item: ChangeRequestItem = {
    ...changeRequestKey(changeRequest.changeRequestId),
    itemType: "ChangeRequest",
    changeRequestId: changeRequest.changeRequestId,
    poolId: changeRequest.poolId,
    roleArn: changeRequest.roleArn,
    addUserArns: changeRequest.addUserArns,
    removeUserArns: changeRequest.removeUserArns,
    status: changeRequest.status,
    createdAt: changeRequest.createdAt,
    createdBy: changeRequest.createdBy,
    appliedAt: changeRequest.appliedAt,
    appliedBy: changeRequest.appliedBy,
    result: changeRequest.result,
    ...(changeRequest.kind === undefined ? {} : { kind: changeRequest.kind }),
  };

  await withStorageErrors("PutItem(ChangeRequest)", () =>
    client.send(new PutCommand({ TableName: tableName, Item: item })),
  );
}

/**
 * 作成に失敗したロックを補償削除する。失敗しても例外にせず必ず記録する。
 *
 * 補償に失敗すると当該ロールはロックされたまま残る（過剰にロックする方向）。
 * FR-4.6 の「1 件まで」は破れないが、管理者は新規申請を作れなくなる。
 */
export async function compensateRoleLock(
  roleArn: string,
  changeRequestId: string,
): Promise<void> {
  await tryReleaseRoleLock(roleArn, changeRequestId);
}

export async function getChangeRequest(
  changeRequestId: string,
  options: { consistent?: boolean } = {},
): Promise<ChangeRequest | null> {
  const item = await getChangeRequestItem(changeRequestId, options.consistent === true);
  return item ? toChangeRequest(item) : null;
}

async function getChangeRequestItem(
  changeRequestId: string,
  consistent: boolean,
): Promise<ChangeRequestItem | undefined> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(ChangeRequest)", () =>
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: changeRequestKey(changeRequestId),
        // 条件付き書き込みに外れた後の判定は、最新の値で行う（Issue #121）。
        ...(consistent ? { ConsistentRead: true } : {}),
      }),
    ),
  );

  return result.Item as ChangeRequestItem | undefined;
}

export async function requireChangeRequest(
  changeRequestId: string,
): Promise<ChangeRequest> {
  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new NotFoundError(localized("changeRequest.notFound", { changeRequestId }));
  }
  return changeRequest;
}

/**
 * 申請履歴の全件（FR-7.5）。作成時刻の降順。
 *
 * Query は 1 MB でページを切るので、`LastEvaluatedKey` の最後まで辿る（Issue #116）。
 * 辿らないと、1 MB を超えた分の古い申請が黙って欠ける。
 */
export async function listChangeRequests(): Promise<ChangeRequest[]> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const items = await withStorageErrors("Query(ChangeRequest)", () =>
    queryAllWith(client, {
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": CHANGE_REQUESTS_PK,
        ":prefix": CHANGE_REQUEST_SK_PREFIX,
      },
    }),
  );

  return (items as unknown as ChangeRequestItem[])
    .map(toChangeRequest)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** claim の長さ（秒）。apply Lambda の timeout（30 秒）より十分長くする（Issue #121）。 */
export const APPLY_CLAIM_SECONDS = 120;

/**
 * 状態の書き込みの前提（Issue #121）。
 *
 * - `claim`: 反映の claim の持ち主（token が合う）だけが書ける。反映の成功・失敗の記録に使う。
 * - `unclaimed`: 下書きか失敗で、claim が無いか期限切れのときだけ書ける。破棄に使う。
 *
 * どちらも、書くときに claim（`applyingToken`・`applyingUntil`）を外す。
 */
export type StatusGuard =
  | { kind: "claim"; token: string }
  | { kind: "unclaimed"; now: string };

/** 下書きか失敗で、claim が無いか期限切れ。ISO 8601 UTC の辞書順で期限を比べる。 */
const UNCLAIMED_CONDITION =
  "#status IN (:draft, :failed) AND (attribute_not_exists(#applyingUntil) OR #applyingUntil < :now)";

/**
 * 反映の claim を取る（Issue #121）。IAM を呼ぶ前に呼び、取れなければ反映しない。
 *
 * 条件に外れた（別の管理者が反映中、すでに反映済み・破棄済み、申請が無い）ときは
 * `claimed: false` を返す。理由の区別は呼び出し側が、申請を読み直して行う。
 */
export async function claimChangeRequest(
  changeRequestId: string,
  now: string,
): Promise<{ claimed: true; token: string } | { claimed: false }> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();
  const token = randomUUID();
  const until = new Date(Date.parse(now) + APPLY_CLAIM_SECONDS * 1000).toISOString();

  try {
    await withStorageErrors("UpdateItem(ChangeRequest.claim)", () =>
      client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: changeRequestKey(changeRequestId),
          ConditionExpression: `attribute_exists(pk) AND ${UNCLAIMED_CONDITION}`,
          UpdateExpression: "SET #applyingToken = :token, #applyingUntil = :until",
          ExpressionAttributeNames: {
            "#status": "status",
            "#applyingToken": "applyingToken",
            "#applyingUntil": "applyingUntil",
          },
          ExpressionAttributeValues: {
            ":draft": "draft",
            ":failed": "failed",
            ":now": now,
            ":token": token,
            ":until": until,
          },
        }),
      ),
    );
    return { claimed: true, token };
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    // SDK の自動再送で、成功済みの claim の再試行が条件に外れることがある。持ち主が自分の token なら、取れている。
    const item = await getChangeRequestItem(changeRequestId, true);
    return item?.applyingToken === token ? { claimed: true, token } : { claimed: false };
  }
}

/**
 * 状態・結果・反映時刻を更新する（FR-5.5 / FR-4.8）。
 *
 * **凍結入力は書き換えない** — この関数は `status` / `appliedAt` / `appliedBy` / `result` だけを触る。
 * FR-5.6 の再反映が同じ入力で行える担保である。
 *
 * `guard` の前提が満たされるときだけ書き、claim を外す。外れたら `ConflictError`
 * （再試行しても同じ結果になる条件不一致なので、`StorageError` にしない。Issue #121）。
 */
export async function updateChangeRequestStatus(
  changeRequest: ChangeRequest,
  guard: StatusGuard,
): Promise<void> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const setClause =
    "SET #status = :status, #appliedAt = :appliedAt, #appliedBy = :appliedBy, #result = :result";
  const names: Record<string, string> = {
    "#status": "status",
    "#appliedAt": "appliedAt",
    "#appliedBy": "appliedBy",
    "#result": "result",
    "#applyingToken": "applyingToken",
    "#applyingUntil": "applyingUntil",
  };
  const values: Record<string, unknown> = {
    ":status": changeRequest.status,
    ":appliedAt": changeRequest.appliedAt,
    ":appliedBy": changeRequest.appliedBy,
    ":result": changeRequest.result,
  };
  let condition: string;
  if (guard.kind === "claim") {
    condition = "attribute_exists(pk) AND #applyingToken = :token";
    values[":token"] = guard.token;
  } else {
    condition = `attribute_exists(pk) AND ${UNCLAIMED_CONDITION}`;
    values[":draft"] = "draft";
    values[":failed"] = "failed";
    values[":now"] = guard.now;
  }

  try {
    await withStorageErrors("UpdateItem(ChangeRequest.status)", () =>
      client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: changeRequestKey(changeRequest.changeRequestId),
          ConditionExpression: condition,
          UpdateExpression: `${setClause} REMOVE #applyingToken, #applyingUntil`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      ),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // SDK の自動再送で、成功済みの書き込みの再試行が条件に外れることがある。同じ状態・同じ反映時刻で
      // claim が外れていれば、自分の書き込みが確定済みなので、成功として扱う（Issue #121）。
      const item = await getChangeRequestItem(changeRequest.changeRequestId, true);
      if (
        item &&
        item.status === changeRequest.status &&
        item.appliedAt === changeRequest.appliedAt &&
        item.applyingToken === undefined
      ) {
        return;
      }
      throw new ConflictError(
        localized("changeRequest.stateUpdateRefused", { changeRequestId: changeRequest.changeRequestId }),
      );
    }
    throw error;
  }
}

/** ロックの状態表示を追随させる（下書き → 失敗）。ロック自体は解放しない。 */
export async function updateRoleLockStatus(
  roleArn: string,
  changeRequestId: string,
  status: ChangeRequestStatus,
): Promise<void> {
  const { changeRequestTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: roleLockKey(roleArn),
        ConditionExpression: "changeRequestId = :id",
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":id": changeRequestId, ":status": status },
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // 別の申請がロックを持っている。表示上の状態が古くなるだけで FR-4.6 は破れない。
      console.error(
        `[rolust] ロールロックの状態更新をスキップしました（別の申請が保持）: roleArn=${roleArn}`,
      );
      return;
    }
    await withStorageErrors("UpdateItem(RoleLock.status)", () => Promise.reject(error));
  }
}

function toChangeRequest(item: ChangeRequestItem): ChangeRequest {
  return {
    changeRequestId: item.changeRequestId,
    poolId: item.poolId,
    roleArn: item.roleArn,
    addUserArns: item.addUserArns ?? [],
    removeUserArns: item.removeUserArns ?? [],
    status: item.status,
    createdAt: item.createdAt,
    createdBy: item.createdBy ?? null,
    appliedAt: item.appliedAt ?? null,
    appliedBy: item.appliedBy ?? null,
    result: item.result ?? null,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
  };
}

function toRoleLock(item: RoleLockItem): RoleLock {
  return {
    roleArn: item.roleArn,
    changeRequestId: item.changeRequestId,
    status: item.status,
    createdAt: item.createdAt,
  };
}
