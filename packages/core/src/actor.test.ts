import { describe, expect, it } from "vitest";

import { ACTOR_FIELD_MAX_LENGTH, parseActor } from "./actor.js";

describe("parseActor（Issue #120）", () => {
  it("name と sub を受ける", () => {
    expect(parseActor({ name: "alice", sub: "user-1" })).toEqual({ name: "alice", sub: "user-1" });
  });

  it("sub が無ければ name だけ。sub のキーを作らない（DynamoDB は undefined を受けない）", () => {
    const actor = parseActor({ name: "admin" });

    expect(actor).toEqual({ name: "admin" });
    expect(actor).not.toHaveProperty("sub");
  });

  it("余分な属性は捨てる", () => {
    expect(parseActor({ name: "alice", sub: "u", role: "admin" })).toEqual({ name: "alice", sub: "u" });
  });

  it("日本語のユーザ名をそのまま通す", () => {
    expect(parseActor({ name: "田中太郎" })).toEqual({ name: "田中太郎" });
  });

  it.each([
    ["null", null],
    ["文字列", "alice"],
    ["配列", ["alice"]],
    ["name が無い", { sub: "u" }],
    ["name が文字列でない", { name: 1 }],
    ["name が空", { name: "" }],
    ["name が空白だけ", { name: "   " }],
    ["name が長すぎる", { name: "a".repeat(ACTOR_FIELD_MAX_LENGTH + 1) }],
    ["sub が文字列でない", { name: "alice", sub: 1 }],
    ["sub が空", { name: "alice", sub: "" }],
    ["sub が長すぎる", { name: "alice", sub: "a".repeat(ACTOR_FIELD_MAX_LENGTH + 1) }],
  ])("不正（%s）は null", (_label, value) => {
    expect(parseActor(value)).toBeNull();
  });

  it("上限ちょうどの長さは通す", () => {
    const name = "a".repeat(ACTOR_FIELD_MAX_LENGTH);

    expect(parseActor({ name })).toEqual({ name });
  });
});
