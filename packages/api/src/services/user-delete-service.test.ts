import type { BatchGetCommandInput } from "@aws-sdk/lib-dynamodb";
import { BatchGetCommand, DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { renderMessage } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError } from "../errors.js";
import { TEST_CHANGE_REQUEST_TABLE_NAME, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { blockersMessage, deletePoolUser } from "./user-delete-service.js";

const POOL_ID = "platform-team";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const NOW = "2026-09-26T00:00:00.000Z";

function assignmentItem(userArn: string, roleArn: string, checked: boolean, reflected: boolean) {
  return {
    pk: `POOL#${POOL_ID}`, sk: `ASSIGN#${userArn}#${roleArn}`, itemType: "Assignment",
    poolId: POOL_ID, userArn, roleArn, checked, reflected, updatedAt: NOW,
  };
}

function stubAssignments(items: ReturnType<typeof assignmentItem>[]): void {
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ASSIGN#" } })
    .resolves({ Items: items });
  // deleteUser の連鎖削除が引く、そのユーザの交点だけのクエリ
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": `ASSIGN#${AYAKA}#` } })
    .resolves({
      Items: items.filter((item) => item.userArn === AYAKA).map(({ pk, sk }) => ({ pk, sk })),
    });
}

function stubLinks(arns: string[]): void {
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${POOL_ID}`, ":prefix": "ROLE#" } })
    .resolves({
      Items: arns.map((roleArn) => ({
        pk: `POOL#${POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn, createdAt: NOW,
      })),
    });
}

/** ロールロックと、その申請の本体をまとめて置く。 */
function stubPendingRequests(
  requests: { changeRequestId: string; roleArn: string; poolId?: string; add?: string[]; remove?: string[] }[],
): void {
  const locks = requests.map((request) => ({
    pk: `ROLELOCK#${request.roleArn}`, sk: "UNREFLECTED", itemType: "RoleLock",
    roleArn: request.roleArn, changeRequestId: request.changeRequestId, status: "draft", createdAt: NOW,
  }));
  ddbMock.on(BatchGetCommand).callsFake((input: BatchGetCommandInput) => {
    const keys = input.RequestItems?.[TEST_CHANGE_REQUEST_TABLE_NAME]?.Keys ?? [];
    const wanted = new Set(keys.map((key) => `${String(key.pk)}|${String(key.sk)}`));
    return { Responses: { [TEST_CHANGE_REQUEST_TABLE_NAME]: locks.filter((lock) => wanted.has(`${lock.pk}|${lock.sk}`)) } };
  });
  for (const request of requests) {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${request.changeRequestId}` } }).resolves({
      Item: {
        pk: "CR", sk: `CR#${request.changeRequestId}`, itemType: "ChangeRequest",
        changeRequestId: request.changeRequestId, poolId: request.poolId ?? POOL_ID, roleArn: request.roleArn,
        addUserArns: request.add ?? [], removeUserArns: request.remove ?? [], status: "draft", createdAt: NOW,
      },
    });
  }
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(DeleteCommand).resolves({});
  stubLinks([DEPLOY, AUDIT]);
  stubPendingRequests([]);
});

describe("deletePoolUser（FR-1.5 / Issue #44）", () => {
  it("反映済みの交点があれば 409 で拒否し、何も消さない", async () => {
    stubAssignments([assignmentItem(AYAKA, DEPLOY, false, true)]);

    const error = await deletePoolUser(POOL_ID, AYAKA).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain("DeployProd");
    expect((error as Error).message).toContain("チェックを外し、申請して反映してから");
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("このプールの未反映の申請の凍結入力に名前があれば 409 で拒否し、何も消さない", async () => {
    stubAssignments([assignmentItem(AYAKA, AUDIT, true, false)]);
    stubPendingRequests([{ changeRequestId: "cr-pending", roleArn: AUDIT, add: [AYAKA] }]);

    const error = await deletePoolUser(POOL_ID, AYAKA).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain("cr-pending");
    expect((error as Error).message).toContain("破棄してから");
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("チェックありで未反映の交点だけなら、連鎖削除して件数を返す", async () => {
    stubAssignments([assignmentItem(AYAKA, DEPLOY, true, false), assignmentItem(KENJI, DEPLOY, true, true)]);
    stubPendingRequests([{ changeRequestId: "cr-kenji", roleArn: DEPLOY, remove: [KENJI] }]);

    const removed = await deletePoolUser(POOL_ID, AYAKA);

    expect(removed).toBe(1);
    // Assignment 1 件 + IamUser 1 件
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(2);
  });
});

describe("user.deleteBlocked の文言（Issue #94）", () => {
  const REFLECTED_JA =
    "信頼ポリシーに反映済みの割り当てがあります（DeployProd、ReadOnlyAudit）。" +
    "削除しても信頼ポリシーには残り、マトリクスから見えなくなります。" +
    "マトリクスでチェックを外し、申請して反映してから削除してください。";
  const PENDING_JA =
    "このユーザを含む未反映の申請があります（cr-1、cr-2）。反映するか、申請履歴で破棄してから削除してください。";

  it("blockersMessage は、ユーザ名・ロール名・申請 ID を引数に持つ LocalizedMessage を返す（純粋な関数）", () => {
    expect(blockersMessage(AYAKA, { reflectedRoleArns: [DEPLOY, AUDIT], changeRequestIds: ["cr-1", "cr-2"] })).toEqual({
      id: "user.deleteBlocked",
      params: {
        userName: "ayaka.mori",
        roleNames: ["DeployProd", "ReadOnlyAudit"],
        changeRequestIds: ["cr-1", "cr-2"],
      },
    });
  });

  it("ja: 理由が反映済みの割り当てだけのとき、現行の describeBlockers と同じ文になる", () => {
    const message = blockersMessage(AYAKA, { reflectedRoleArns: [DEPLOY, AUDIT], changeRequestIds: [] });
    expect(renderMessage("ja", message)).toBe(`ayaka.mori を削除できません。${REFLECTED_JA}`);
  });

  it("ja: 理由が未反映の申請だけのとき、現行の describeBlockers と同じ文になる", () => {
    const message = blockersMessage(AYAKA, { reflectedRoleArns: [], changeRequestIds: ["cr-1", "cr-2"] });
    expect(renderMessage("ja", message)).toBe(`ayaka.mori を削除できません。${PENDING_JA}`);
  });

  it("ja: 理由が 2 つのとき、割り当て・申請の順に区切りなしで連結する", () => {
    const message = blockersMessage(AYAKA, { reflectedRoleArns: [DEPLOY, AUDIT], changeRequestIds: ["cr-1", "cr-2"] });
    expect(renderMessage("ja", message)).toBe(`ayaka.mori を削除できません。${REFLECTED_JA}${PENDING_JA}`);
  });

  it("en: 理由が 1 つのときも 2 つのときも、末尾の空白を残さない", () => {
    const reflected = blockersMessage(AYAKA, { reflectedRoleArns: [DEPLOY], changeRequestIds: [] });
    expect(renderMessage("en", reflected)).toBe(
      "ayaka.mori cannot be deleted. It has assignments already applied to the trust policy (DeployProd). " +
        "Deleting the user would leave them in the trust policy, invisible in the matrix. " +
        "Uncheck them in the matrix, create a request and apply it, then delete the user.",
    );
    const both = blockersMessage(AYAKA, { reflectedRoleArns: [DEPLOY, AUDIT], changeRequestIds: ["cr-1"] });
    expect(renderMessage("en", both)).toBe(
      "ayaka.mori cannot be deleted. It has assignments already applied to the trust policy (DeployProd, ReadOnlyAudit). " +
        "Deleting the user would leave them in the trust policy, invisible in the matrix. " +
        "Uncheck them in the matrix, create a request and apply it, then delete the user. " +
        "It is included in unapplied requests (cr-1). " +
        "Apply them, or discard them on the request history screen, then delete the user.",
    );
  });

  it("deletePoolUser の 409 は user.deleteBlocked を持ち、message は ja の描画と同じ", async () => {
    stubAssignments([assignmentItem(AYAKA, DEPLOY, false, true)]);

    const error = (await deletePoolUser(POOL_ID, AYAKA).catch((caught: unknown) => caught)) as ConflictError;

    expect(error.localized).toEqual({
      id: "user.deleteBlocked",
      params: { userName: "ayaka.mori", roleNames: ["DeployProd"], changeRequestIds: [] },
    });
    expect(error.message).toBe(renderMessage("ja", error.localized!));
  });
});
