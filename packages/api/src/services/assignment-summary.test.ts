import { describe, expect, it } from "vitest";

import type { AssignmentFlags } from "./assignment-summary.js";
import { summarizeAssignments } from "./assignment-summary.js";

const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const OTHER = "arn:aws:iam::555566667777:role/Other";

function flags(roleArn: string, checked: boolean, reflected: boolean): AssignmentFlags {
  return { roleArn, checked, reflected };
}

describe("summarizeAssignments（Issue #79・#135。削除の確認に出す、消える割り当ての件数）", () => {
  it("total は checked || reflected の交点の数、pending は checked ≠ reflected の交点の数。残骸は数えない", () => {
    const summaries = summarizeAssignments(
      [
        flags(DEPLOY, true, false), // 未反映の追加
        flags(DEPLOY, false, true), // 未反映の削除
        flags(DEPLOY, true, true), // 反映済み
        flags(DEPLOY, false, false), // 残骸
        flags(AUDIT, false, false), // 残骸だけのロール
      ],
      [DEPLOY, AUDIT],
    );

    expect(summaries.get(DEPLOY)).toEqual({ total: 3, pending: 2 });
    expect(summaries.get(AUDIT)).toEqual({ total: 0, pending: 0 });
  });

  it("対象のロールは、交点が無くても 0 件で返す。対象外のロールは含めない", () => {
    const summaries = summarizeAssignments([flags(OTHER, true, true)], [DEPLOY]);

    expect(summaries).toEqual(new Map([[DEPLOY, { total: 0, pending: 0 }]]));
  });
});
