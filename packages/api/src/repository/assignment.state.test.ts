import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { assignmentKey } from "../ddb/keys.js";
import { ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { setAssignmentState } from "./assignment.js";

beforeEach(() => setupDdbMock());

describe("setAssignmentState（Issue #172）", () => {
  it("checked と reflected を同じ値で、条件なしで書く", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await setAssignmentState("platform-team", "arn:aws:iam::1:user/a", "arn:aws:iam::2:role/R", true, "2026-10-16T00:00:00.000Z");

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual(assignmentKey("platform-team", "arn:aws:iam::1:user/a", "arn:aws:iam::2:role/R"));
    expect(input?.ConditionExpression).toBeUndefined();
    expect(input?.ExpressionAttributeValues).toMatchObject({ ":state": true });
    expect(input?.UpdateExpression).toContain("#checked = :state");
    expect(input?.UpdateExpression).toContain("#reflected = :state");
  });

  it("false も同じく checked と reflected の両方へ書く", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await setAssignmentState("platform-team", "arn:aws:iam::1:user/a", "arn:aws:iam::2:role/R", false, "2026-10-16T00:00:00.000Z");

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ExpressionAttributeValues).toMatchObject({ ":state": false });
  });
});
