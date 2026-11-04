import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";

import { createHandler } from "../http.js";
import { TEST_CHANGE_REQUEST_TABLE_NAME, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { matrixRoutes } from "./matrix.js";

const POOL_ID = "platform-team";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const NOW = "2026-09-25T00:00:00.000Z";

function event(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET", path: `/api/pool/matrix`, headers: {}, multiValueHeaders: {},
    queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null,
    stageVariables: null, body: null, isBase64Encoded: false, resource: "/{proxy+}",
    requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  };
}
/** 交点の保存が確かめる「プールに登録済み」の状態を作る（Issue #194）。 */
function registerUser(userArn: string): void {
  ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `USER#${userArn}` } }).resolves({
    Item: {
      pk: `POOL#${POOL_ID}`, sk: `USER#${userArn}`, itemType: "IamUser", poolId: POOL_ID,
      accountId: userArn.split(":")[4], userName: userArn.split("/")[1], arn: userArn, createdAt: NOW,
    },
  });
}

/** 登録の無い状態（`getUser` が null を返す）を作る（Issue #194）。 */
function unregisterUser(userArn: string): void {
  ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `USER#${userArn}` } }).resolves({});
}

function roleItem(arn: string) {
  return { pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole", accountId: "555566667777", roleName: arn.split("/")[1], arn, createdAt: NOW };
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: "META" } }).resolves({
    Item: { pk: `POOL#${POOL_ID}`, sk: "META", itemType: "UserPool", poolId: POOL_ID, createdAt: NOW },
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE" } }).resolves({ Items: [roleItem(DEPLOY), roleItem(AUDIT)] });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ROLE#" } })
    .resolves({ Items: [{ pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn: DEPLOY, createdAt: NOW }] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "USER#" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ASSIGN#" } }).resolves({
    Items: [
      { pk: `POOL#${POOL_ID}`, sk: `ASSIGN#${AYAKA}#${DEPLOY}`, itemType: "Assignment", poolId: POOL_ID, userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: false, updatedAt: NOW },
      { pk: `POOL#${POOL_ID}`, sk: `ASSIGN#${AYAKA}#${AUDIT}`, itemType: "Assignment", poolId: POOL_ID, userArn: AYAKA, roleArn: AUDIT, checked: false, reflected: false, updatedAt: NOW },
    ],
  });
  ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
});

describe("マトリクスの列は紐づけたロールだけ（FR-3.1 / FR-1.7）", () => {
  it("GET は紐づけ済みのロールとその交点だけを返す", async () => {
    const response = await createHandler(matrixRoutes)(event({}));
    const body = JSON.parse(response.body) as { roles: { arn: string }[]; assignments: { roleArn: string }[] };

    expect(body.roles.map((role) => role.arn)).toEqual([DEPLOY]);
    expect(body.assignments.map((assignment) => assignment.roleArn)).toEqual([DEPLOY]);
  });

  it("GET の roles は、紐づけの position 順に返す（ARN 昇順ではない）", async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ROLE#" } })
      .resolves({
        Items: [
          { pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn: DEPLOY, createdAt: NOW, position: 1 },
          { pk: `POOL#${POOL_ID}`, sk: `ROLE#${AUDIT}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn: AUDIT, createdAt: NOW, position: 0 },
        ],
      });

    const response = await createHandler(matrixRoutes)(event({}));
    const body = JSON.parse(response.body) as { roles: { arn: string }[] };

    expect(body.roles.map((role) => role.arn)).toEqual([AUDIT, DEPLOY]);
  });

  it("GET の users は、プールの属性列に無い columnId の値を含めない（Issue #61）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: "META" } }).resolves({
      Item: { pk: `POOL#${POOL_ID}`, sk: "META", itemType: "UserPool", poolId: POOL_ID, createdAt: NOW, attributeColumns: [{ columnId: "c1", name: "名前" }] },
    });
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "USER#" } }).resolves({
      Items: [{ pk: `POOL#${POOL_ID}`, sk: `USER#${AYAKA}`, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: AYAKA, createdAt: NOW, attributes: { c1: "森", gone: "消えた列" } }],
    });

    const response = await createHandler(matrixRoutes)(event({}));
    const body = JSON.parse(response.body) as { users: { attributes: Record<string, string> }[] };

    expect(body.users[0]?.attributes).toEqual({ c1: "森" });
  });

  it("PUT は紐づけていないロールの割り当てを 409 で拒否し、保存しない", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${AUDIT}` } }).resolves({});

    const response = await createHandler(matrixRoutes)(
      event({
        httpMethod: "PUT",
        path: `/api/pool/assignments`,
        body: JSON.stringify({ userArn: AYAKA, roleArn: AUDIT, checked: true }),
      }),
    );

    expect(response.statusCode).toBe(409);
    const { message } = JSON.parse(response.body) as { message: string };
    expect(message).toMatch(/ReadOnlyAudit はユーザプールに紐づいていません/);
    // 「ロールの紐づけ」は廃止した（Issue #135）。直し方は、削除して登録し直すこと（登録が紐づけと取り込みを行う）。
    expect(message).not.toContain("「ロールの紐づけ」");
    expect(message).toContain("IAM ロールを削除して登録し直してください");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PUT は紐づけたロールなら保存する", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}` } }).resolves({ Item: { roleArn: DEPLOY } });
    registerUser(AYAKA);
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { poolId: POOL_ID, userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: false, updatedAt: NOW },
    });

    const response = await createHandler(matrixRoutes)(
      event({
        httpMethod: "PUT",
        path: `/api/pool/assignments`,
        body: JSON.stringify({ userArn: AYAKA, roleArn: DEPLOY, checked: true }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});

/**
 * 交点の保存は、プールに登録済みの IamUser だけを受け付ける（FR-3.2 の注記。Issue #194）。
 *
 * 登録の入口（`POST /pool/users`）が許可リスト（FR-1.11）とユーザ名の規則を検証するので、
 * 「登録済みである」ことの確認がその両方を継承する。ここを開けると、許可リストに無い
 * アカウントの principal が凍結入力に入り、反映で信頼ポリシーに書かれる。
 */
describe("交点の保存は登録済みのユーザだけ（FR-3.2 の注記。Issue #194）", () => {
  const OUTSIDER = "arn:aws:iam::999988887777:user/outsider";

  function putEvent(userArn: string): APIGatewayProxyEvent {
    return event({
      httpMethod: "PUT",
      path: `/api/pool/assignments`,
      body: JSON.stringify({ userArn, roleArn: DEPLOY, checked: true }),
    });
  }

  beforeEach(() => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}` } }).resolves({ Item: { roleArn: DEPLOY } });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { poolId: POOL_ID, userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: false, updatedAt: NOW },
    });
  });

  it("プールに居ないユーザの ARN は 409 で拒否し、何も書かない", async () => {
    unregisterUser(OUTSIDER);

    const response = await createHandler(matrixRoutes)(putEvent(OUTSIDER));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).message).toContain("登録されていません");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("ユーザ名がワイルドカードの ARN も、登録が無いので拒否する", async () => {
    unregisterUser("arn:aws:iam::999988887777:user/*");

    const response = await createHandler(matrixRoutes)(putEvent("arn:aws:iam::999988887777:user/*"));

    expect(response.statusCode).toBe(409);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("登録済みなら保存する", async () => {
    registerUser(AYAKA);

    const response = await createHandler(matrixRoutes)(putEvent(AYAKA));

    expect(response.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});

describe("未反映の変更の取り消し（Issue #88 / FR-3.2）", () => {
  const CHANGED_USER = "arn:aws:iam::111122223333:user/hiroshi.ito";
  const POOL_PK = `POOL#${POOL_ID}`;

  function revertEvent(): APIGatewayProxyEvent {
    return event({ httpMethod: "POST", path: `/api/pool/assignments/revert`, body: "{}" });
  }

  function assignmentItem(userArn: string, roleArn: string, checked: boolean, reflected: boolean) {
    return { pk: POOL_PK, sk: `ASSIGN#${userArn}#${roleArn}`, itemType: "Assignment", poolId: POOL_ID, userArn, roleArn, checked, reflected, updatedAt: NOW };
  }

  /** DEPLOY だけでなく AUDIT も紐づけた状態にする（beforeEach は DEPLOY だけ）。 */
  function linkBoth(): void {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "ROLE#" } })
      .resolves({
        Items: [DEPLOY, AUDIT].map((roleArn) => ({ pk: POOL_PK, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn, createdAt: NOW })),
      });
  }

  function setAssignments(items: ReturnType<typeof assignmentItem>[]): void {
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "ASSIGN#" } }).resolves({ Items: items });
  }

  it("checked と reflected が食い違う交点だけを reflected にそろえ、reflected は書き換えない", async () => {
    setAssignments([
      assignmentItem(AYAKA, DEPLOY, true, false),
      assignmentItem(CHANGED_USER, DEPLOY, false, true),
      assignmentItem("arn:aws:iam::111122223333:user/same", DEPLOY, true, true),
    ]);
    ddbMock.on(UpdateCommand).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reverted: 2, skippedRoleArns: [], failures: [] });
    const updates = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input);
    expect(updates.map((input) => input.Key?.sk).sort()).toEqual(
      [`ASSIGN#${AYAKA}#${DEPLOY}`, `ASSIGN#${CHANGED_USER}#${DEPLOY}`].sort(),
    );
    for (const input of updates) {
      expect(input.UpdateExpression).toContain("#checked = #reflected");
      // reflected は動かさない（反映処理だけが動かす）。
      expect(input.UpdateExpression).not.toMatch(/#reflected\s*=/);
      // 並行して変わった交点を上書きしない。
      expect(input.ConditionExpression).toContain("#checked <> #reflected");
    }
  });

  it("未反映の申請（ロック）があるロールの交点には触れず、skippedRoleArns に返す", async () => {
    linkBoth();
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false), assignmentItem(AYAKA, AUDIT, true, false)]);
    ddbMock.on(BatchGetCommand).resolves({
      Responses: {
        [TEST_CHANGE_REQUEST_TABLE_NAME]: [
          { pk: `ROLELOCK#${AUDIT}`, sk: "LOCK", itemType: "RoleLock", roleArn: AUDIT, changeRequestId: "cr-1", status: "draft", createdAt: NOW },
        ],
      },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(JSON.parse(response.body)).toEqual({ reverted: 1, skippedRoleArns: [AUDIT], failures: [] });
    expect(ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input.Key?.sk)).toEqual([`ASSIGN#${AYAKA}#${DEPLOY}`]);
  });

  it("紐づけていないロールの交点には触れない（FR-1.7）", async () => {
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false), assignmentItem(AYAKA, AUDIT, true, false)]);
    ddbMock.on(UpdateCommand).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(JSON.parse(response.body).reverted).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input.Key?.sk)).toEqual([`ASSIGN#${AYAKA}#${DEPLOY}`]);
  });

  it("読んだ後に別の操作で食い違いが解消した交点（条件不一致）は失敗に数えない", async () => {
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false), assignmentItem(CHANGED_USER, DEPLOY, true, false)]);
    const conflict = Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
    ddbMock.on(UpdateCommand).rejectsOnce(conflict).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ reverted: 1, failures: [] });
  });

  it("一部の保存に失敗したら握りつぶさず failures に返し、残りは戻す（やり直せる）", async () => {
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false), assignmentItem(CHANGED_USER, DEPLOY, true, false)]);
    const throttled = Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" });
    ddbMock.on(UpdateCommand).rejectsOnce(throttled).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { reverted: number; failures: { userArn: string; roleArn: string; message: string }[] };
    expect(body.reverted).toBe(1);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.roleArn).toBe(DEPLOY);
    expect(body.failures[0]?.message).toMatch(/DynamoDB/);
  });

  it("失敗した交点は、例外の localized を運ぶ（StorageError の storage.operationFailed）。message はその日本語の描画", async () => {
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false)]);
    const throttled = Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" });
    ddbMock.on(UpdateCommand).rejects(throttled);

    const response = await createHandler(matrixRoutes)(revertEvent());

    const body = JSON.parse(response.body) as { failures: { message: string; localized?: { id: string } }[] };
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.localized?.id).toBe("storage.operationFailed");
    expect(body.failures[0]?.message).toMatch(/DynamoDB/);
  });

  it("ChangeRequest も IAM も作らない（Assignment の UpdateItem だけ）", async () => {
    setAssignments([assignmentItem(AYAKA, DEPLOY, true, false)]);
    ddbMock.on(UpdateCommand).resolves({});

    await createHandler(matrixRoutes)(revertEvent());

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.Key?.pk).toBe(POOL_PK);
  });

  it("固定プールの META が無くても、作ってから取り消す（404 にしない。Issue #108）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: "META" } }).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const response = await createHandler(matrixRoutes)(revertEvent());

    expect(response.statusCode).toBe(200);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ pk: POOL_PK, sk: "META" });
  });
});

describe("応答の localized（Issue #94）", () => {
  const put = (payload: unknown) =>
    createHandler(matrixRoutes)(
      event({ httpMethod: "PUT", path: "/api/pool/assignments", body: JSON.stringify(payload) }),
    );
  type ErrorBody = { message: string; field?: string; localized?: { id: string; params: unknown } };

  it("紐づけていないロールは matrix.roleNotLinked と roleName を返す", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${AUDIT}` } }).resolves({});

    const response = await put({ userArn: AYAKA, roleArn: AUDIT, checked: true });
    const body = JSON.parse(response.body) as ErrorBody;

    expect(response.statusCode).toBe(409);
    expect(body.localized).toEqual({ id: "matrix.roleNotLinked", params: { roleName: "ReadOnlyAudit" } });
    expect(body.message).toMatch(/^IAM ロール ReadOnlyAudit はユーザプールに紐づいていません。/);
  });

  it("userArn が IAM ユーザの ARN でなければ arn.notUserArn", async () => {
    const response = await put({ userArn: "nope", roleArn: AUDIT, checked: true });
    const body = JSON.parse(response.body) as ErrorBody;

    expect(response.statusCode).toBe(400);
    expect(body.field).toBe("userArn");
    expect(body.localized).toEqual({ id: "arn.notUserArn", params: { arn: "nope" } });
    expect(body.message).toBe("IAM ユーザの ARN ではありません: nope");
  });

  it("roleArn が IAM ロールの ARN でなければ arn.notRoleArn", async () => {
    const response = await put({ userArn: AYAKA, roleArn: "nope", checked: true });
    const body = JSON.parse(response.body) as ErrorBody;

    expect(response.statusCode).toBe(400);
    expect(body.field).toBe("roleArn");
    expect(body.localized).toEqual({ id: "arn.notRoleArn", params: { arn: "nope" } });
    expect(body.message).toBe("IAM ロールの ARN ではありません: nope");
  });
});
