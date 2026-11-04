import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { putReflectedAssignment } from "./assignment.js";

const POOL_ID = "platform-team";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const NOW = "2026-09-30T00:00:00.000Z";

beforeEach(() => {
  setupDdbMock();
});

describe("信頼ポリシーから取り込んだ交点の書き込み（Issue #80）", () => {
  it("checked = reflected = true の交点を、条件なしで Put する", async () => {
    ddbMock.on(PutCommand).resolves({});

    await putReflectedAssignment(POOL_ID, AYAKA, DEPLOY, NOW);

    expect(ddbMock.calls()).toHaveLength(1);
    const input = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    // 再実行で同じ値に書き直すので、条件は付けない。
    expect(input?.ConditionExpression).toBeUndefined();
    expect(input?.Item).toEqual({
      pk: `POOL#${POOL_ID}`,
      sk: `ASSIGN#${AYAKA}#${DEPLOY}`,
      itemType: "Assignment",
      poolId: POOL_ID,
      userArn: AYAKA,
      roleArn: DEPLOY,
      checked: true,
      reflected: true,
      updatedAt: NOW,
    });
  });

  it("失敗は握りつぶさず、StorageError にする", async () => {
    ddbMock.on(PutCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(putReflectedAssignment(POOL_ID, AYAKA, DEPLOY, NOW)).rejects.toMatchObject({
      statusCode: 502,
      retryable: true,
    });
  });
});
