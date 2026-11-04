/**
 * 認証方式（FR-6.4）の設定の解釈。取得はしない（`index.ts` が SSM から取り、5 分キャッシュする）。
 * 不正な値は例外にする。呼び出し側は 503（fail closed）に写す。
 */

export type AuthMode = "basic" | "cognito";

export function parseAuthMode(value: string | undefined): AuthMode {
  if (value === "basic" || value === "cognito") {
    return value;
  }
  throw new Error(`認証方式の値が不正です（"basic" か "cognito" のみ）: ${JSON.stringify(value)}`);
}

/** Cognito に限らず、OIDC の IdP がそのまま使える形（将来の外部 IdP も同じ型で載せる）。 */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Cognito のログアウトの接続先（任意。`/logout` だけが要る。Issue #160）。 */
  logoutEndpoint?: string;
}

const HTTPS_KEYS = ["issuer", "authorizationEndpoint", "tokenEndpoint", "jwksUri"] as const;

export function parseOidcConfig(value: string | undefined): OidcConfig {
  if (value === undefined) {
    throw new Error("OIDC の設定に値がありません");
  }
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error("OIDC の設定が JSON ではありません");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("OIDC の設定が JSON のオブジェクトではありません");
  }
  const record = json as Record<string, unknown>;

  const read = (key: string): string => {
    const v = record[key];
    if (typeof v !== "string" || v === "") {
      throw new Error(`OIDC の設定の ${key} がありません`);
    }
    return v;
  };

  const config: OidcConfig = {
    issuer: read("issuer"),
    clientId: read("clientId"),
    authorizationEndpoint: read("authorizationEndpoint"),
    tokenEndpoint: read("tokenEndpoint"),
    jwksUri: read("jwksUri"),
  };
  if (record.logoutEndpoint !== undefined) {
    config.logoutEndpoint = read("logoutEndpoint");
  }
  for (const key of HTTPS_KEYS) {
    if (!config[key].startsWith("https://")) {
      throw new Error(`OIDC の設定の ${key} は https:// で始まる必要があります`);
    }
  }
  if (config.logoutEndpoint !== undefined && !config.logoutEndpoint.startsWith("https://")) {
    throw new Error("OIDC の設定の logoutEndpoint は https:// で始まる必要があります");
  }
  return config;
}
