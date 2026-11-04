import { afterEach, describe, expect, it, vi } from "vitest";

import { readActor, readGroups } from "./actor.js";

// packages/edge-auth/src/actor.test.ts に同じ値がある。どちらかを変えるなら両方を変える。
const ALICE = "eyJuYW1lIjoiYWxpY2UiLCJzdWIiOiJ1c2VyLTEifQ"; // {"name":"alice","sub":"user-1"}
const TANAKA = "eyJuYW1lIjoi55Sw5LitIn0"; // {"name":"田中"}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readActor（Issue #120）", () => {
  it("edge-auth が付けた値を復号する", () => {
    expect(readActor({ "x-rolust-actor": ALICE })).toEqual({ name: "alice", sub: "user-1" });
  });

  it("日本語のユーザ名が化けない", () => {
    expect(readActor({ "x-rolust-actor": TANAKA })).toEqual({ name: "田中" });
  });

  it("ヘッダー名の大文字小文字を区別しない", () => {
    expect(readActor({ "X-Rolust-Actor": ALICE })).toEqual({ name: "alice", sub: "user-1" });
  });

  it("ヘッダーが無い・空は null で、警告を出さない（ローカル開発・統合テストの通常経路）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readActor({})).toBeNull();
    expect(readActor(null)).toBeNull();
    expect(readActor(undefined)).toBeNull();
    expect(readActor({ "x-rolust-actor": "" })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["base64url だが JSON でない", Buffer.from("not json", "utf8").toString("base64url")],
    ["JSON が配列", encode(["alice"])],
    ["JSON が null", encode(null)],
    ["name が無い", encode({ sub: "u" })],
    ["name が長すぎる", encode({ name: "a".repeat(257) })],
    ["base64url でないゴミ", "%%%"],
  ])("不正（%s）は null で、警告を出す。値そのものはログに出さない", (_label, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readActor({ "x-rolust-actor": raw })).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(raw);
  });
});

// packages/edge-auth/src/actor.test.ts に同じ値がある。どちらかを変えるなら両方を変える。
const ALICE_APPLIER = "eyJuYW1lIjoiYWxpY2UiLCJzdWIiOiJ1c2VyLTEiLCJncm91cHMiOlsiYXBwbGllciJdfQ"; // {"name":"alice","sub":"user-1","groups":["applier"]}

describe("readGroups（Issue #141）", () => {
  it("edge-auth が付けた groups を復号する", () => {
    expect(readGroups({ "x-rolust-actor": ALICE_APPLIER })).toEqual(["applier"]);
  });

  it("ヘッダー名の大文字小文字を区別しない", () => {
    expect(readGroups({ "X-Rolust-Actor": ALICE_APPLIER })).toEqual(["applier"]);
  });

  it("groups の無い有効なヘッダーは空配列", () => {
    expect(readGroups({ "x-rolust-actor": ALICE })).toEqual([]);
  });

  it("ヘッダーが無い・空は null", () => {
    expect(readGroups({})).toBeNull();
    expect(readGroups(null)).toBeNull();
    expect(readGroups({ "x-rolust-actor": "" })).toBeNull();
  });

  it.each([
    ["base64url だが JSON でない", Buffer.from("not json", "utf8").toString("base64url")],
    ["JSON が配列", encode(["applier"])],
    ["JSON が null", encode(null)],
    ["base64url でないゴミ", "%%%"],
  ])("不正（%s）は null。警告は readActor が出すので、ここでは出さない", (_label, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(readGroups({ "x-rolust-actor": raw })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("groups が文字列の配列でなければ、文字列の要素だけを読む", () => {
    expect(readGroups({ "x-rolust-actor": encode({ name: "a", groups: ["viewer", 1] }) })).toEqual(["viewer"]);
    expect(readGroups({ "x-rolust-actor": encode({ name: "a", groups: "applier" }) })).toEqual([]);
  });

  it("readActor は groups を実行者に含めない（保存する createdBy・appliedBy に入れない）", () => {
    expect(readActor({ "x-rolust-actor": ALICE_APPLIER })).toEqual({ name: "alice", sub: "user-1" });
  });
});
