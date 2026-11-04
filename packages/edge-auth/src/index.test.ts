import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { CloudFrontRequestEvent, CloudFrontResultResponse } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTOR_HEADER, encodeActor } from "./actor.js";
import {
  AUTH_MODE_PARAMETER_NAME,
  AUTH_OIDC_PARAMETER_NAME,
  CACHE_TTL_MS,
  CREDENTIALS_PARAMETER_NAME,
  IP_ALLOWLIST_PARAMETER_NAME,
  handler,
  resetCredentialCache,
} from "./index.js";
import {
  CLIENT_ID,
  ISSUER,
  NOW_MS,
  createTestKey,
  jwksResponse,
  signToken,
  validClaims,
} from "./testing/tokens.js";

const ssmMock = mockClient(SSMClient);

const USER = "admin";
const PASSWORD = "s3cret-from-ssm";
const VALID_HEADER = `Basic ${Buffer.from(`${USER}:${PASSWORD}`, "utf8").toString("base64")}`;
const CLIENT_IP = "203.0.113.1";

/** `clientIp` が null なら、リクエストから clientIp を省く。 */
function event(
  authorization?: string,
  overrides: { clientIp?: string | null; uri?: string; cookie?: string; headers?: Record<string, string[]> } = {},
): CloudFrontRequestEvent {
  const headers: Record<string, { key: string; value: string }[]> = {
    host: [{ key: "Host", value: "rolust.example.com" }],
  };
  if (authorization !== undefined) {
    headers.authorization = [{ key: "Authorization", value: authorization }];
  }
  if (overrides.cookie !== undefined) {
    headers.cookie = [{ key: "Cookie", value: overrides.cookie }];
  }
  for (const [name, values] of Object.entries(overrides.headers ?? {})) {
    headers[name.toLowerCase()] = values.map((value) => ({ key: name, value }));
  }
  const clientIp = overrides.clientIp === undefined ? CLIENT_IP : overrides.clientIp;

  return {
    Records: [
      {
        cf: {
          config: {
            distributionDomainName: "d123.cloudfront.net",
            distributionId: "E123",
            eventType: "viewer-request",
            requestId: "req-1",
          },
          request: {
            ...(clientIp === null ? {} : { clientIp }),
            headers,
            method: "GET",
            querystring: "",
            uri: overrides.uri ?? "/",
          },
        },
      },
    ],
  } as unknown as CloudFrontRequestEvent;
}

function asResponse(result: unknown): CloudFrontResultResponse {
  return result as CloudFrontResultResponse;
}

function mockAllowlist(value: string): void {
  ssmMock
    .on(GetParameterCommand, { Name: IP_ALLOWLIST_PARAMETER_NAME })
    .resolves({ Parameter: { Value: value } });
}

function mockCredentials(value: string): void {
  ssmMock
    .on(GetParameterCommand, { Name: CREDENTIALS_PARAMETER_NAME })
    .resolves({ Parameter: { Value: value } });
}

function mockAuthMode(value: string): void {
  ssmMock
    .on(GetParameterCommand, { Name: AUTH_MODE_PARAMETER_NAME })
    .resolves({ Parameter: { Value: value } });
}

function mockOidcConfig(value: string): void {
  ssmMock
    .on(GetParameterCommand, { Name: AUTH_OIDC_PARAMETER_NAME })
    .resolves({ Parameter: { Value: value } });
}

function callsFor(name: string): number {
  return ssmMock.commandCalls(GetParameterCommand, { Name: name }).length;
}

beforeEach(() => {
  ssmMock.reset();
  resetCredentialCache();
  mockCredentials(`${USER}:${PASSWORD}`);
  mockAllowlist(CLIENT_IP);
  mockAuthMode("basic");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Lambda@Edge の Basic 認証（FR-6.1）", () => {
  it("FR-6.1: 資格情報なしのアクセスは 401 で拒否される", async () => {
    const result = asResponse(await handler(event()));

    expect(result.status).toBe("401");
    expect(result.headers?.["www-authenticate"]?.[0]?.value).toContain("Basic realm=");
  });

  it("正しい資格情報ならリクエストをそのまま通す", async () => {
    const result = await handler(event(VALID_HEADER));

    expect(result).toMatchObject({ uri: "/", method: "GET" });
  });

  it("エッジケース: 誤ったパスワードは 401 で拒否される", async () => {
    const wrong = `Basic ${Buffer.from(`${USER}:wrong`, "utf8").toString("base64")}`;

    expect(asResponse(await handler(event(wrong))).status).toBe("401");
  });

  it("エッジケース: SSM から取得できない場合は通さず 503 を返す（fail closed）", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: CREDENTIALS_PARAMETER_NAME })
      .rejects(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = asResponse(await handler(event(VALID_HEADER)));

    expect(result.status).toBe("503");
  });

  it("エッジケース: パラメータの書式が不正なら通さない", async () => {
    mockCredentials("no-colon-here");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");
  });

  it("資格情報を実行コンテキストにキャッシュし、リクエストごとに SSM を叩かない", async () => {
    await handler(event(VALID_HEADER));
    await handler(event(VALID_HEADER));
    await handler(event(VALID_HEADER));

    expect(callsFor(CREDENTIALS_PARAMETER_NAME)).toBe(1);
    expect(
      ssmMock.commandCalls(GetParameterCommand, { Name: CREDENTIALS_PARAMETER_NAME })[0]?.args[0]
        .input,
    ).toMatchObject({ Name: CREDENTIALS_PARAMETER_NAME, WithDecryption: true });
  });

  it("NFR-3: 資格情報がソースに埋め込まれていない", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toContain(PASSWORD);
    // 値ではなくパラメータ名だけを持つ
    expect(source).toContain(CREDENTIALS_PARAMETER_NAME);
  });
});

describe("Lambda@Edge の IP 許可リスト（FR-6.2）", () => {
  it("許可リストに含まれない IP は、正しい資格情報があっても 403 で拒否される", async () => {
    mockAllowlist("198.51.100.0/24");

    const result = asResponse(await handler(event(VALID_HEADER)));

    expect(result.status).toBe("403");
  });

  it("拒否した IP には、資格情報を取りに行かない（判定は Basic 認証より前）", async () => {
    mockAllowlist("198.51.100.0/24");

    await handler(event(VALID_HEADER));

    expect(callsFor(CREDENTIALS_PARAMETER_NAME)).toBe(0);
  });

  it("403 の応答は固定の本文と no-store だけを持ち、許可リストの中身を漏らさない", async () => {
    mockAllowlist("198.51.100.0/24,192.0.2.44");

    const result = asResponse(await handler(event(VALID_HEADER)));

    expect(result.body).toBe("Forbidden");
    expect(result.headers?.["cache-control"]?.[0]?.value).toBe("no-store");
    expect(JSON.stringify(result)).not.toContain("198.51.100");
    expect(JSON.stringify(result)).not.toContain("192.0.2.44");
  });

  it("許可された IP で認証なしなら、Basic 認証の判定に進んで 401 になる", async () => {
    const result = asResponse(await handler(event()));

    expect(result.status).toBe("401");
  });

  it("許可された IP と正しい資格情報なら、リクエストをそのまま通す", async () => {
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/", method: "GET" });
  });

  it("CIDR で許可された範囲の IP は通る", async () => {
    mockAllowlist("203.0.113.0/25");

    expect(await handler(event(VALID_HEADER, { clientIp: "203.0.113.100" }))).toMatchObject({
      uri: "/",
    });
    expect(asResponse(await handler(event(VALID_HEADER, { clientIp: "203.0.113.200" }))).status).toBe(
      "403",
    );
  });

  it("初期値 0.0.0.0/0 は全 IPv4 を許可し、以降は Basic 認証が判定する", async () => {
    mockAllowlist("0.0.0.0/0");

    expect(asResponse(await handler(event(undefined, { clientIp: "192.0.2.99" }))).status).toBe("401");
    expect(await handler(event(VALID_HEADER, { clientIp: "192.0.2.99" }))).toMatchObject({ uri: "/" });
  });

  it("IPv6 の clientIp は、全許可でも 403 で拒否される", async () => {
    mockAllowlist("0.0.0.0/0");

    expect(
      asResponse(await handler(event(VALID_HEADER, { clientIp: "2001:db8::1" }))).status,
    ).toBe("403");
  });

  it("clientIp が無いリクエストは 403 で拒否される", async () => {
    expect(asResponse(await handler(event(VALID_HEADER, { clientIp: null }))).status).toBe("403");
  });

  it("エッジケース: 許可リストを取得できない場合は、正しい資格情報でも 503（fail closed）", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: IP_ALLOWLIST_PARAMETER_NAME })
      .rejects(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = asResponse(await handler(event(VALID_HEADER)));

    expect(result.status).toBe("503");
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("[rolust-edge-auth]"),
      expect.anything(),
    );
  });

  it.each(["abc", "", "203.0.113.5,,198.51.100.7", "::1", "203.0.113.0/33"])(
    "エッジケース: 許可リストの値が不正（%j）なら 503（fail closed）",
    async (value) => {
      mockAllowlist(value);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");
    },
  );

  it("エッジケース: 許可リストのパラメータに値が無ければ 503", async () => {
    ssmMock.on(GetParameterCommand, { Name: IP_ALLOWLIST_PARAMETER_NAME }).resolves({});
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");
  });

  it("許可リストを実行コンテキストにキャッシュし、リクエストごとに SSM を叩かない", async () => {
    await handler(event(VALID_HEADER));
    await handler(event(VALID_HEADER));
    await handler(event(VALID_HEADER));

    expect(callsFor(IP_ALLOWLIST_PARAMETER_NAME)).toBe(1);
    expect(
      ssmMock.commandCalls(GetParameterCommand, { Name: IP_ALLOWLIST_PARAMETER_NAME })[0]?.args[0]
        .input,
    ).toMatchObject({ Name: IP_ALLOWLIST_PARAMETER_NAME });
  });

  it("取得に失敗した結果はキャッシュせず、次のリクエストで回復する", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: IP_ALLOWLIST_PARAMETER_NAME })
      .rejects(new Error("一時的な障害"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");

    mockAllowlist(CLIENT_IP); // 障害が直った（同じ引数の .on() は、後に宣言したものが優先される）

    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" });
  });

  it("不正な値もキャッシュせず、値を直せば次のリクエストから効く", async () => {
    mockAllowlist("abc");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");

    mockAllowlist(CLIENT_IP);

    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" });
  });

  it("許可リストの変更は、キャッシュの有効期間（5 分）が過ぎてから効く", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-09-29T00:00:00Z").getTime();
    vi.setSystemTime(start);
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" });

    mockAllowlist("198.51.100.0/24"); // 自分の IP を外す

    vi.setSystemTime(start + CACHE_TTL_MS - 1);
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" }); // まだ古い値

    vi.setSystemTime(start + CACHE_TTL_MS + 1);
    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("403"); // 新しい値
    expect(callsFor(IP_ALLOWLIST_PARAMETER_NAME)).toBe(2);
  });

  it("resetCredentialCache は許可リストのキャッシュも捨てる", async () => {
    await handler(event(VALID_HEADER));
    resetCredentialCache();
    await handler(event(VALID_HEADER));

    expect(callsFor(IP_ALLOWLIST_PARAMETER_NAME)).toBe(2);
  });
});

describe("認証方式の選択（FR-6.4）", () => {
  const key = createTestKey("kid-1");
  const OIDC_CONFIG = JSON.stringify({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
    tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
  });

  function useCognito(): void {
    mockAuthMode("cognito");
    mockOidcConfig(OIDC_CONFIG);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([key])),
    );
  }

  it("basic のとき、auth-cognito を読まない", async () => {
    await handler(event(VALID_HEADER));

    expect(callsFor(AUTH_OIDC_PARAMETER_NAME)).toBe(0);
  });

  it("cognito のとき、basic-auth を読まない", async () => {
    useCognito();

    await handler(event());

    expect(callsFor(CREDENTIALS_PARAMETER_NAME)).toBe(0);
  });

  it("cognito・Cookie なしの画面は、認可エンドポイントへ 302 する", async () => {
    useCognito();

    const result = asResponse(await handler(event()));

    expect(result.status).toBe("302");
    expect(result.headers?.location?.[0]?.value).toContain("/oauth2/authorize?");
  });

  it("cognito・Cookie なしの /api/ は 401 で、WWW-Authenticate を付けない", async () => {
    useCognito();

    const result = asResponse(await handler(event(undefined, { uri: "/api/pools" })));

    expect(result.status).toBe("401");
    expect(result.headers?.["www-authenticate"]).toBeUndefined();
  });

  it("cognito・有効な ID トークンの Cookie なら、リクエストを通す", async () => {
    useCognito();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    const cookie = `__Host-rolust-id=${signToken(validClaims(), key)}`;

    expect(await handler(event(undefined, { cookie }))).toMatchObject({ uri: "/" });
  });

  it("cognito: サインイン済みなら、画面のパスを /index.html に書き換える。未サインインは書き換えずにサインインへ移す（Issue #141）", async () => {
    useCognito();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    const cookie = `__Host-rolust-id=${signToken(validClaims(), key)}`;

    expect(await handler(event(undefined, { cookie, uri: "/matrix" }))).toMatchObject({ uri: "/index.html" });

    const redirect = asResponse(await handler(event(undefined, { uri: "/matrix" })));
    expect(redirect.status).toBe("302");
  });

  it("cognito でも、IP 許可リストの判定が認証より前（拒否した IP は 403、方式も読まない）", async () => {
    useCognito();
    mockAllowlist("198.51.100.0/24");

    const result = asResponse(await handler(event()));

    expect(result.status).toBe("403");
    expect(callsFor(AUTH_MODE_PARAMETER_NAME)).toBe(0);
  });

  it.each([
    ["値が無い", undefined],
    ["不正な値（大文字）", "Cognito"],
    ["空", ""],
  ])("auth-mode が %s なら、誰も通さず 503（fail closed）", async (_name, value) => {
    ssmMock
      .on(GetParameterCommand, { Name: AUTH_MODE_PARAMETER_NAME })
      .resolves(value === undefined ? {} : { Parameter: { Value: value } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");
  });

  it("auth-mode を取得できなければ 503", async () => {
    ssmMock
      .on(GetParameterCommand, { Name: AUTH_MODE_PARAMETER_NAME })
      .rejects(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");
  });

  it.each([
    ["JSON でない", "not json"],
    ["issuer が http://", JSON.stringify({ ...JSON.parse(OIDC_CONFIG), issuer: "http://x" })],
    ["clientId が無い", JSON.stringify({ ...JSON.parse(OIDC_CONFIG), clientId: undefined })],
  ])("cognito で auth-cognito が %s なら、誰も通さず 503", async (_name, value) => {
    useCognito();
    mockOidcConfig(value);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event())).status).toBe("503");
  });

  it("auth-cognito が無ければ（まだ作られていない）503", async () => {
    mockAuthMode("cognito");
    ssmMock.on(GetParameterCommand, { Name: AUTH_OIDC_PARAMETER_NAME }).resolves({});
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(asResponse(await handler(event())).status).toBe("503");
  });

  it("auth-mode は 5 分キャッシュし、取得に失敗した結果は保持しない", async () => {
    await handler(event(VALID_HEADER));
    await handler(event(VALID_HEADER));
    expect(callsFor(AUTH_MODE_PARAMETER_NAME)).toBe(1);

    resetCredentialCache();
    ssmMock
      .on(GetParameterCommand, { Name: AUTH_MODE_PARAMETER_NAME })
      .rejects(new Error("一時的な障害"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(asResponse(await handler(event(VALID_HEADER))).status).toBe("503");

    mockAuthMode("basic"); // 障害が直った
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" });
  });

  it("方式の変更は、キャッシュの有効期間（5 分）が過ぎてから効く", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-10-05T00:00:00Z").getTime();
    vi.setSystemTime(start);
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" });

    useCognito(); // basic → cognito に切り替えた

    vi.setSystemTime(start + CACHE_TTL_MS - 1);
    expect(await handler(event(VALID_HEADER))).toMatchObject({ uri: "/" }); // まだ basic

    vi.setSystemTime(start + CACHE_TTL_MS + 1);
    expect(asResponse(await handler(event())).status).toBe("302"); // cognito
  });

  it("resetCredentialCache は方式と OIDC の設定のキャッシュも捨てる", async () => {
    useCognito();
    await handler(event());
    resetCredentialCache();
    await handler(event());

    expect(callsFor(AUTH_MODE_PARAMETER_NAME)).toBe(2);
    expect(callsFor(AUTH_OIDC_PARAMETER_NAME)).toBe(2);
  });
});

describe("実行者の記録（Issue #120）", () => {
  const key = createTestKey("kid-1");
  const OIDC_CONFIG = JSON.stringify({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
    tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
  });

  function useCognito(): void {
    mockAuthMode("cognito");
    mockOidcConfig(OIDC_CONFIG);
    vi.stubGlobal("fetch", vi.fn(async () => jwksResponse([key])));
  }

  function actorHeader(result: unknown): { key: string; value: string }[] | undefined {
    return (result as { headers?: Record<string, { key: string; value: string }[]> }).headers?.[
      ACTOR_HEADER
    ];
  }

  it("basic: 通すリクエストに、Authorization のユーザ名を name にした x-rolust-actor を付ける", async () => {
    const result = await handler(event(VALID_HEADER));

    expect(actorHeader(result)).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: USER }) },
    ]);
  });

  it("basic: ビューアが x-rolust-actor を 2 本送っても、通すときは本物の 1 本だけになる", async () => {
    const forged = encodeActor({ name: "someone-else" });
    const result = await handler(
      event(VALID_HEADER, { headers: { "X-Rolust-Actor": [forged, forged] } }),
    );

    expect(actorHeader(result)).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: USER }) },
    ]);
  });

  it("basic: ビューアが groups: [applier] 入りの x-rolust-actor を送っても、通すときは groups を含まない（Issue #141）", async () => {
    const forged = encodeActor({ name: "someone-else", groups: ["applier"] });
    const result = await handler(event(VALID_HEADER, { headers: { "X-Rolust-Actor": [forged] } }));

    expect(actorHeader(result)).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: USER }) },
    ]);
  });

  it("basic: パスワードにコロンを含んでも、ユーザ名は最初のコロンの前まで", async () => {
    mockCredentials("admin:pa:ss:word");
    const header = `Basic ${Buffer.from("admin:pa:ss:word", "utf8").toString("base64")}`;

    const result = await handler(event(header));

    expect(actorHeader(result)?.[0]?.value).toBe(encodeActor({ name: "admin" }));
  });

  it("basic: ユーザ名が空（':password'）なら、名前が取れないのでヘッダーを付けずに通す。偽装は残さない", async () => {
    mockCredentials(":only-password");
    const header = `Basic ${Buffer.from(":only-password", "utf8").toString("base64")}`;

    const result = await handler(
      event(header, { headers: { "x-rolust-actor": [encodeActor({ name: "forged" })] } }),
    );

    expect(result).toMatchObject({ uri: "/" });
    expect(actorHeader(result)).toBeUndefined();
  });

  it("basic: 認証に失敗したときは、応答にも x-rolust-actor を付けない", async () => {
    const result = asResponse(await handler(event("Basic wrong")));

    expect(result.status).toBe("401");
    expect(actorHeader(result)).toBeUndefined();
  });

  it("cognito: ビューアが別人を名乗る x-rolust-actor を付けても、検証済みのトークンの本人になる", async () => {
    useCognito();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    const cookie = `__Host-rolust-id=${signToken(validClaims(), key)}`;

    const result = await handler(
      event(undefined, { cookie, headers: { "X-Rolust-Actor": [encodeActor({ name: "bob" })] } }),
    );

    expect(actorHeader(result)).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: "alice", sub: "user-1" }) },
    ]);
  });

  it("cognito: Cookie が無いリクエストは、x-rolust-actor を付けても 401 で通らない", async () => {
    useCognito();

    const result = asResponse(
      await handler(
        event(undefined, {
          uri: "/api/change-requests",
          headers: { "x-rolust-actor": [encodeActor({ name: "alice" })] },
        }),
      ),
    );

    expect(result.status).toBe("401");
  });
});

describe("SPA のディープリンクの書き換え（Issue #141）", () => {
  // CloudFront のカスタムエラー応答（403 → index.html）は、API が返す 403（権限なし）まで HTML に書き換えた。
  // そこで、拡張子の無い画面のパスを、認証を通した後に Edge で index.html に寄せる。
  it.each(["/pool", "/roles", "/matrix", "/requests", "/history", "/some/deep/link"])(
    "%s は /index.html に書き換える",
    async (uri) => {
      const result = await handler(event(VALID_HEADER, { uri }));

      expect(result).toMatchObject({ uri: "/index.html", method: "GET" });
    },
  );

  it.each(["/", "/index.html", "/favicon.ico", "/assets/index-abc123.js", "/assets/cloudscape-x.css"])(
    "%s は書き換えない（ルートはデフォルトルートオブジェクト、拡張子のあるものは実ファイル）",
    async (uri) => {
      const result = await handler(event(VALID_HEADER, { uri }));

      expect(result).toMatchObject({ uri });
    },
  );

  it.each(["/api", "/api/", "/api/pool", "/api/change-requests/x/discard", "/api/me"])(
    "%s は API なので書き換えない",
    async (uri) => {
      const result = await handler(event(VALID_HEADER, { uri }));

      expect(result).toMatchObject({ uri });
    },
  );

  it("/apiary のように /api で始まるだけの画面のパスは、API ではないので書き換える", async () => {
    const result = await handler(event(VALID_HEADER, { uri: "/apiary" }));

    expect(result).toMatchObject({ uri: "/index.html" });
  });

  it("書き換えるのは uri だけで、クエリ文字列は変えない", async () => {
    const e = event(VALID_HEADER, { uri: "/requests" });
    const request = e.Records[0]?.cf.request;
    if (!request) throw new Error("request が無い");
    request.querystring = "ids=cr-1";

    const result = await handler(e);

    expect(result).toMatchObject({ uri: "/index.html", querystring: "ids=cr-1" });
  });

  it("認証を通らなかったリクエストの応答（401・403）は書き換えの対象ではない", async () => {
    const unauthorized = asResponse(await handler(event(undefined, { uri: "/matrix" })));
    const forbidden = asResponse(await handler(event(VALID_HEADER, { uri: "/matrix", clientIp: "192.0.2.99" })));

    expect(unauthorized.status).toBe("401");
    expect(forbidden.status).toBe("403");
  });
});

describe("ログアウト（Issue #160）", () => {
  const key = createTestKey("kid-1");
  const LOGOUT_ENDPOINT = "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/logout";
  const CONFIG = {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
    tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
  };

  function useCognito(config: Record<string, unknown>): void {
    mockAuthMode("cognito");
    mockOidcConfig(JSON.stringify(config));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([key])),
    );
  }

  it("cognito・Cookie 無しの /logout は、認証を要求せず Cognito の /logout へ 302 し、Cookie を消す", async () => {
    useCognito({ ...CONFIG, logoutEndpoint: LOGOUT_ENDPOINT });

    const result = asResponse(await handler(event(undefined, { uri: "/logout" })));

    expect(result.status).toBe("302");
    expect(result.headers?.location?.[0]?.value.startsWith(`${LOGOUT_ENDPOINT}?`)).toBe(true);
    expect(result.headers?.["set-cookie"]?.[0]?.value).toContain("__Host-rolust-id=; Max-Age=0");
  });

  it.each([
    ["期限切れ", () => signToken(validClaims({ exp: 1 }), key)],
    ["改ざん", () => "not.a.jwt"],
  ])("cognito・%s の Cookie でも /logout は 302 で Cookie を消す（Review Focus 2）", async (_name, token) => {
    useCognito({ ...CONFIG, logoutEndpoint: LOGOUT_ENDPOINT });

    const result = asResponse(
      await handler(event(undefined, { uri: "/logout", cookie: `__Host-rolust-id=${token()}` })),
    );

    expect(result.status).toBe("302");
    expect(result.headers?.["set-cookie"]?.[0]?.value).toContain("__Host-rolust-id=; Max-Age=0");
  });

  it("cognito でも、IP 判定が /logout より前（拒否した IP は 403）", async () => {
    useCognito({ ...CONFIG, logoutEndpoint: LOGOUT_ENDPOINT });
    mockAllowlist("198.51.100.0/24");

    const result = asResponse(await handler(event(undefined, { uri: "/logout" })));

    expect(result.status).toBe("403");
    expect(result.headers?.location).toBeUndefined();
  });

  it("logoutEndpoint が無ければ /logout は 503。サインインの 302 は従来どおり働く（Review Focus 3）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useCognito(CONFIG);

    expect(asResponse(await handler(event(undefined, { uri: "/logout" }))).status).toBe("503");
    const signIn = asResponse(await handler(event(undefined, { uri: "/" })));
    expect(signIn.status).toBe("302");
    expect(signIn.headers?.location?.[0]?.value).toContain("/oauth2/authorize?");
  });

  it("basic の /logout は Cognito へ送らず、通常のリクエストとして扱う（Review Focus 4）", async () => {
    const result = await handler(event(VALID_HEADER, { uri: "/logout" }));

    expect(asResponse(result).headers?.location).toBeUndefined();
    expect(result).toMatchObject({ uri: "/index.html" });
    expect(callsFor(AUTH_OIDC_PARAMETER_NAME)).toBe(0);
  });
});
