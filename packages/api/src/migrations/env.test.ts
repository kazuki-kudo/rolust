import { describe, expect, it } from "vitest";

import { readTableNames } from "./env.js";

const VARS = { state: "ROLUST_STATE_TABLE_NAME", changeRequest: "ROLUST_CHANGE_REQUEST_TABLE_NAME" };

describe("readTableNames（移行 CLI のテーブル名。Issue #36）", () => {
  it("揃っていれば前後の空白を落として返す", () => {
    expect(
      readTableNames({ ROLUST_STATE_TABLE_NAME: " rolust-state ", ROLUST_CHANGE_REQUEST_TABLE_NAME: "rolust-change-requests" }, VARS),
    ).toEqual({ ok: true, names: { state: "rolust-state", changeRequest: "rolust-change-requests" } });
  });

  it("欠けた変数をすべて名指しする", () => {
    const result = readTableNames({ ROLUST_STATE_TABLE_NAME: "  " }, VARS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ROLUST_STATE_TABLE_NAME");
      expect(result.message).toContain("ROLUST_CHANGE_REQUEST_TABLE_NAME");
    }
  });

  it("同じテーブル名を拒む", () => {
    const result = readTableNames({ ROLUST_STATE_TABLE_NAME: "rolust", ROLUST_CHANGE_REQUEST_TABLE_NAME: "rolust" }, VARS);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/別々のテーブル/) });
  });
});
