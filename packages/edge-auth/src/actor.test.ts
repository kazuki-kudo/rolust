import type { CloudFrontRequest } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { ACTOR_HEADER, actorFromClaims, encodeActor, setActor, stripActor } from "./actor.js";

function requestWith(headers: CloudFrontRequest["headers"] = {}): CloudFrontRequest {
  return { clientIp: "203.0.113.1", headers, method: "GET", querystring: "", uri: "/" };
}

describe("encodeActor", () => {
  it("name と sub を base64url の JSON にする。API の readActor と同じ固定値で契約を揃える", () => {
    // packages/api/src/actor.test.ts に同じ値がある。どちらかを変えるなら両方を変える。
    expect(encodeActor({ name: "alice", sub: "user-1" })).toBe(
      "eyJuYW1lIjoiYWxpY2UiLCJzdWIiOiJ1c2VyLTEifQ",
    );
  });

  it("groups も載せる。API の readGroups と同じ固定値で契約を揃える（Issue #141）", () => {
    // packages/api/src/actor.test.ts に同じ値がある。どちらかを変えるなら両方を変える。
    expect(encodeActor({ name: "alice", sub: "user-1", groups: ["applier"] })).toBe(
      "eyJuYW1lIjoiYWxpY2UiLCJzdWIiOiJ1c2VyLTEiLCJncm91cHMiOlsiYXBwbGllciJdfQ",
    );
  });

  it("sub が無ければ name だけ。日本語は UTF-8 の JSON を経て、ASCII だけになる", () => {
    const encoded = encodeActor({ name: "田中" });

    expect(encoded).toBe("eyJuYW1lIjoi55Sw5LitIn0");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("actorFromClaims", () => {
  it("cognito:username を name に、sub を sub にする", () => {
    expect(actorFromClaims({ exp: 1, "cognito:username": "alice", sub: "user-1" })).toEqual({
      name: "alice",
      sub: "user-1",
    });
  });

  it("cognito:username が無い・空なら、sub を name にする", () => {
    expect(actorFromClaims({ exp: 1, sub: "user-1" })).toEqual({ name: "user-1", sub: "user-1" });
    expect(actorFromClaims({ exp: 1, "cognito:username": "", sub: "user-1" })).toEqual({
      name: "user-1",
      sub: "user-1",
    });
  });

  it("どちらも無ければ null", () => {
    expect(actorFromClaims({ exp: 1 })).toBeNull();
  });
});

describe("setActor / stripActor", () => {
  it("setActor は既存の値を置き換え、1 本だけにする", () => {
    const request = requestWith({
      [ACTOR_HEADER]: [
        { key: "X-Rolust-Actor", value: "forged-1" },
        { key: "X-Rolust-Actor", value: "forged-2" },
      ],
    });

    setActor(request, { name: "alice" });

    expect(request.headers[ACTOR_HEADER]).toHaveLength(1);
    expect(request.headers[ACTOR_HEADER]?.[0]?.value).toBe(encodeActor({ name: "alice" }));
  });

  it("stripActor は全部の値を消す。他のヘッダーは残す", () => {
    const request = requestWith({
      host: [{ key: "Host", value: "rolust.example.com" }],
      [ACTOR_HEADER]: [
        { key: "X-Rolust-Actor", value: "forged-1" },
        { key: "X-Rolust-Actor", value: "forged-2" },
      ],
    });

    stripActor(request);

    expect(request.headers[ACTOR_HEADER]).toBeUndefined();
    expect(request.headers.host).toBeDefined();
  });
});

describe("actorFromClaims の groups（Issue #141）", () => {
  const base = { exp: 1, "cognito:username": "alice", sub: "user-1" };

  it("cognito:groups を groups に載せる", () => {
    expect(actorFromClaims({ ...base, "cognito:groups": ["applier", "viewer"] })).toEqual({
      name: "alice",
      sub: "user-1",
      groups: ["applier", "viewer"],
    });
  });

  it.each([
    ["無い", undefined],
    ["空配列", []],
    ["文字列", "applier"],
    ["文字列でない要素だけ", [1, null]],
  ])("cognito:groups が%sときは groups のキーを作らない", (_label, value) => {
    const actor = actorFromClaims({ ...base, "cognito:groups": value });
    expect(actor).toEqual({ name: "alice", sub: "user-1" });
    expect(actor && "groups" in actor).toBe(false);
  });

  it("文字列でない要素は捨てる", () => {
    expect(actorFromClaims({ ...base, "cognito:groups": ["viewer", 1] })?.groups).toEqual(["viewer"]);
  });
});
