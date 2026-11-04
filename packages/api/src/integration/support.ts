import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

import { resetIamClient } from "../aws/iam-client.js";

/**
 * 統合テストの共通処理（Issue #176）。実 AWS を呼ぶテスト（`*.integration.test.ts`）が使う。
 *
 * 実値（アカウント ID・プロファイル名）は、このファイルにもテストにも持たない。呼び出し側が
 * 環境変数（`.local/rolust.env.example` の雛形）から受け取り、書き込みの前に STS で照合する。
 */

/** 統合テストがスキップされるときに、定数の計算だけに使う架空のアカウント ID。実 AWS は呼ばない。 */
export const PLACEHOLDER_ACCOUNT = "111122223333";

const ACCOUNT_SUFFIX = "_ACCOUNT";
const SETUP_HINT =
  "`.local/rolust.env.example` を `.local/rolust.env` に写して値を入れ、`source` してください";

/** ログに全桁を出さない（守る対象）。照合の失敗を見分けられる末尾 4 桁だけを出す。 */
function tail(accountId: string): string {
  return `…${accountId.slice(-4)}`;
}

/**
 * 統合テストに必要な環境変数を読む。
 *
 * `run` が偽（`ROLUST_INTEGRATION=1` でない）なら環境を見ない。通常の `npm run test` が設定の有無に
 * 左右されないため。真なら、未設定（空・空白だけを含む）の変数を**まとめて**列挙して失敗する。
 */
export function loadIntegrationEnv<K extends string>(
  names: readonly K[],
  run: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Record<K, string> {
  if (!run) {
    return Object.fromEntries(
      names.map((name) => [name, name.endsWith(ACCOUNT_SUFFIX) ? PLACEHOLDER_ACCOUNT : "skipped"]),
    ) as Record<K, string>;
  }

  const values = Object.fromEntries(names.map((name) => [name, env[name]?.trim() ?? ""])) as Record<
    K,
    string
  >;

  const missing = names.filter((name) => values[name] === "");
  if (missing.length > 0) {
    throw new Error(`統合テストに必要な環境変数が未設定です: ${missing.join(", ")}。${SETUP_HINT}`);
  }

  const accountNames = names.filter((name) => name.endsWith(ACCOUNT_SUFFIX));
  const malformed = accountNames.filter((name) => !/^[0-9]{12}$/.test(values[name]));
  if (malformed.length > 0) {
    throw new Error(`アカウント ID は 12 桁の数字で指定してください: ${malformed.join(", ")}`);
  }

  const owner = new Map<string, K>();
  for (const name of accountNames) {
    const other = owner.get(values[name]);
    if (other !== undefined) {
      throw new Error(
        `${other} と ${name} に同じアカウント ID が指定されています。別のアカウントを指定してください`,
      );
    }
    owner.set(values[name], name);
  }

  return values;
}

/**
 * 指定プロファイルの資格情報で処理を実行する。
 *
 * SDK はクライアント生成時に認証情報チェーンを解決するため、`AWS_PROFILE` を差し替えたうえで
 * キャッシュを捨てる必要がある。
 */
export async function withProfile<T>(profile: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.AWS_PROFILE;
  process.env.AWS_PROFILE = profile;
  resetIamClient();
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = previous;
    resetIamClient();
  }
}

/**
 * 書き込みの前の安全装置: プロファイルが、期待するアカウントの資格情報を指していることを確かめる。
 *
 * 誤ったアカウントに同名のロールがあると、気づかず書き換えてしまう。照合は、人が一度入力した期待 ID と
 * STS の応答の突き合わせなので、プロファイルの書き間違いも拾える。STS が失敗したら握りつぶさず、
 * プロファイル名を添えて失敗する（SSO の失効はここで分かる）。
 */
export async function assertCallerAccount(profile: string, expectedAccount: string): Promise<void> {
  const actual = await withProfile(profile, async () => {
    const sts = new STSClient({});
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      return identity.Account;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `プロファイル ${profile} の資格情報を確かめられません（SSO の失効など）: ${reason}`,
        { cause: error },
      );
    } finally {
      sts.destroy();
    }
  });

  if (actual !== expectedAccount) {
    throw new Error(
      `プロファイル ${profile} のアカウント（${actual === undefined ? "不明" : tail(actual)}）が、` +
        `期待するアカウント（${tail(expectedAccount)}）と一致しません。書き込みを中止しました`,
    );
  }
}
