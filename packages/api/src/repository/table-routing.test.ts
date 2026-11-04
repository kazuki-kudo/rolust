import { BatchGetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  TEST_CHANGE_REQUEST_TABLE_NAME,
  TEST_STATE_TABLE_NAME,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import { listAssignments, putReflectedAssignment } from "./assignment.js";
import { getRoleLocks, listChangeRequests } from "./change-request.js";
import { addUserIfAbsent, listUsers } from "./pool.js";
import { listRoleLinks } from "./pool-role-link.js";
import { listRoles } from "./role.js";

/**
 * テーブルの振り分け（Issue #36。spec D-1 / D-5）。
 * 状態（UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner）は状態テーブル、
 * 申請（ChangeRequest・RoleLock）は申請テーブルに送る。
 */

const ROLE = "arn:aws:iam::555566667777:role/DeployProd";

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
});

function queriedTable(): string | undefined {
  return ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.TableName;
}

function batchTables(): string[] {
  return Object.keys(ddbMock.commandCalls(BatchGetCommand)[0]?.args[0].input.RequestItems ?? {});
}

describe("テーブルの振り分け（Issue #36）", () => {
  it.each([
    ["listUsers", () => listUsers("a-pool")],
    ["listAssignments", () => listAssignments("a-pool")],
    ["listRoles", () => listRoles()],
    ["listRoleLinks", () => listRoleLinks("a-pool")],
  ])("%s は状態テーブルを読む", async (_name, run) => {
    await run();
    expect(queriedTable()).toBe(TEST_STATE_TABLE_NAME);
  });

  it("listChangeRequests は申請テーブルを読む", async () => {
    await listChangeRequests();
    expect(queriedTable()).toBe(TEST_CHANGE_REQUEST_TABLE_NAME);
  });

  it("getRoleLocks は申請テーブルを BatchGet する", async () => {
    await getRoleLocks([ROLE]);
    expect(batchTables()).toEqual([TEST_CHANGE_REQUEST_TABLE_NAME]);
  });
});

describe("テーブルの振り分け: 取り込みの書き込み（Issue #80）", () => {
  it.each([
    ["addUserIfAbsent", () => addUserIfAbsent("a-pool", "111122223333", "ayaka.mori", "2026-09-30T00:00:00.000Z")],
    [
      "putReflectedAssignment",
      () => putReflectedAssignment("a-pool", "arn:aws:iam::111122223333:user/ayaka.mori", ROLE, "2026-09-30T00:00:00.000Z"),
    ],
  ])("%s は状態テーブルへ書く", async (_name, run) => {
    ddbMock.on(PutCommand).resolves({});

    await run();

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.TableName).toBe(TEST_STATE_TABLE_NAME);
  });
});
