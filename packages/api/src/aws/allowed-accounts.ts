import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { LocalizedMessage } from "@rolust/core";
import { ValidationError, localized } from "@rolust/core";

import { ApiError, ConfigurationError, awsErrorDetail, awsErrorName } from "../errors.js";

/**
 * ユーザプールに登録できる IAM ユーザの AWS アカウント ID の許可リスト（Issue #139）。
 *
 * SSM パラメータ（String）に、アカウント ID をカンマ区切りで置く。Terraform が初期値（デプロイ先アカウント）で
 * 作り、値は Terraform の管理外（`infra/lambda.tf` の `allowed_account_ids`）。追加は `put-parameter` で行う。
 *
 * **fail closed**: パラメータが無い・読めない・空・不正（12 桁でない要素を含む）ときは、許可リストなしとして
 * 登録を通さない。許可リストを読めないまま通すと、制約が黙って外れる。
 *
 * 読み取りは Lambda の実行コンテキストで 5 分キャッシュする（edge-auth と同じ）。失敗はキャッシュしない。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_ID = /^\d{12}$/;

/** 許可リストを読めない・使えない。登録は拒否する。入力の誤りではないので 400 にしない。 */
export class AllowedAccountsUnavailableError extends ApiError {
  constructor(message: LocalizedMessage, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(502, "AllowedAccountsUnavailable", message, options);
  }
}

/**
 * SSM パラメータの名前を環境変数から読む（Terraform 変数 `allowed_account_ids_parameter_name`）。
 *
 * `loadConfig` とは別にし、ユーザを登録するときだけ読む。不備が他の API を落とさないようにするため。
 */
export function loadAllowedAccountsParameterName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER?.trim();
  if (!name) {
    throw new ConfigurationError(
      "環境変数 ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER が設定されていません（許可するアカウント ID を置く SSM パラメータ名）。" +
        "Terraform 変数 allowed_account_ids_parameter_name と同じ値である必要があります",
    );
  }
  return name;
}

/** カンマ区切りの値を集合にする。空・空の要素・12 桁でない要素は、全体を拒否する。 */
export function parseAllowedAccountIds(value: string): Set<string> {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    throw new AllowedAccountsUnavailableError(localized("allowedAccounts.empty", {}));
  }
  const invalid = parts.filter((part) => !ACCOUNT_ID.test(part));
  if (invalid.length > 0) {
    throw new AllowedAccountsUnavailableError(localized("allowedAccounts.invalidValues", { invalid }));
  }
  return new Set(parts);
}

let cached: { accounts: Set<string>; fetchedAt: number } | null = null;
let client: SSMClient | null = null;

/** テスト用。キャッシュとクライアントを捨てる。 */
export function resetAllowedAccountsCache(): void {
  cached = null;
  client = null;
}

function getClient(env: NodeJS.ProcessEnv): SSMClient {
  if (client) return client;
  const region = env.AWS_REGION?.trim();
  client = new SSMClient(region ? { region } : {});
  return client;
}

/** 許可するアカウント ID の集合を返す。読めなければ AllowedAccountsUnavailableError。 */
export async function getAllowedAccountIds(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<ReadonlySet<string>> {
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.accounts;

  const name = loadAllowedAccountsParameterName(env);
  let value: string | undefined;
  try {
    const response = await getClient(env).send(new GetParameterCommand({ Name: name }));
    value = response.Parameter?.Value;
  } catch (error) {
    throw toReadFailure(name, error);
  }

  const accounts = parseAllowedAccountIds(value ?? "");
  cached = { accounts, fetchedAt: now };
  return accounts;
}

function toReadFailure(name: string, error: unknown): AllowedAccountsUnavailableError {
  const code = awsErrorName(error) ?? "Unknown";
  switch (code) {
    case "ParameterNotFound":
      return new AllowedAccountsUnavailableError(localized("allowedAccounts.paramMissing", { name, code }), {
        cause: error,
      });
    case "AccessDeniedException":
      return new AllowedAccountsUnavailableError(localized("allowedAccounts.accessDenied", { name, code }), {
        cause: error,
      });
    case "ThrottlingException":
    case "TooManyUpdates":
      return new AllowedAccountsUnavailableError(localized("allowedAccounts.throttled", { name, code }), {
        retryable: true,
        cause: error,
      });
    default:
      return new AllowedAccountsUnavailableError(
        localized("allowedAccounts.readFailed", { name, code, detail: awsErrorDetail(error) }),
        { cause: error },
      );
  }
}

/**
 * アカウント ID が許可リストにあることを確かめる。無ければ、何が・なぜ・どう直すかを含む ValidationError。
 * 許可リストを読めなければ AllowedAccountsUnavailableError（fail closed）。
 */
export async function assertAccountAllowed(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const allowed = await getAllowedAccountIds(env);
  if (!allowed.has(accountId)) {
    throw new ValidationError(
      localized("allowedAccounts.notAllowed", { accountId, parameterName: loadAllowedAccountsParameterName(env) }),
      "accountId",
    );
  }
}
