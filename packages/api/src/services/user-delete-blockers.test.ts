import { describe, expect, it } from "vitest";

import type { PendingRequest } from "./user-delete-blockers.js";
import { computeUserDeleteBlockers } from "./user-delete-blockers.js";

const POOL_ID = "platform-team";
const OTHER_POOL_ID = "data-team";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";

function request(overrides: Partial<PendingRequest>): PendingRequest {
  return {
    changeRequestId: "cr-1",
    poolId: POOL_ID,
    roleArn: DEPLOY,
    addUserArns: [],
    removeUserArns: [],
    ...overrides,
  };
}

function compute(input: {
  assignments?: { userArn: string; roleArn: string; checked: boolean; reflected: boolean }[];
  pendingRequests?: PendingRequest[];
}) {
  return computeUserDeleteBlockers({
    poolId: POOL_ID,
    userArn: AYAKA,
    assignments: input.assignments ?? [],
    pendingRequests: input.pendingRequests ?? [],
  });
}

describe("computeUserDeleteBlockers（Issue #44）", () => {
  it("reflected の交点のロールを返す。チェックを外して未反映のもの（checked=false）も含む", () => {
    const blockers = compute({
      assignments: [
        { userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: true },
        { userArn: AYAKA, roleArn: AUDIT, checked: false, reflected: true },
      ],
    });

    expect(blockers.reflectedRoleArns).toEqual([DEPLOY, AUDIT]);
  });

  it("チェックありで未反映の交点は信頼ポリシーに入っていないので拒否の理由にしない", () => {
    const blockers = compute({
      assignments: [{ userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: false }],
    });

    expect(blockers).toEqual({ reflectedRoleArns: [], changeRequestIds: [] });
  });

  it("ほかのユーザの交点は数えない", () => {
    const blockers = compute({
      assignments: [{ userArn: KENJI, roleArn: DEPLOY, checked: true, reflected: true }],
    });

    expect(blockers.reflectedRoleArns).toEqual([]);
  });

  it("このプールの未反映の申請の追加・削除のどちらかに名前があれば、その申請を返す", () => {
    const blockers = compute({
      pendingRequests: [
        request({ changeRequestId: "cr-add", roleArn: DEPLOY, addUserArns: [AYAKA] }),
        request({ changeRequestId: "cr-remove", roleArn: AUDIT, removeUserArns: [AYAKA] }),
      ],
    });

    expect(blockers.changeRequestIds).toEqual(["cr-add", "cr-remove"]);
  });

  it("名前の無い申請と、ほかのプールから作った申請は数えない", () => {
    const blockers = compute({
      pendingRequests: [
        request({ changeRequestId: "cr-kenji", addUserArns: [KENJI] }),
        request({ changeRequestId: "cr-other", poolId: OTHER_POOL_ID, addUserArns: [AYAKA] }),
      ],
    });

    expect(blockers.changeRequestIds).toEqual([]);
  });
});
