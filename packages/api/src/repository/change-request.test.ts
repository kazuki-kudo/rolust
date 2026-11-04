import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { localized, recordApplyOutcome, renderMessage } from "@rolust/core";
import type { ChangeRequest, LocalizedMessage } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { roleLockKey } from "../ddb/keys.js";
import { ConflictError, StorageError } from "../errors.js";
import {
  TEST_CHANGE_REQUEST_TABLE_NAME,
  conditionalCheckFailed,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import {
  APPLY_CLAIM_SECONDS,
  claimChangeRequest,
  getChangeRequest,
  getRoleLocks,
  listChangeRequests,
  putChangeRequest,
  requireChangeRequest,
  tryReleaseRoleLock,
  updateChangeRequestStatus,
} from "./change-request.js";

const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const NOW = "2026-09-25T00:00:00.000Z";

function lockItem(roleArn: string, changeRequestId: string) {
  return {
    ...roleLockKey(roleArn),
    itemType: "RoleLock",
    roleArn,
    changeRequestId,
    status: "draft",
    createdAt: NOW,
  };
}

beforeEach(() => {
  setupDdbMock();
});

describe("getRoleLocks（FR-7.2 / Issue #35 で見つけた UnprocessedKeys の取りこぼし）", () => {
  it("UnprocessedKeys が残れば、それだけを再要求してロックを取りこぼさない", async () => {
    ddbMock
      .on(BatchGetCommand)
      .resolvesOnce({
        Responses: { [TEST_CHANGE_REQUEST_TABLE_NAME]: [lockItem(DEPLOY, "cr-1")] },
        UnprocessedKeys: { [TEST_CHANGE_REQUEST_TABLE_NAME]: { Keys: [roleLockKey(AUDIT)] } },
      })
      .resolvesOnce({ Responses: { [TEST_CHANGE_REQUEST_TABLE_NAME]: [lockItem(AUDIT, "cr-2")] } });

    const locks = await getRoleLocks([DEPLOY, AUDIT]);

    expect([...locks.keys()].sort()).toEqual([DEPLOY, AUDIT].sort());
    expect(locks.get(AUDIT)?.changeRequestId).toBe("cr-2");
    const calls = ddbMock.commandCalls(BatchGetCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0].input.RequestItems?.[TEST_CHANGE_REQUEST_TABLE_NAME]?.Keys).toEqual([roleLockKey(AUDIT)]);
  });

  it("未処理が 3 回続けて残れば StorageError を投げる（ロックが無いと誤って判定しない）", async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { [TEST_CHANGE_REQUEST_TABLE_NAME]: [] },
      UnprocessedKeys: { [TEST_CHANGE_REQUEST_TABLE_NAME]: { Keys: [roleLockKey(DEPLOY)] } },
    });

    await expect(getRoleLocks([DEPLOY])).rejects.toBeInstanceOf(StorageError);
    expect(ddbMock.commandCalls(BatchGetCommand)).toHaveLength(3);
  });

  it("読み切れない StorageError は storage.roleLockIncomplete の ID を持つ（Issue #94）", async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { [TEST_CHANGE_REQUEST_TABLE_NAME]: [] },
      UnprocessedKeys: { [TEST_CHANGE_REQUEST_TABLE_NAME]: { Keys: [roleLockKey(DEPLOY)] } },
    });

    await expect(getRoleLocks([DEPLOY])).rejects.toMatchObject({
      code: "StorageError",
      retryable: true,
      localized: { id: "storage.roleLockIncomplete", params: {} },
      message: "IAM ロールの未反映の申請（ロック）を読み切れませんでした。時間をおいて再試行してください。",
    });
  });
});

describe("申請テーブルに GSI は無い（Issue #36。アクセスパターン 10 は欠番）", () => {
  const changeRequest = {
    changeRequestId: "cr-1",
    poolId: "a-pool",
    roleArn: DEPLOY,
    addUserArns: ["arn:aws:iam::555566667777:user/alice"],
    removeUserArns: [],
    status: "draft" as const,
    createdAt: NOW,
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };

  it("putChangeRequest は申請テーブルへ gsi1pk / gsi1sk を持たないアイテムを書く", async () => {
    ddbMock.on(PutCommand).resolves({});
    await putChangeRequest(changeRequest);

    const input = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.TableName).toBe(TEST_CHANGE_REQUEST_TABLE_NAME);
    expect(input?.Item).not.toHaveProperty("gsi1pk");
    expect(input?.Item).not.toHaveProperty("gsi1sk");
  });

  it("updateChangeRequestStatus は gsi1sk を更新しない", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateChangeRequestStatus(
      { ...changeRequest, status: "applied", appliedAt: NOW },
      { kind: "claim", token: "tok" },
    );

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe(
      "SET #status = :status, #appliedAt = :appliedAt, #appliedBy = :appliedBy, #result = :result" +
        " REMOVE #applyingToken, #applyingUntil",
    );
    expect(input?.ExpressionAttributeNames).not.toHaveProperty("#gsi1sk");
  });
});

describe("実行者の保存（Issue #120）", () => {
  const base = {
    changeRequestId: "cr-1",
    poolId: "a-pool",
    roleArn: DEPLOY,
    addUserArns: [],
    removeUserArns: [],
    status: "draft" as const,
    createdAt: NOW,
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };

  it("putChangeRequest は createdBy・appliedBy をアイテムに書く", async () => {
    ddbMock.on(PutCommand).resolves({});

    await putChangeRequest({ ...base, createdBy: { name: "alice", sub: "user-1" } });

    const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item?.createdBy).toEqual({ name: "alice", sub: "user-1" });
    expect(item?.appliedBy).toBeNull();
  });

  it("updateChangeRequestStatus は appliedBy を書く", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateChangeRequestStatus(
      { ...base, status: "failed", appliedAt: NOW, appliedBy: { name: "bob" } },
      { kind: "claim", token: "tok" },
    );

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ExpressionAttributeValues?.[":appliedBy"]).toEqual({ name: "bob" });
  });

  it("listChangeRequests は、属性を持たない既存のアイテム（#120 より前）を null として読む", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          pk: "CR",
          sk: "CR#cr-old",
          itemType: "ChangeRequest",
          changeRequestId: "cr-old",
          poolId: "a-pool",
          roleArn: DEPLOY,
          addUserArns: [],
          removeUserArns: [],
          status: "applied",
          createdAt: NOW,
          appliedAt: NOW,
          result: null,
        },
        {
          pk: "CR",
          sk: "CR#cr-new",
          itemType: "ChangeRequest",
          changeRequestId: "cr-new",
          poolId: "a-pool",
          roleArn: DEPLOY,
          addUserArns: [],
          removeUserArns: [],
          status: "applied",
          createdAt: "2026-10-06T00:00:00.000Z",
          createdBy: { name: "alice", sub: "user-1" },
          appliedAt: "2026-10-06T00:01:00.000Z",
          appliedBy: { name: "bob" },
          result: null,
        },
      ],
    });

    const [newer, older] = await listChangeRequests();

    expect(older).toMatchObject({ changeRequestId: "cr-old", createdBy: null, appliedBy: null });
    expect(newer).toMatchObject({
      changeRequestId: "cr-new",
      createdBy: { name: "alice", sub: "user-1" },
      appliedBy: { name: "bob" },
    });
  });
});

describe("listChangeRequests は Query を最後まで辿る（Issue #116）", () => {
  function crItem(id: string, createdAt: string) {
    return {
      pk: "CR",
      sk: `CR#${id}`,
      itemType: "ChangeRequest",
      changeRequestId: id,
      poolId: "a-pool",
      roleArn: DEPLOY,
      addUserArns: [],
      removeUserArns: [],
      status: "applied",
      createdAt,
      appliedAt: createdAt,
      result: null,
    };
  }

  it("LastEvaluatedKey があれば次のページを読み、全件を作成日の降順で返す", async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [crItem("cr-1", "2026-01-01T00:00:00.000Z")],
        LastEvaluatedKey: { pk: "CR", sk: "CR#cr-1" },
      })
      .resolvesOnce({ Items: [crItem("cr-2", "2026-02-01T00:00:00.000Z")] });

    const result = await listChangeRequests();

    expect(result.map((request) => request.changeRequestId)).toEqual(["cr-2", "cr-1"]);
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0].input.ExclusiveStartKey).toBeUndefined();
    expect(calls[1]?.args[0].input.ExclusiveStartKey).toEqual({ pk: "CR", sk: "CR#cr-1" });
  });

  it("途中のページの Items が空でも、LastEvaluatedKey があれば続ける", async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: { pk: "CR", sk: "CR#cr-x" } })
      .resolvesOnce({ Items: [crItem("cr-3", "2026-03-01T00:00:00.000Z")] });

    const result = await listChangeRequests();

    expect(result.map((request) => request.changeRequestId)).toEqual(["cr-3"]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });
});

describe("反映の claim（Issue #121）", () => {
  const UNCLAIMED =
    "#status IN (:draft, :failed) AND (attribute_not_exists(#applyingUntil) OR #applyingUntil < :now)";

  it("claim は、下書きか失敗で claim の無い（または期限切れの）申請にだけ、token と期限を書く", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const result = await claimChangeRequest("cr-1", "2026-10-06T00:00:00.000Z");

    expect(result.claimed).toBe(true);
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.TableName).toBe(TEST_CHANGE_REQUEST_TABLE_NAME);
    expect(input?.Key).toEqual({ pk: "CR", sk: "CR#cr-1" });
    expect(input?.ConditionExpression).toBe(`attribute_exists(pk) AND ${UNCLAIMED}`);
    expect(input?.UpdateExpression).toBe("SET #applyingToken = :token, #applyingUntil = :until");
    expect(input?.ExpressionAttributeValues).toMatchObject({
      ":draft": "draft",
      ":failed": "failed",
      ":now": "2026-10-06T00:00:00.000Z",
      ":until": "2026-10-06T00:02:00.000Z",
    });
    expect(APPLY_CLAIM_SECONDS).toBe(120);
    if (result.claimed) expect(input?.ExpressionAttributeValues?.[":token"]).toBe(result.token);
  });

  it("claim は呼ぶたびに別の token を作る", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const first = await claimChangeRequest("cr-1", NOW);
    const second = await claimChangeRequest("cr-1", NOW);

    expect(first.claimed && second.claimed && first.token !== second.token).toBe(true);
  });

  it("条件に外れたら claimed: false を返す（例外にしない）", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({});

    await expect(claimChangeRequest("cr-1", NOW)).resolves.toEqual({ claimed: false });
  });

  it("条件不一致以外の失敗は StorageError で投げる", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(claimChangeRequest("cr-1", NOW)).rejects.toBeInstanceOf(StorageError);
  });

  const base = {
    changeRequestId: "cr-1",
    poolId: "a-pool",
    roleArn: DEPLOY,
    addUserArns: [],
    removeUserArns: [],
    status: "applied" as const,
    createdAt: NOW,
    createdBy: null,
    appliedAt: NOW,
    appliedBy: null,
    result: null,
  };

  it("claim の guard は、token が合うときだけ書き、書くときに claim を外す", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" });

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe("attribute_exists(pk) AND #applyingToken = :token");
    expect(input?.UpdateExpression).toBe(
      "SET #status = :status, #appliedAt = :appliedAt, #appliedBy = :appliedBy, #result = :result" +
        " REMOVE #applyingToken, #applyingUntil",
    );
    expect(input?.ExpressionAttributeValues?.[":token"]).toBe("tok-1");
  });

  it("unclaimed の guard は、claim の無い下書き・失敗にだけ書き、書くときに claim を外す", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateChangeRequestStatus({ ...base, status: "discarded" }, { kind: "unclaimed", now: NOW });

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe(`attribute_exists(pk) AND ${UNCLAIMED}`);
    expect(input?.UpdateExpression).toContain("REMOVE #applyingToken, #applyingUntil");
    expect(input?.ExpressionAttributeValues).toMatchObject({
      ":draft": "draft",
      ":failed": "failed",
      ":now": NOW,
    });
  });

  it("guard の条件に外れたら ConflictError を投げる（StorageError にしない）", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({});

    await expect(
      updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("guard 付きでも、条件不一致以外の失敗は StorageError", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(
      updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  describe("SDK の再送で、書き込みが成功した後の再試行が条件に外れる場合（冪等性）", () => {
    const item = (extra: Record<string, unknown>) => ({
      pk: "CR",
      sk: "CR#cr-1",
      itemType: "ChangeRequest",
      changeRequestId: "cr-1",
      poolId: "a-pool",
      roleArn: DEPLOY,
      addUserArns: [],
      removeUserArns: [],
      status: "applied",
      createdAt: NOW,
      appliedAt: NOW,
      appliedBy: null,
      result: null,
      ...extra,
    });

    it("条件に外れても、自分の書き込みが確定済み（同じ状態・同じ appliedAt で claim が無い）なら成功として扱う", async () => {
      ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
      ddbMock.on(GetCommand).resolves({ Item: item({}) });

      await expect(
        updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" }),
      ).resolves.toBeUndefined();
      // 判定の読み取りは強い整合性で行う。
      expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input.ConsistentRead).toBe(true);
    });

    it("別の管理者の claim が残っている、または appliedAt が違うときは ConflictError のまま", async () => {
      ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

      ddbMock.on(GetCommand).resolves({ Item: item({ status: "draft", appliedAt: null, applyingToken: "other" }) });
      await expect(
        updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" }),
      ).rejects.toBeInstanceOf(ConflictError);

      ddbMock.on(GetCommand).resolves({ Item: item({ appliedAt: "2026-01-01T00:00:00.000Z" }) });
      await expect(
        updateChangeRequestStatus(base, { kind: "claim", token: "tok-1" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("claim の再送が条件に外れても、持ち主が自分の token なら claimed: true を返す", async () => {
      let sent = "";
      ddbMock.on(UpdateCommand).callsFake((input: { ExpressionAttributeValues: Record<string, string> }) => {
        sent = input.ExpressionAttributeValues[":token"] as string;
        throw conditionalCheckFailed();
      });
      ddbMock.on(GetCommand).callsFake(() => ({ Item: item({ status: "draft", applyingToken: sent }) }));

      const result = await claimChangeRequest("cr-1", NOW);

      expect(result).toEqual({ claimed: true, token: sent });
    });

    it("claim が条件に外れ、持ち主が別の token なら claimed: false のまま", async () => {
      ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
      ddbMock.on(GetCommand).resolves({ Item: item({ status: "draft", applyingToken: "other" }) });

      await expect(claimChangeRequest("cr-1", NOW)).resolves.toEqual({ claimed: false });
    });
  });
});

describe("文言の ID（Issue #94）", () => {
  it("requireChangeRequest は無い申請を changeRequest.notFound と changeRequestId を持つ NotFoundError にする", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(requireChangeRequest("cr-ghost")).rejects.toMatchObject({
      code: "NotFound",
      localized: { id: "changeRequest.notFound", params: { changeRequestId: "cr-ghost" } },
      message: "申請が見つかりません: cr-ghost",
    });
  });

  it("状態の更新が条件に外れて確定済みでもなければ changeRequest.stateUpdateRefused の ConflictError", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({
      Item: {
        pk: "CR", sk: "CR#cr-1", itemType: "ChangeRequest", changeRequestId: "cr-1", poolId: "a-pool", roleArn: DEPLOY,
        addUserArns: [], removeUserArns: [], status: "draft", createdAt: NOW, applyingToken: "other",
      },
    });

    await expect(
      updateChangeRequestStatus(
        {
          changeRequestId: "cr-1", poolId: "a-pool", roleArn: DEPLOY, addUserArns: [], removeUserArns: [],
          status: "applied", createdAt: NOW, createdBy: null, appliedAt: NOW, appliedBy: null, result: null,
        },
        { kind: "claim", token: "tok-1" },
      ),
    ).rejects.toMatchObject({
      code: "Conflict",
      localized: { id: "changeRequest.stateUpdateRefused", params: { changeRequestId: "cr-1" } },
      message:
        "申請の状態を更新できませんでした（別の管理者の操作が先に確定したか、反映の権利が切れました）: cr-1",
    });
  });
});

describe("反映結果の localized の保存（Issue #94）", () => {
  const draft: ChangeRequest = {
    changeRequestId: "cr-1",
    poolId: "a-pool",
    roleArn: DEPLOY,
    addUserArns: [],
    removeUserArns: [],
    status: "draft",
    createdAt: NOW,
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };

  /**
   * DynamoDB に書いた値を、実際の符号化（`removeUndefinedValues: true`。`ddb/client.ts`）で往復させて、読む側へ返す。
   * モックは符号化を通らないので、null・配列・undefined の扱いを確かめるには、この往復が要る。
   */
  function wireRoundTrip(value: unknown): unknown {
    const encoded = marshall({ value }, { removeUndefinedValues: true, convertClassInstanceToMap: false });
    return unmarshall(encoded).value;
  }

  it("localized つきの反映結果は、書いて読んでも params の null・配列が崩れない", async () => {
    const message = localized("role.tagMissing", {
      roleName: "SampleRole",
      managedTagKey: "rolust:managed",
      managedTagValue: "true",
      targetAccountId: null,
    });
    const nested = localized("csv.rowError", { position: 3, cause: localized("csv.userNameNotString", {}) });
    const listed = localized("allowedAccounts.invalidValues", { invalid: ["1", "22"] });
    for (const sent of [message, nested, listed]) {
      ddbMock.resetHistory();
      ddbMock.on(UpdateCommand).resolves({});
      const applied = recordApplyOutcome(
        draft,
        { ok: false, message: "x", errorCode: "AccessDenied", localized: sent },
        NOW,
        null,
      );

      await updateChangeRequestStatus(applied, { kind: "claim", token: "tok" });

      const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues?.[":result"];
      ddbMock.on(GetCommand).resolves({
        Item: {
          pk: "CR",
          sk: "CR#cr-1",
          itemType: "ChangeRequest",
          changeRequestId: "cr-1",
          poolId: "a-pool",
          roleArn: DEPLOY,
          addUserArns: [],
          removeUserArns: [],
          status: "failed",
          createdAt: NOW,
          appliedAt: NOW,
          result: wireRoundTrip(written),
        },
      });

      const read = await getChangeRequest("cr-1", { consistent: true });

      expect(read?.result?.localized).toEqual(sent);
      expect(read?.result).toEqual({ ok: false, message: "x", errorCode: "AccessDenied", localized: sent });
    }
  });

  it("localized の無い旧レコードの result は、そのまま読める（localized は undefined）", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        pk: "CR",
        sk: "CR#cr-old",
        itemType: "ChangeRequest",
        changeRequestId: "cr-old",
        poolId: "a-pool",
        roleArn: DEPLOY,
        addUserArns: [],
        removeUserArns: [],
        status: "failed",
        createdAt: NOW,
        appliedAt: NOW,
        result: { ok: false, message: "旧", errorCode: "X" },
      },
    });

    const read = await getChangeRequest("cr-old", { consistent: true });

    expect(read?.result).toEqual({ ok: false, message: "旧", errorCode: "X" });
    expect(read?.result?.localized).toBeUndefined();
  });
});

describe("tryReleaseRoleLock の戻り値（Issue #94）", () => {
  it("解放に失敗したときは、例外の localized（cause）を返す。detail・message は持たない。ja・en とも日本語が混ざらない形", async () => {
    ddbMock.on(DeleteCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const outcome = await tryReleaseRoleLock(DEPLOY, "cr-1");

    expect(outcome).toMatchObject({ released: false, reason: "release-failed" });
    const cause = (outcome as { cause?: LocalizedMessage | null }).cause;
    expect(cause?.id).toBe("storage.operationFailed");
    expect(outcome).not.toHaveProperty("detail");
    expect(outcome).not.toHaveProperty("message");

    // 従来の日本語の文（release.message を括弧に入れた文）と同じ。en には日本語が混ざらない。
    const wrapped = localized("apply.lockReleaseFailed", { cause: cause ?? null });
    expect(renderMessage("ja", wrapped)).toBe(
      `反映は成功しましたが、ロールロックを解放できませんでした（${renderMessage("ja", cause!)}）。` +
        "解放されるまでこのロールの新しい申請は作成できません。",
    );
    expect(renderMessage("en", wrapped)).not.toMatch(/[぀-ヿ一-鿿]/);
  });

  it("別の申請がロックを保持していたときは held-by-other", async () => {
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());

    expect(await tryReleaseRoleLock(DEPLOY, "cr-1")).toEqual({ released: false, reason: "held-by-other" });
  });
});
