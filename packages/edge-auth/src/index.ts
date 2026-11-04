import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type {
  CloudFrontRequest,
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
} from "aws-lambda";

import { parseAuthMode, parseOidcConfig, type AuthMode, type OidcConfig } from "./auth-config.js";
import { stripActor } from "./actor.js";
import { isAllowed, parseAllowlist, type Cidr } from "./ip-allowlist.js";
import { LOGOUT_PATH, buildLogoutResponse } from "./logout.js";
import { createBasicProvider } from "./providers/basic.js";
import { createOidcProvider } from "./providers/oidc.js";
import type { AuthProvider } from "./providers/types.js";
import { forbidden, serviceUnavailable } from "./responses.js";

/**
 * 管理画面の Basic 認証（FR-6.1 / OQ-1 = 質問 2 の確定内容）。
 *
 * CloudFront の **viewer-request** に関連付ける Lambda@Edge。SPA の静的ファイルと
 * `/api/*` の両方がこのビヘイビアを通るため、入口を 1 箇所で塞げる。
 *
 * 制約（`code-generation-questions.md` Answer Analysis 帰結 2）:
 * - **Lambda@Edge は環境変数を持てない**。したがってパラメータ名は本モジュールの定数。
 * - 関数と実行ロールは **us-east-1** に作成する。
 * - 実行ロールの信頼ポリシーには `lambda.amazonaws.com` と `edgelambda.amazonaws.com` の
 *   **両方**を Principal に含める。
 * - 資格情報はリクエストごとではなく実行コンテキスト（モジュールスコープ）に
 *   TTL 付きでキャッシュする。
 *
 * IP 許可リスト（FR-6.2）: Basic 認証の**前**に、`request.clientIp` を SSM の許可リストと照合する。
 * 許可されていなければ 403 を返し、資格情報の取得にも進まない。許可リストが空・不正・取得不能な
 * ときは、どのアクセスも通さない（503）。`X-Forwarded-For` は偽装できるので使わない。
 *
 * 認証方式（FR-6.4、Issue #20）: IP 判定の後に、SSM の `auth-mode`（`basic` / `cognito`）で認証プロバイダーを選ぶ。
 * `basic` は従来の Basic 認証（`providers/basic.ts`）、`cognito` は OIDC の認可コード + PKCE
 * （`providers/oidc.ts`）。方式の設定が無い・不正・取得不能なときは、どのアクセスも通さない（503）。
 *
 * NFR-3: 資格情報はコードに埋め込まない。SSM Parameter Store の **SecureString** から
 *   取得し、復号は実行ロールの `ssm:GetParameter` + `kms:Decrypt` に依る。
 */

/**
 * 資格情報を置く SSM パラメータ名。値は `<ユーザ名>:<パスワード>` の SecureString。
 *
 * Terraform は名前だけを作り、値は管理外（`ignore_changes`）とする。
 * 投入手順は `docs/guide/setup.md` に記載する。
 */
export const CREDENTIALS_PARAMETER_NAME = "/rolust/basic-auth";

/**
 * IP 許可リストを置く SSM パラメータ名。値は IPv4 アドレスまたは CIDR のカンマ区切り（String）。
 *
 * Terraform は名前と初期値（`0.0.0.0/0`）だけを作り、以降の値は管理外（`ignore_changes`）とする。
 * `infra/variables.tf` の `ip_allowlist_parameter_name` と一致していなければならない。
 */
export const IP_ALLOWLIST_PARAMETER_NAME = "/rolust/ip-allowlist";

/**
 * 認証方式を置く SSM パラメータ名。値は `basic` または `cognito`（String）。
 *
 * `infra/variables.tf` の `auth_mode_parameter_name` と一致していなければならない。
 */
export const AUTH_MODE_PARAMETER_NAME = "/rolust/auth-mode";

/**
 * OIDC（Cognito）の接続情報を置く SSM パラメータ名。値は `issuer`・`clientId`・`authorizationEndpoint`・
 * `tokenEndpoint`・`jwksUri` を持つ JSON（String）。`auth_mode = "cognito"` のときだけ Terraform が作る。
 *
 * `infra/variables.tf` の `auth_cognito_parameter_name` と一致していなければならない。
 */
export const AUTH_OIDC_PARAMETER_NAME = "/rolust/auth-cognito";

/** SSM のリージョン。Lambda@Edge はビューアに近いリージョンで動くため明示する。 */
export const SSM_REGION = "us-east-1";

/** キャッシュの有効期間。短すぎると SSM を叩きすぎ、長すぎるとローテーションが遅れる。 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedCredentials {
  header: string;
  expiresAt: number;
}

interface CachedAllowlist {
  list: Cidr[];
  expiresAt: number;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

let cache: CachedCredentials | null = null;
let allowlistCache: CachedAllowlist | null = null;
let authModeCache: Cached<AuthMode> | null = null;
let oidcConfigCache: Cached<OidcConfig> | null = null;
let oidcProvider: AuthProvider | null = null;
let ssmClient: SSMClient | null = null;

/** キャッシュを捨てる。テストと、資格情報・許可リスト・認証方式の変更直後の手動リセットに使う。 */
export function resetCredentialCache(): void {
  cache = null;
  allowlistCache = null;
  authModeCache = null;
  oidcConfigCache = null;
  oidcProvider = null;
  ssmClient = null;
}

function getSsmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: SSM_REGION });
  }
  return ssmClient;
}

/**
 * 期待される `Authorization` ヘッダの値を返す。
 *
 * SSM から取得した `<user>:<password>` を Basic 認証のヘッダ形式へ変換して
 * キャッシュする。平文のパスワードをそのまま保持しないためでもある。
 */
async function getExpectedAuthorization(now: number): Promise<string> {
  if (cache && cache.expiresAt > now) {
    return cache.header;
  }

  const response = await getSsmClient().send(
    new GetParameterCommand({
      Name: CREDENTIALS_PARAMETER_NAME,
      WithDecryption: true,
    }),
  );

  const value = response.Parameter?.Value;
  if (!value || !value.includes(":")) {
    throw new Error(
      `SSM パラメータ ${CREDENTIALS_PARAMETER_NAME} の値が "<ユーザ名>:<パスワード>" 形式ではありません`,
    );
  }

  const header = `Basic ${Buffer.from(value, "utf8").toString("base64")}`;
  cache = { header, expiresAt: now + CACHE_TTL_MS };
  return header;
}

/**
 * IP 許可リストを返す。
 *
 * 取得と解釈に成功したときだけキャッシュする。失敗した結果を保持すると、直した後も
 * 次の期限までは 503 のままになるため。
 */
async function getAllowlist(now: number): Promise<Cidr[]> {
  if (allowlistCache && allowlistCache.expiresAt > now) {
    return allowlistCache.list;
  }

  const response = await getSsmClient().send(
    new GetParameterCommand({ Name: IP_ALLOWLIST_PARAMETER_NAME }),
  );

  const value = response.Parameter?.Value;
  if (value === undefined) {
    throw new Error(`SSM パラメータ ${IP_ALLOWLIST_PARAMETER_NAME} に値がありません`);
  }

  const list = parseAllowlist(value);
  allowlistCache = { list, expiresAt: now + CACHE_TTL_MS };
  return list;
}

/**
 * 認証方式を返す。取得と解釈に成功したときだけキャッシュする（許可リストと同じ。失敗を保持すると、
 * 直した後も次の期限までは 503 のままになる）。
 */
async function getAuthMode(now: number): Promise<AuthMode> {
  if (authModeCache && authModeCache.expiresAt > now) {
    return authModeCache.value;
  }
  const response = await getSsmClient().send(
    new GetParameterCommand({ Name: AUTH_MODE_PARAMETER_NAME }),
  );
  const value = parseAuthMode(response.Parameter?.Value);
  authModeCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

async function getOidcConfig(now: number): Promise<OidcConfig> {
  if (oidcConfigCache && oidcConfigCache.expiresAt > now) {
    return oidcConfigCache.value;
  }
  const response = await getSsmClient().send(
    new GetParameterCommand({ Name: AUTH_OIDC_PARAMETER_NAME }),
  );
  const value = parseOidcConfig(response.Parameter?.Value);
  oidcConfigCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

function getOidcProvider(): AuthProvider {
  if (!oidcProvider) {
    oidcProvider = createOidcProvider({ getConfig: () => getOidcConfig(Date.now()) });
  }
  return oidcProvider;
}

const basicProvider = createBasicProvider(() => getExpectedAuthorization(Date.now()));

/**
 * SPA のディープリンク（`/matrix`・`/requests?ids=...` など）を `/index.html` に寄せる（Issue #141）。
 *
 * 以前は CloudFront のカスタムエラー応答（403 → index.html）で寄せていたが、これはディストリビューション全体に効くので、
 * API Gateway が返す 403（権限なし。FR-6.5）まで HTML に書き換えた（応答ヘッダー `x-cache: Error from cloudfront`、本文 HTML の 200）。
 * そこでカスタムエラー応答を外し、認証を通ったリクエストの uri を、ここで書き換える。
 *
 * 書き換えない: `/`（`default_root_object` が index.html にする）、`/api` と `/api/*`、最後の区間に `.` を含むパス
 * （`/assets/*.js` など実ファイル。S3 に無ければ 403 / 404 がそのまま返る）。
 */
export function rewriteSpaRoute(request: CloudFrontRequest): void {
  const uri = request.uri;
  if (uri === "/" || uri === "/api" || uri.startsWith("/api/")) return;
  const last = uri.slice(uri.lastIndexOf("/") + 1);
  if (last.includes(".")) return;
  request.uri = "/index.html";
}

/**
 * viewer-request ハンドラ。
 *
 * 判定の順序は IP 許可リスト、次に認証プロバイダー。通すのはプロバイダーが `request` を返したときだけで、
 * 設定を取得できない場合は**通さない**（fail closed）。
 */
export async function handler(
  event: CloudFrontRequestEvent,
): Promise<CloudFrontRequestResult> {
  const request = event.Records[0]?.cf.request;
  if (!request) {
    console.error("[rolust-edge-auth] CloudFront のリクエストを取り出せませんでした");
    return serviceUnavailable();
  }

  // IP 判定は認証より前。拒否した IP には、資格情報の取得も認証の情報も渡さない。
  let allowlist: Cidr[];
  try {
    allowlist = await getAllowlist(Date.now());
  } catch (error) {
    // 握り潰さず記録する。許可リストが読めないときは、誰も通さない。
    console.error("[rolust-edge-auth] 許可 IP の一覧を取得できませんでした", error);
    return serviceUnavailable();
  }
  if (!isAllowed(request.clientIp, allowlist)) {
    return forbidden();
  }

  // 実行者のヘッダーは、ビューアが送ったものを認証方式によらず必ず捨てる（Issue #120）。通すリクエストに付けるのは、
  // 認証を通したプロバイダーだけ。付与と除去を一体にすると、付与しない経路で偽装が素通りする。
  stripActor(request);

  let mode: AuthMode;
  try {
    mode = await getAuthMode(Date.now());
  } catch (error) {
    // 握り潰さず記録する。方式が決まらないときは、誰も通さない。
    console.error("[rolust-edge-auth] 認証方式を取得できませんでした", error);
    return serviceUnavailable();
  }

  // ログアウトは認証を要求しない（期限切れや改ざんの Cookie でも消せるように）。IP 判定の後、プロバイダーの前（Issue #160）。
  if (mode === "cognito" && request.uri === LOGOUT_PATH) {
    let config: OidcConfig;
    try {
      config = await getOidcConfig(Date.now());
    } catch (error) {
      console.error("[rolust-edge-auth] OIDC の設定を取得できませんでした", error);
      return serviceUnavailable();
    }
    return buildLogoutResponse(request, config);
  }

  const provider = mode === "cognito" ? getOidcProvider() : basicProvider;
  const result = await provider(request);
  // 通すとき（プロバイダーが同じ request を返したとき）だけ、画面のパスを index.html に寄せる。
  // 応答（401・302・503 など）は書き換えない。サインインの戻り先は、書き換える前の uri から作られている。
  if (result === request) rewriteSpaRoute(request);
  return result;
}
