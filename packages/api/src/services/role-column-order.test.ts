import { describe, expect, it } from "vitest";

import { sortByColumnOrder } from "./role-column-order.js";

const role = (arn: string) => ({ arn });

describe("ロールの列順（FR-2.6）", () => {
  it("紐づけの列順に並べ、紐づけを持たないロールは末尾に、元の順のまま置く", () => {
    const roles = [role("c"), role("a"), role("x"), role("b"), role("y")];
    const entries = [
      { roleArn: "a", position: 0 },
      { roleArn: "b", position: 1 },
      { roleArn: "c", position: 2 },
    ];

    expect(sortByColumnOrder(roles, entries).map((entry) => entry.arn)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("入力を変更しない", () => {
    const roles = [role("b"), role("a")];
    sortByColumnOrder(roles, [{ roleArn: "a", position: 0 }]);

    expect(roles.map((entry) => entry.arn)).toEqual(["b", "a"]);
  });
});
