import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { renderMessage } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import {
  createChangeRequests,
  discardChangeRequest,
} from "./change-request-service.js";

const POOL_ID = "platform-team";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const TOMAS = "arn:aws:iam::444455556666:user/tomas.ruiz";
const NOW = "2026-07-31T10:04:00.000Z";

function assignmentItem(userArn: string, roleArn: string, checked: boolean, reflected: boolean) {
  return {
    pk: `POOL#${POOL_ID}`,
    sk: `ASSIGN#${userArn}#${roleArn}`,
    itemType: "Assignment",
    poolId: POOL_ID,
    userArn,
    roleArn,
    checked,
    reflected,
    updatedAt: NOW,
  };
}

function roleItem(roleArn: string) {
  return {
    pk: "ROLE",
    sk: `ROLE#${roleArn}`,
    itemType: "IamRole",
    accountId: roleArn.split(":")[4],
    roleName: roleArn.split("/")[1],
    arn: roleArn,
    createdAt: NOW,
  };
}

/** プール取得・ロール取得・Assignment 取得の共通スタブ。 */
function stubReads(options: {
  assignments: ReturnType<typeof assignmentItem>[];
  links?: string[];
}): void {
  ddbMock
    .on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: "META" } })
    .resolves({ Item: { pk: `POOL#${POOL_ID}`, sk: "META", itemType: "UserPool", poolId: POOL_ID, createdAt: NOW } });

  ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${DEPLOY}` } }).resolves({
    Item: roleItem(DEPLOY),
  });
  ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${AUDIT}` } }).resolves({
    Item: roleItem(AUDIT),
  });

  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ASSIGN#" } })
    .resolves({ Items: options.assignments });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ROLE#" } })
    .resolves({
      Items: (options.links ?? [DEPLOY, AUDIT]).map((roleArn) => ({
        pk: `POOL#${POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn, createdAt: NOW,
      })),
    });
}

beforeEach(() => {
  setupDdbMock();
});

describe("申請の作成（FR-4.4 / FR-4.5 / FR-4.6）", () => {
  it("対象のロールが 0 件なら changeRequest.noRoles の ValidationError（Issue #94）", async () => {
    stubReads({ assignments: [] });

    await expect(createChangeRequests(POOL_ID, [], NOW, null)).rejects.toMatchObject({
      field: "roleArns",
      localized: { id: "changeRequest.noRoles", params: {} },
      message: "申請対象のロールが 1 件も指定されていません",
    });
  });

  it("FR-4.6: 未反映申請を持つロールは作成対象から除外され、既存の申請は残る", async () => {
    stubReads({
      assignments: [
        assignmentItem(AYAKA, DEPLOY, true, false),
        assignmentItem(TOMAS, AUDIT, false, true),
      ],
    });

    // DeployProd はロックを取れる。ReadOnlyAudit は既に失敗状態の申請を持つ。
    ddbMock
      .on(PutCommand, { Item: { pk: `ROLELOCK#${DEPLOY}` } })
      .resolves({});
    ddbMock
      .on(PutCommand, { Item: { pk: `ROLELOCK#${AUDIT}` } })
      .rejects(conditionalCheckFailed());
    ddbMock
      .on(GetCommand, { Key: { pk: `ROLELOCK#${AUDIT}`, sk: "UNREFLECTED" } })
      .resolves({
        Item: {
          pk: `ROLELOCK#${AUDIT}`,
          sk: "UNREFLECTED",
          itemType: "RoleLock",
          roleArn: AUDIT,
          changeRequestId: "cr-0139",
          status: "failed",
          createdAt: "2026-07-31T09:11:00.000Z",
        },
      });
    ddbMock.on(PutCommand, { Item: { pk: "CR" } }).resolves({});

    const result = await createChangeRequests(POOL_ID, [DEPLOY, AUDIT], NOW, null);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.roleArn).toBe(DEPLOY);
    expect(result.excluded).toEqual([
      { roleArn: AUDIT, reason: "failed", changeRequestId: "cr-0139" },
    ]);
    expect(result.failures).toEqual([]);

    // 既存の ChangeRequest を自動的に破棄していないこと（FR-4.6）
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("FR-4.5: 作成時点の Assignment から算出した入力が凍結される", async () => {
    stubReads({
      assignments: [
        assignmentItem(AYAKA, DEPLOY, true, false), // 追加
        assignmentItem(TOMAS, DEPLOY, false, true), // 削除
      ],
    });
    ddbMock.on(PutCommand).resolves({});

    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, null);
    const created = result.created[0];

    expect(created?.addUserArns).toEqual([AYAKA]);
    expect(created?.removeUserArns).toEqual([TOMAS]);

    const stored = ddbMock
      .commandCalls(PutCommand)
      .map((call) => call.args[0].input.Item)
      .find((item) => item?.pk === "CR");
    expect(stored?.addUserArns).toEqual([AYAKA]);
    expect(stored?.removeUserArns).toEqual([TOMAS]);
    expect(stored?.status).toBe("draft");
  });

  it("FR-4.5: 状態更新は凍結入力の項目を書き換えない（再反映が同じ入力で行える担保）", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-0142" } })
      .resolves({
        Item: {
          pk: "CR",
          sk: "CR#cr-0142",
          itemType: "ChangeRequest",
          changeRequestId: "cr-0142",
          poolId: POOL_ID,
          roleArn: DEPLOY,
          addUserArns: [AYAKA],
          removeUserArns: [],
          status: "draft",
          createdAt: NOW,
          appliedAt: null,
          result: null,
        },
      });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    await discardChangeRequest("cr-0142", NOW);

    const expression = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input
      .UpdateExpression as string;
    expect(expression).not.toContain("addUserArns");
    expect(expression).not.toContain("removeUserArns");
  });

  it("エッジケース: 変更 0 件のロールは申請を作らず no-changes として除外される", async () => {
    stubReads({ assignments: [assignmentItem(AYAKA, DEPLOY, true, true)] });

    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, null);

    expect(result.created).toEqual([]);
    expect(result.excluded).toEqual([
      { roleArn: DEPLOY, reason: "no-changes", changeRequestId: null },
    ]);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("エッジケース: 本体の書き込みに失敗したらロックを補償削除し、失敗を握り潰さない", async () => {
    stubReads({ assignments: [assignmentItem(AYAKA, DEPLOY, true, false)] });
    ddbMock.on(PutCommand, { Item: { pk: `ROLELOCK#${DEPLOY}` } }).resolves({});
    ddbMock
      .on(PutCommand, { Item: { pk: "CR" } })
      .rejects(Object.assign(new Error("boom"), { name: "InternalServerError" }));
    ddbMock.on(DeleteCommand).resolves({});

    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, null);

    expect(result.created).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.roleArn).toBe(DEPLOY);
    // 補償削除でロックが解放されている
    expect(
      ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key,
    ).toEqual({ pk: `ROLELOCK#${DEPLOY}`, sk: "UNREFLECTED" });
  });

  it("作成した下書きに、作成者（createdBy）を保存する。反映者はまだ無い（Issue #120）", async () => {
    stubReads({ assignments: [assignmentItem(AYAKA, DEPLOY, true, false)] });
    ddbMock.on(PutCommand).resolves({});

    const alice = { name: "alice", sub: "user-1" };
    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, alice);

    expect(result.created[0]).toMatchObject({ createdBy: alice, appliedBy: null });
    const stored = ddbMock
      .commandCalls(PutCommand)
      .map((call) => call.args[0].input.Item)
      .find((item) => item?.pk === "CR");
    expect(stored?.createdBy).toEqual(alice);
  });

  it("実行者が分からなければ createdBy は null（申請は作れる）", async () => {
    stubReads({ assignments: [assignmentItem(AYAKA, DEPLOY, true, false)] });
    ddbMock.on(PutCommand).resolves({});

    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, null);

    expect(result.created[0]?.createdBy).toBeNull();
  });
});

describe("申請の破棄（FR-4.8）", () => {
  function changeRequestItemOf(status: string) {
    return {
      pk: "CR",
      sk: "CR#cr-0142",
      itemType: "ChangeRequest",
      changeRequestId: "cr-0142",
      poolId: POOL_ID,
      roleArn: DEPLOY,
      addUserArns: [AYAKA],
      removeUserArns: [],
      status,
      createdAt: NOW,
      appliedAt: null,
      result: null,
    };
  }

  function stubChangeRequest(status: string): void {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-0142" } })
      .resolves({ Item: changeRequestItemOf(status) });
  }

  it("破棄は、claim の無い下書き・失敗にだけ書く（unclaimed の guard。Issue #121）", async () => {
    stubChangeRequest("draft");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    await discardChangeRequest("cr-0142", NOW);

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toContain("#applyingUntil < :now");
    expect(input?.ExpressionAttributeValues?.[":now"]).toBe(NOW);
  });

  it("反映中（claim 中）の申請の破棄は ConflictError で、ロックを解放しない", async () => {
    stubChangeRequest("draft");
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("別の管理者が反映中"),
    });
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("反映中の破棄の 409 は changeRequest.applyingByOther の ID を持つ（Issue #94）", async () => {
    stubChangeRequest("draft");
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toMatchObject({
      code: "Conflict",
      localized: { id: "changeRequest.applyingByOther", params: {} },
      message: "この申請は別の管理者が反映中です。しばらくしてから、もう一度操作してください。",
    });
  });

  it("破棄できない状態の 400 は changeRequest.discardRefused と status を持つ（Issue #94）", async () => {
    stubChangeRequest("applied");

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toMatchObject({
      field: "status",
      localized: { id: "changeRequest.discardRefused", params: { status: "applied" } },
      message: "状態「applied」の申請は破棄できません（破棄できるのは下書きまたは失敗のみ）",
    });
  });

  it("存在しない申請の破棄は changeRequest.notFound の ID を持つ（Issue #94）", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(discardChangeRequest("cr-missing", NOW)).rejects.toMatchObject({
      localized: { id: "changeRequest.notFound", params: { changeRequestId: "cr-missing" } },
    });
  });

  it("読んだ後に別の管理者が先に破棄・反映していたら、従来どおり「破棄できません」になる", async () => {
    // 1 回目の読み取りは下書き、書き込みの条件に外れた後の読み直しは反映済み。
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-0142" } })
      .resolvesOnce({ Item: changeRequestItemOf("draft") })
      .resolves({ Item: changeRequestItemOf("applied") });
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toThrow(/破棄できません/);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("条件に外れた後の読み直しは、強い整合性で行う", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-0142" } })
      .resolves({ Item: changeRequestItemOf("draft") });
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toMatchObject({ statusCode: 409 });

    const reads = ddbMock.commandCalls(GetCommand).map((call) => call.args[0].input);
    expect(reads.some((input) => input.ConsistentRead === true)).toBe(true);
  });

  it("破棄すると状態「破棄」で残り、FR-4.6 のロールロックが解ける", async () => {
    stubChangeRequest("failed");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.changeRequest.status).toBe("discarded");
    expect(result.lockReleased).toBe(true);
    expect(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: `ROLELOCK#${DEPLOY}`,
      sk: "UNREFLECTED",
    });
  });

  it("B-1: 破棄が確定した後にロック解放が失敗しても、破棄失敗としては返さない", async () => {
    stubChangeRequest("draft");
    ddbMock.on(UpdateCommand).resolves({});
    // ロック解放（DeleteItem）だけが DynamoDB の一時障害で失敗する。
    ddbMock
      .on(DeleteCommand)
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    // 例外にしない。投げると HTTP 層が 502 を返し、記録は「破棄」なのに
    // 利用者には「破棄できませんでした」と伝わる（記録と表示の食い違い）。
    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.changeRequest.status).toBe("discarded");
    expect(result.lockReleased).toBe(false);
    // 漏れたロックは握り潰さず呼び出し側（画面）へ伝える。
    expect(result.lockWarning).toContain("新しい申請は作成できません");

    // 「破棄」の記録は 1 回だけ。取り消しも上書きもされていない。
    const statuses = ddbMock
      .commandCalls(UpdateCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[":status"]);
    expect(statuses).toEqual(["discarded"]);
  });

  it("エッジケース: 別の申請がロックを保持していた場合は警告を出さない（正常な状態）", async () => {
    stubChangeRequest("failed");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());

    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.changeRequest.status).toBe("discarded");
    expect(result.lockReleased).toBe(false);
    expect(result.lockWarning).toBeNull();
  });

  it("エッジケース: 反映済みの申請は破棄できない", async () => {
    stubChangeRequest("applied");

    await expect(discardChangeRequest("cr-0142", NOW)).rejects.toThrow(/破棄できません/);
  });

  it("エッジケース: 存在しない申請の破棄は 404 相当のエラーになる", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(discardChangeRequest("cr-missing", NOW)).rejects.toThrow(/見つかりません/);
  });

  it("破棄は、既存の作成者・反映者を書き換えない（失敗の申請を破棄しても、誰が試みたかが残る）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-failed" } }).resolves({
      Item: {
        pk: "CR",
        sk: "CR#cr-failed",
        itemType: "ChangeRequest",
        changeRequestId: "cr-failed",
        poolId: POOL_ID,
        roleArn: DEPLOY,
        addUserArns: [AYAKA],
        removeUserArns: [],
        status: "failed",
        createdAt: NOW,
        createdBy: { name: "alice" },
        appliedAt: NOW,
        appliedBy: { name: "bob" },
        result: { ok: false, message: "ng", errorCode: "AccessDenied" },
      },
    });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    const { changeRequest } = await discardChangeRequest("cr-failed", NOW);

    expect(changeRequest).toMatchObject({
      status: "discarded",
      createdBy: { name: "alice" },
      appliedBy: { name: "bob" },
    });
    const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.ExpressionAttributeValues?.[":appliedBy"]).toEqual({ name: "bob" });
  });
});

describe("200 応答の失敗・警告の文言の ID（Issue #94）", () => {
  function stubChangeRequest(status: string): void {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-0142" } }).resolves({
      Item: {
        pk: "CR",
        sk: "CR#cr-0142",
        itemType: "ChangeRequest",
        changeRequestId: "cr-0142",
        poolId: POOL_ID,
        roleArn: DEPLOY,
        addUserArns: [AYAKA],
        removeUserArns: [],
        status,
        createdAt: NOW,
        appliedAt: null,
        result: null,
      },
    });
  }

  it("申請の保存に失敗したロールは、例外の localized を運び、message はその日本語の描画", async () => {
    stubReads({ assignments: [assignmentItem(AYAKA, DEPLOY, true, false)] });
    ddbMock.on(PutCommand, { Item: { pk: `ROLELOCK#${DEPLOY}` } }).resolves({});
    ddbMock
      .on(PutCommand, { Item: { pk: "CR" } })
      .rejects(Object.assign(new Error("boom"), { name: "InternalServerError" }));
    ddbMock.on(DeleteCommand).resolves({});

    const result = await createChangeRequests(POOL_ID, [DEPLOY], NOW, null);

    const [failure] = result.failures;
    expect(failure?.localized?.id).toBe("storage.operationFailed");
    expect(failure?.message).toBe(renderMessage("ja", failure!.localized!));
  });

  it("破棄後にロックの解放が失敗したら changeRequest.lockReleaseFailed。lockWarning はその日本語の描画", async () => {
    stubChangeRequest("draft");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock
      .on(DeleteCommand)
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.localizedLockWarning?.id).toBe("changeRequest.lockReleaseFailed");
    expect(result.lockWarning).toBe(renderMessage("ja", result.localizedLockWarning!));
    expect(renderMessage("en", result.localizedLockWarning!)).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(result.lockWarning).toContain("新しい申請は作成できません");
  });

  it("別の申請がロックを保持していたときは、警告も localized も null", async () => {
    stubChangeRequest("failed");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());

    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.lockWarning).toBeNull();
    expect(result.localizedLockWarning).toBeNull();
  });

  it("ロックを解放できたときも localizedLockWarning は null", async () => {
    stubChangeRequest("failed");
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    const result = await discardChangeRequest("cr-0142", NOW);

    expect(result.lockWarning).toBeNull();
    expect(result.localizedLockWarning).toBeNull();
  });
});
