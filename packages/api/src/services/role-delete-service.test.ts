import { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { renderMessage } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, StorageError } from "../errors.js";
import { TEST_POOL_ID, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { blockerMessage, deleteRole } from "./role-delete-service.js";

const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const NOW = "2026-10-02T00:00:00.000Z";

const ROLE_KEY = { pk: "ROLE", sk: `ROLE#${DEPLOY}` };
const LINK_KEY = { pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${DEPLOY}` };
const LOCK_KEY = { pk: `ROLELOCK#${DEPLOY}`, sk: "UNREFLECTED" };

function stubRole(): void {
  ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
    Item: { ...ROLE_KEY, itemType: "IamRole", accountId: "555566667777", roleName: "DeployProd", arn: DEPLOY, createdAt: NOW },
  });
}

function stubLock(status: "draft" | "failed"): void {
  ddbMock.on(GetCommand, { Key: LOCK_KEY }).resolves({
    Item: { ...LOCK_KEY, itemType: "RoleLock", roleArn: DEPLOY, changeRequestId: "cr-0142", status, createdAt: NOW },
  });
}

function stubLinks(roleArns: string[]): void {
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ROLE#" } })
    .resolves({
      Items: roleArns.map((roleArn) => ({
        pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: TEST_POOL_ID, roleArn, createdAt: NOW,
      })),
    });
}

function stubAssignments(
  cells: { userArn: string; roleArn: string; checked: boolean; reflected: boolean }[],
): void {
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ASSIGN#" } })
    .resolves({
      Items: cells.map(({ userArn, roleArn, checked, reflected }) => ({
        pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${userArn}#${roleArn}`, itemType: "Assignment",
        poolId: TEST_POOL_ID, userArn, roleArn, checked, reflected, updatedAt: NOW,
      })),
    });
}

function deletedKeys(): unknown[] {
  return ddbMock.commandCalls(DeleteCommand).map((call) => call.args[0].input.Key);
}

beforeEach(() => {
  setupDdbMock();
  // 既定を先に置き、テストごとの stub を後から重ねる（後に定義したものが優先される）。
  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(DeleteCommand).resolves({});
  stubRole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteRole の判定（FR-2.4 / Issue #22。Issue #135 で、拒否は未反映の申請だけ）", () => {
  it("登録が無ければ NotFoundError で、何も消さない", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({});

    await expect(deleteRole(DEPLOY)).rejects.toBeInstanceOf(NotFoundError);
    expect(deletedKeys()).toHaveLength(0);
  });

  it("ユーザプールに紐づいていても、削除できる（Issue #135。紐づきは拒否の理由にしない）", async () => {
    stubLinks([DEPLOY]);

    await expect(deleteRole(DEPLOY)).resolves.toEqual({ roleArn: DEPLOY, removedAssignments: 0 });
  });

  it("未反映の申請（下書き）があれば 409 で、申請履歴での直し方を示し、何も消さない", async () => {
    stubLock("draft");

    const error = await deleteRole(DEPLOY).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toBe(
      "DeployProd を削除できません。未反映の申請（下書き）があります。申請履歴で反映するか破棄してください。",
    );
    expect((error as ConflictError).localized).toEqual({
      id: "role.deleteBlocked",
      params: { roleName: "DeployProd", status: "draft" },
    });
    expect(deletedKeys()).toHaveLength(0);
  });

  it("紐づいていて、未反映の申請（失敗）もあれば、申請の理由だけを返し、何も消さない", async () => {
    stubLock("failed");
    stubLinks([DEPLOY]);

    const error = await deleteRole(DEPLOY).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "DeployProd を削除できません。未反映の申請（失敗）があります。申請履歴で反映するか破棄してください。",
    );
    expect((error as ConflictError).localized).toEqual({
      id: "role.deleteBlocked",
      params: { roleName: "DeployProd", status: "failed" },
    });
    expect(deletedKeys()).toHaveLength(0);
  });
});

describe("blockerMessage（Issue #94。純粋な関数）", () => {
  const lock = (status: "draft" | "failed") => ({ roleArn: DEPLOY, changeRequestId: "cr-0142", status, createdAt: NOW });

  it("ロックの状態が failed なら failed、それ以外は draft を引数にする", () => {
    expect(blockerMessage("DeployProd", lock("failed"))).toEqual({
      id: "role.deleteBlocked",
      params: { roleName: "DeployProd", status: "failed" },
    });
    expect(blockerMessage("DeployProd", lock("draft"))).toEqual({
      id: "role.deleteBlocked",
      params: { roleName: "DeployProd", status: "draft" },
    });
  });

  it("en の描画に、状態と直し方が入る", () => {
    expect(renderMessage("en", blockerMessage("DeployProd", lock("failed")))).toBe(
      "DeployProd cannot be deleted. It has an unapplied request (failed). Apply or discard it on the request history screen.",
    );
  });
});

describe("deleteRole の後片付け（spec D-5・D-6）", () => {
  it("紐づけ → このロールの交点 → IamRole の順に消す（IamRole が最後。RoleLinkOwner は触らない）", async () => {
    stubLinks([DEPLOY, AUDIT]);
    stubAssignments([
      { userArn: AYAKA, roleArn: DEPLOY, checked: false, reflected: true },
      { userArn: AYAKA, roleArn: AUDIT, checked: true, reflected: true },
      { userArn: KENJI, roleArn: DEPLOY, checked: true, reflected: false },
    ]);

    const result = await deleteRole(DEPLOY);

    expect(result).toEqual({ roleArn: DEPLOY, removedAssignments: 2 });
    expect(deletedKeys()).toEqual([
      LINK_KEY,
      { pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${AYAKA}#${DEPLOY}` },
      { pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${KENJI}#${DEPLOY}` },
      ROLE_KEY,
    ]);
    expect(deletedKeys().some((key) => String((key as { pk: string }).pk).startsWith("ROLELINK#"))).toBe(false);
  });

  it("交点が無ければ、紐づけと IamRole だけを消す", async () => {
    const result = await deleteRole(DEPLOY);

    expect(result).toEqual({ roleArn: DEPLOY, removedAssignments: 0 });
    expect(deletedKeys()).toEqual([LINK_KEY, ROLE_KEY]);
  });

  it("交点の削除に失敗したら、IamRole を消さずに再試行可の StorageError を返す（再実行で続きから片付く）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubAssignments([{ userArn: AYAKA, roleArn: DEPLOY, checked: false, reflected: true }]);
    ddbMock
      .on(DeleteCommand, { Key: { pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${AYAKA}#${DEPLOY}` } })
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const error = await deleteRole(DEPLOY).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).retryable).toBe(true);
    expect((error as StorageError).localized).toEqual({
      id: "storage.roleDeletePartial",
      params: { roleName: "DeployProd" },
    });
    expect((error as StorageError).message).toBe(
      "DeployProd の削除が途中で失敗しました。ロールの登録は残っています。もう一度削除すると、続きから片付きます。",
    );
    // 紐づけは先に消えている（マトリクスの列から外れる）。IamRole は残るので、もう一度削除できる。
    expect(deletedKeys()).toContainEqual(LINK_KEY);
    expect(deletedKeys()).not.toContainEqual(ROLE_KEY);
    expect(console.error).toHaveBeenCalled();
  });
});
