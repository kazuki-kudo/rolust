import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  CreateRoleCommand,
  DeleteRoleCommand,
  GetRoleCommand,
  IAMClient,
  NoSuchEntityException,
} from "@aws-sdk/client-iam";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import { computeTrustDrift, listPrincipals } from "@rolust/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIamTrustPolicyClient,
  createIamTrustPolicyReader,
} from "../aws/iam-client.js";
import { applyChangeRequests } from "../services/apply-service.js";
import { adoptDrift, restoreDrift } from "../services/drift-repair-service.js";
import {
  TEST_CHANGE_REQUEST_TABLE_NAME,
  TEST_POOL_ID,
  TEST_STATE_TABLE_NAME,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import { MemoryTables } from "../testing/memory-tables.js";
import { assertCallerAccount, loadIntegrationEnv, withProfile } from "./support.js";

/**
 * 乖離を直す操作（Issue #172。FR-4.10・FR-4.11）の、実 IAM に対する統合テスト。
 *
 * **既定の `npm run test` では実行されない**（`vitest.config.ts` が `*.integration.test.ts` を除外し、
 * さらに `ROLUST_INTEGRATION=1` が無ければ `describe.skipIf` で全件スキップする）。
 *
 * ```bash
 * # `.local/rolust.env.example` を `.local/rolust.env` に写して値を入れ、読み込んでから実行する
 * source .local/rolust.env
 * ROLUST_INTEGRATION=1 npm run test:integration
 * ```
 *
 * ## 対象リソース — 検証用ロールを新規に作り、必ず消す
 *
 * 既存の管理対象ロール（`real-iam.integration.test.ts` の 3 本を含む）には**触れない**。DEPLOY アカウントに
 * 検証用ロール `rolust-it-drift-<乱数>` を `beforeAll` で作り（管理対象タグつき）、`afterAll` で削除する。
 * 削除の後に `GetRole` が `NoSuchEntity` を返すことを確かめ、消せなければロール名を出して失敗させる。
 * 作るのは新規のフィクスチャなので、退避・復元は要らない（消せば元どおり）。
 *
 * ## モックと実物の分担
 *
 * - IAM（`GetRole`・`UpdateAssumeRolePolicy`）は**実物**。信頼ポリシーの読み書きそのものはモックで検証できない。
 * - DynamoDB はメモリ上の写し（`MemoryTables`。実テーブルと同じキーと条件の意味）。Rolust のリポジトリが
 *   送る形だけを受け、知らない形は例外にする。
 *
 * ## 前提（実行する人が事前に用意する）
 *
 * - プロファイル（`ROLUST_INTEGRATION_DEPLOY_PROFILE`）に `iam:CreateRole`・`iam:TagRole`・
 *   `iam:GetRole`・`iam:UpdateAssumeRolePolicy`・`iam:DeleteRole` の権限があること。
 * - DEPLOY に IAM ユーザ `test1@example.com`〜`test3@example.com` が実在すること（IAM は実在しない principal を拒否する）。
 * - 環境変数 `ROLUST_INTEGRATION_DEPLOY_{PROFILE,ACCOUNT}` を設定すること（既定値はない。検証用ロールの作成の前に、
 *   プロファイルのアカウントが期待と一致するかを STS で照合する）。
 * - デプロイ先 = ロールのアカウント（DEPLOY）として IAM クライアントを作るので、AssumeRole の経路は通らない。
 *   別アカウントのロールでの確認は、手順書（`docs/runbooks/drift-repair.md`）で行う。
 *
 * ## IAM の結果整合
 *
 * `UpdateAssumeRolePolicy` の直後の `GetRole` は、通常は書いた内容を返すが、保証はない（作成直後の `GetRole` も
 * 同じ）。読み直しは、期待した状態になるまで短い間隔で数回やり直す（`eventually`）。なお、更新した信頼ポリシーが
 * `sts:AssumeRole` の判定に効くまでには数分かかることがある（2026-09 の実測で約 7 分）。本テストは AssumeRole を
 * 試さないので、その遅れには依存しない。
 */

const RUN = process.env.ROLUST_INTEGRATION === "1";

// 既定値は持たない。RUN が真で未設定・不正なら、AWS を呼ぶ前にここで失敗する（Issue #176）。
const env = loadIntegrationEnv(
  ["ROLUST_INTEGRATION_DEPLOY_PROFILE", "ROLUST_INTEGRATION_DEPLOY_ACCOUNT"] as const,
  RUN,
);
const DEPLOY_PROFILE = env.ROLUST_INTEGRATION_DEPLOY_PROFILE;
const DEPLOY_ACCOUNT = env.ROLUST_INTEGRATION_DEPLOY_ACCOUNT;
/** 管理対象タグ（`infra/variables.tf` の既定）。本番の値を変えていれば環境変数で合わせる。 */
const MANAGED_TAG_KEY = process.env.ROLUST_INTEGRATION_MANAGED_TAG_KEY ?? "rolust:managed";
const MANAGED_TAG_VALUE = process.env.ROLUST_INTEGRATION_MANAGED_TAG_VALUE ?? "true";

/** 検証用ロールの名前の接頭辞。削除はこの接頭辞のロールにしか行わない。 */
const ROLE_NAME_PREFIX = "rolust-it-drift-";
const ROLE_NAME = `${ROLE_NAME_PREFIX}${randomUUID().slice(0, 8)}`;
const ROLE = `arn:aws:iam::${DEPLOY_ACCOUNT}:role/${ROLE_NAME}`;

const USER1 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test1@example.com`;
const USER2 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test2@example.com`;
const USER3 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test3@example.com`;
const USERS = [USER1, USER2, USER3];
/** Rolust の管理外の principal。どの操作でも残ることを確かめる。 */
const SERVICE = "ec2.amazonaws.com";

const ACTOR = { name: "rolust-integration" };
const POOL_PK = `POOL#${TEST_POOL_ID}`;

/**
 * 外から書き換えられた信頼ポリシー: USER1・USER2 を信頼し、管理外のサービスを含む。
 * 記録（`reflected`）は USER1・USER3 なので、USER3 が足りず、USER2 が余分になる。
 */
const TAMPERED: TrustPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    { Sid: "Users", Effect: "Allow", Principal: { AWS: [USER1, USER2] }, Action: "sts:AssumeRole" },
    { Sid: "ExternalService", Effect: "Allow", Principal: { Service: SERVICE }, Action: "sts:AssumeRole" },
  ],
};

const tables = new MemoryTables();
let roleCreated = false;

const deploy = <T>(fn: () => Promise<T>): Promise<T> => withProfile(DEPLOY_PROFILE, fn);

/** ロールの作成・削除だけに使う IAM クライアント（Rolust のクライアントは作成・削除を持たない）。 */
function adminIam(): IAMClient {
  return new IAMClient({});
}

/** 期待した状態になるまで読み直す（IAM の結果整合）。最後の値で判定できなければ、最後の値を返す。 */
async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  attempts = 10,
  delayMs = 3_000,
): Promise<T> {
  let last: T | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (last === undefined) throw lastError;
  return last;
}

function readTrustPolicy(): Promise<TrustPolicyDocument> {
  return deploy(() => createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE));
}

/** 信頼ポリシーに現れる principal（ARN・サービス）。 */
function principalsOf(document: TrustPolicyDocument): string[] {
  return listPrincipals(document).map((entry) => entry.value);
}

/** 比較用に、文字列の配列を並べ替えた複製（IAM は `Principal.AWS` の順序を保持しない。Issue #16）。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return items.every((item) => typeof item === "string") ? [...items].sort() : items;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** メモリ上の記録から、このロールで `reflected` が真のユーザ。 */
function reflectedUsers(): string[] {
  return tables
    .query(TEST_STATE_TABLE_NAME, POOL_PK, "ASSIGN#")
    .filter((item) => item.roleArn === ROLE && item.reflected === true)
    .map((item) => String(item.userArn))
    .sort();
}

function assignment(userArn: string): Record<string, unknown> | undefined {
  return tables.get(TEST_STATE_TABLE_NAME, { pk: POOL_PK, sk: `ASSIGN#${userArn}#${ROLE}` });
}

function seedAssignment(userArn: string, state: boolean, updatedAt: string): void {
  tables.put(TEST_STATE_TABLE_NAME, {
    pk: POOL_PK, sk: `ASSIGN#${userArn}#${ROLE}`, itemType: "Assignment", poolId: TEST_POOL_ID,
    userArn, roleArn: ROLE, checked: state, reflected: state, updatedAt,
  });
}

/** ロールの登録・ユーザプール・記録をメモリ上の写しに置く。記録は USER1・USER3 が「引き受けられる」。 */
function seedRecords(): void {
  const createdAt = "2026-10-16T00:00:00.000Z";
  tables.put(TEST_STATE_TABLE_NAME, {
    pk: "ROLE", sk: `ROLE#${ROLE}`, itemType: "IamRole", accountId: DEPLOY_ACCOUNT,
    roleName: ROLE_NAME, arn: ROLE, createdAt,
  });
  for (const arn of USERS) {
    tables.put(TEST_STATE_TABLE_NAME, {
      pk: POOL_PK, sk: `USER#${arn}`, itemType: "IamUser", poolId: TEST_POOL_ID,
      accountId: DEPLOY_ACCOUNT, userName: arn.split("/")[1], arn, createdAt,
    });
  }
  seedAssignment(USER1, true, createdAt);
  seedAssignment(USER3, true, createdAt);
}

/** 信頼ポリシーを外から書き換え（`TAMPERED`）、読み直して書いた内容が見えるまで待つ。 */
async function tamper(): Promise<TrustPolicyDocument> {
  await deploy(() => createIamTrustPolicyClient(DEPLOY_ACCOUNT).updateTrustPolicy(ROLE, TAMPERED));
  return eventually(readTrustPolicy, (read) => isDeepStrictEqual(canonical(read), canonical(TAMPERED)));
}

describe.skipIf(!RUN)("実 IAM に対する乖離の修復（Issue #172。検証用ロール）", () => {
  beforeAll(async () => {
    // 書き込み（検証用ロールの作成）の前に、プロファイルが期待のアカウントを指していることを確かめる。
    // 外れていれば何も作らない（roleCreated が偽のままなので、afterAll は何も消さない）。
    await assertCallerAccount(DEPLOY_PROFILE, DEPLOY_ACCOUNT);

    setupDdbMock();
    tables.install();
    seedRecords();

    await deploy(async () => {
      await adminIam().send(
        new CreateRoleCommand({
          RoleName: ROLE_NAME,
          AssumeRolePolicyDocument: JSON.stringify(TAMPERED),
          Description: "Rolust integration test (Issue #172). Safe to delete.",
          Tags: [{ Key: MANAGED_TAG_KEY, Value: MANAGED_TAG_VALUE }],
        }),
      );
    });
    roleCreated = true;
    console.info(`[drift-it] 検証用ロールを作成しました: ${ROLE}`);
    // 作成直後の GetRole は NoSuchEntity を返しうる。見えるまで待つ。
    await eventually(readTrustPolicy, () => true);
  });

  afterAll(async () => {
    if (!roleCreated) return;
    // 自分が作った接頭辞のロールしか消さない（取り違えの歯止め）。
    expect(ROLE_NAME.startsWith(ROLE_NAME_PREFIX)).toBe(true);
    let deleted = false;
    try {
      await deploy(async () => {
        await adminIam().send(new DeleteRoleCommand({ RoleName: ROLE_NAME }));
        // 削除が見えるまで待つ。
        deleted = await eventually(
          async () => {
            try {
              await adminIam().send(new GetRoleCommand({ RoleName: ROLE_NAME }));
              return false;
            } catch (error) {
              if (error instanceof NoSuchEntityException || (error as { name?: string }).name === "NoSuchEntityException") {
                return true;
              }
              throw error;
            }
          },
          (gone) => gone,
        );
      });
    } catch (error) {
      console.error(`[drift-it] 検証用ロールを削除できませんでした。手で削除してください: ${ROLE_NAME}`, error);
    }
    if (!deleted) {
      console.error(
        `[drift-it] 検証用ロールが残っています。手で削除してください: aws iam delete-role --role-name ${ROLE_NAME} --profile ${DEPLOY_PROFILE}`,
      );
    }
    expect(deleted, `検証用ロール ${ROLE_NAME} の削除`).toBe(true);
  });

  it("前提: 実 IAM と記録が食い違っている（USER3 が足りず、USER2 が余分。管理外のサービスがある）", async () => {
    const read = await readTrustPolicy();

    const drift = computeTrustDrift(read, ROLE, USERS, reflectedUsers());
    expect(drift.missing).toEqual([USER3]);
    expect(drift.extra).toEqual([USER2]);
    expect(drift.unmanaged.map((entry) => entry.value)).toEqual([SERVICE]);
  });

  it("restore（FR-4.10）: 実 IAM を読んで下書きを作り、反映すると乖離が空になり、管理外のサービスが残る", async () => {
    const created = await deploy(() =>
      restoreDrift(ROLE, "2026-10-16T01:00:00.000Z", ACTOR, DEPLOY_ACCOUNT, {
        iam: createIamTrustPolicyReader(DEPLOY_ACCOUNT),
      }),
    );

    expect(created.outcome).toBe("created");
    const changeRequest = created.changeRequest;
    expect(changeRequest).toMatchObject({
      roleArn: ROLE,
      kind: "restore",
      status: "draft",
      addUserArns: [USER3],
      removeUserArns: [USER2],
      createdBy: ACTOR,
    });
    expect(JSON.stringify(changeRequest)).not.toContain(SERVICE);
    if (changeRequest === null) throw new Error("下書きが作られていません");
    // FR-4.6 のロックを取っている。
    expect(tables.get(TEST_CHANGE_REQUEST_TABLE_NAME, { pk: `ROLELOCK#${ROLE}`, sk: "UNREFLECTED" })).toMatchObject({
      changeRequestId: changeRequest.changeRequestId,
    });

    // 反映（画面 4 の「反映」と同じ経路）。実際に UpdateAssumeRolePolicy を呼ぶ。
    const [report] = await deploy(() =>
      applyChangeRequests([changeRequest.changeRequestId], "2026-10-16T01:05:00.000Z", DEPLOY_ACCOUNT, ACTOR, {
        iam: createIamTrustPolicyClient(DEPLOY_ACCOUNT),
      }),
    );
    expect(report).toMatchObject({ ok: true, status: "applied", added: [USER3], removed: [USER2], warnings: [] });

    // 記録: 申請は反映済み、ロックは解放、reflected は変わらない（USER1・USER3）。
    expect(tables.get(TEST_CHANGE_REQUEST_TABLE_NAME, { pk: "CR", sk: `CR#${changeRequest.changeRequestId}` })).toMatchObject({
      status: "applied",
      kind: "restore",
    });
    expect(tables.get(TEST_CHANGE_REQUEST_TABLE_NAME, { pk: `ROLELOCK#${ROLE}`, sk: "UNREFLECTED" })).toBeUndefined();
    expect(reflectedUsers()).toEqual([USER1, USER3].sort());

    // 実 IAM を読み直す: 乖離が空になり、管理外のサービスと USER1 が残る。
    const after = await eventually(
      readTrustPolicy,
      (read) => {
        const drift = computeTrustDrift(read, ROLE, USERS, reflectedUsers());
        return drift.missing.length === 0 && drift.extra.length === 0;
      },
    );
    const drift = computeTrustDrift(after, ROLE, USERS, reflectedUsers());
    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
    expect(drift.unmanaged.map((entry) => entry.value)).toEqual([SERVICE]);
    expect(principalsOf(after)).toEqual(expect.arrayContaining([USER1, USER3, SERVICE]));
    expect(principalsOf(after)).not.toContain(USER2);
  });

  it("adopt（FR-4.11）: IAM を書かずに記録を IAM に合わせる。信頼ポリシーは前後で同じ、交点は乖離したユーザだけ", async () => {
    // 再び食い違わせる（USER3 が足りず、USER2 が余分）。
    const before = await tamper();
    expect(computeTrustDrift(before, ROLE, USERS, reflectedUsers())).toMatchObject({
      missing: [USER3],
      extra: [USER2],
    });
    const user1Before = assignment(USER1);
    const putsBefore = ddbMock.commandCalls(PutCommand).length;
    const updatesBefore = ddbMock.commandCalls(UpdateCommand).length;

    const response = await deploy(() =>
      adoptDrift(ROLE, "2026-10-16T02:00:00.000Z", ACTOR, DEPLOY_ACCOUNT, {
        iam: createIamTrustPolicyReader(DEPLOY_ACCOUNT),
      }),
    );

    expect(response.outcome).toBe("adopted");
    expect(response.failures).toEqual([]);
    expect(response.changeRequest).toMatchObject({
      kind: "adopt",
      status: "applied",
      addUserArns: [USER2],
      removeUserArns: [USER3],
      createdBy: ACTOR,
      appliedBy: ACTOR,
      result: { ok: true, errorCode: null },
    });

    // DynamoDB への書き込み: 監査の ChangeRequest 1 件と、乖離したユーザの交点 2 件だけ。
    const puts = ddbMock.commandCalls(PutCommand).slice(putsBefore).map((call) => call.args[0].input.Item);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ itemType: "ChangeRequest", kind: "adopt", status: "applied" });
    const updates = ddbMock.commandCalls(UpdateCommand).slice(updatesBefore).map((call) => call.args[0].input);
    expect(
      updates.map((input) => [input.ExpressionAttributeValues?.[":userArn"], input.ExpressionAttributeValues?.[":state"]]),
    ).toEqual(expect.arrayContaining([[USER2, true], [USER3, false]]));
    expect(updates).toHaveLength(2);
    expect(assignment(USER1)).toEqual(user1Before); // 乖離していない交点は触らない
    expect(assignment(USER2)).toMatchObject({ checked: true, reflected: true });
    expect(assignment(USER3)).toMatchObject({ checked: false, reflected: false });
    // ロックは取らない（未反映の状態を持たない。D-14）。
    expect(tables.get(TEST_CHANGE_REQUEST_TABLE_NAME, { pk: `ROLELOCK#${ROLE}`, sk: "UNREFLECTED" })).toBeUndefined();

    // 実 IAM: 信頼ポリシーは前後で同じ（Principal.AWS の順序は無視して比べる）。乖離は空。
    const after = await readTrustPolicy();
    expect(canonical(after)).toEqual(canonical(before));
    const drift = computeTrustDrift(after, ROLE, USERS, reflectedUsers());
    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
    expect(drift.unmanaged.map((entry) => entry.value)).toEqual([SERVICE]);
  });
});
