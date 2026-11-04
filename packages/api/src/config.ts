import { ConfigurationError } from "./errors.js";

/**
 * 実行時設定。
 *
 * NFR-3: AWS の認証情報はここでは扱わない。Lambda 実行ロール（本番）または
 * ローカルの AWS 認証情報チェーンから SDK が自動的に取得する。
 */
export interface ApiConfig {
  /** 状態テーブル（UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner）の名前。 */
  stateTableName: string;
  /** 申請テーブル（ChangeRequest・RoleLock）の名前。 */
  changeRequestTableName: string;
  /** リージョン。Lambda では実行環境が設定するため通常は未指定でよい。 */
  region: string | undefined;
  /**
   * 管理対象 IAM ロールを示す**タグのキー**（Terraform 変数 `managed_tag_key`）。
   *
   * IAM ポリシー側の `aws:ResourceTag/<このキー>` 条件と対になる値であり、
   * 環境ごとに変わる。したがってコードに焼き込まず環境変数から読む（NFR-3 と同じ理由）。
   */
  managedTagKey: string;
  /**
   * そのタグが取るべき**値**（Terraform 変数 `managed_tag_value`）。
   *
   * IAM ポリシーは `StringEquals` で完全一致を要求する。登録時検証も同じ基準で判定する。
   */
  managedTagValue: string;
  /** 固定のユーザプールの識別子（Terraform 変数 `pool_id`。Issue #108）。DynamoDB のキー `POOL#<poolId>` に使う。 */
  poolId: string;
}

/**
 * 環境変数から設定を読む。未設定なら起動時に fail fast する。
 *
 * 既定値でごまかすと、存在しないテーブルへの `ResourceNotFoundException` として
 * 実行時に初めて現れ、原因の特定が遠くなる。
 *
 * **タグの 2 変数も必須である。** 接頭辞方式では空文字が「絞り込みなし」という
 * 定義済みの意味を持ったが、タグ方式に「タグなし」という安全な既定値は無い。
 * 空を許すと、登録時検証が素通りするか、`<key>=""` に一致するロールだけが対象という
 * 無意味な状態になる。どちらも「絞り込んでいるように見えて絞り込んでいない」形であり、
 * 起動時に落とすほうが安全である。値は `infra/lambda.tf` が Lambda へ渡す
 * `ROLUST_MANAGED_TAG_KEY` / `ROLUST_MANAGED_TAG_VALUE` と対になる。
 *
 * テーブルは状態と申請の 2 本（Issue #36）。廃止した `ROLUST_TABLE_NAME` が残っていれば落とす。
 * 旧い設定のまま空のテーブルを見るより、原因が早く分かる。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  if (env.ROLUST_TABLE_NAME !== undefined) {
    throw new ConfigurationError(
      "環境変数 ROLUST_TABLE_NAME は廃止されました（Issue #36）。" +
        "ROLUST_STATE_TABLE_NAME と ROLUST_CHANGE_REQUEST_TABLE_NAME を設定してください",
    );
  }

  const stateTableName = env.ROLUST_STATE_TABLE_NAME?.trim();
  if (!stateTableName) {
    throw new ConfigurationError(
      "環境変数 ROLUST_STATE_TABLE_NAME が設定されていません（DynamoDB の状態テーブル名）",
    );
  }

  const changeRequestTableName = env.ROLUST_CHANGE_REQUEST_TABLE_NAME?.trim();
  if (!changeRequestTableName) {
    throw new ConfigurationError(
      "環境変数 ROLUST_CHANGE_REQUEST_TABLE_NAME が設定されていません（DynamoDB の申請テーブル名）",
    );
  }

  if (stateTableName === changeRequestTableName) {
    throw new ConfigurationError(
      "ROLUST_STATE_TABLE_NAME と ROLUST_CHANGE_REQUEST_TABLE_NAME には別々のテーブル名を設定してください",
    );
  }

  const managedTagKey = env.ROLUST_MANAGED_TAG_KEY?.trim();
  if (!managedTagKey) {
    throw new ConfigurationError(
      "環境変数 ROLUST_MANAGED_TAG_KEY が設定されていません（管理対象 IAM ロールを示すタグのキー）。" +
        "Terraform 変数 managed_tag_key と同じ値である必要があります",
    );
  }

  const managedTagValue = env.ROLUST_MANAGED_TAG_VALUE?.trim();
  if (!managedTagValue) {
    throw new ConfigurationError(
      "環境変数 ROLUST_MANAGED_TAG_VALUE が設定されていません（管理対象 IAM ロールのタグが取るべき値）。" +
        "Terraform 変数 managed_tag_value と同じ値である必要があります",
    );
  }

  const poolId = env.ROLUST_POOL_ID?.trim();
  if (!poolId || !isValidPoolId(poolId)) {
    throw new ConfigurationError(
      "環境変数 ROLUST_POOL_ID が設定されていないか、書式が不正です（英数字と . _ - のみ、1〜64 文字）。" +
        "Terraform 変数 pool_id と同じ値である必要があります",
    );
  }

  return {
    stateTableName,
    changeRequestTableName,
    region: env.AWS_REGION?.trim() || undefined,
    managedTagKey,
    managedTagValue,
    poolId,
  };
}

/**
 * 管理画面と API の認証方式（Terraform 変数 `auth_mode`。Issue #141）。権限の判定が、これでグループを読むかを決める。
 * `basic` はグループを識別できないので全権限、`cognito` は `x-rolust-actor` のグループで決める。
 *
 * 未設定・不正は落とす。既定値（とくに `basic` = 全権限）に倒すと、設定の付け忘れが権限過多になる。
 */
export type AuthMode = "basic" | "cognito";

export function loadAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const value = env.ROLUST_AUTH_MODE?.trim();
  if (value !== "basic" && value !== "cognito") {
    throw new ConfigurationError(
      "環境変数 ROLUST_AUTH_MODE は basic または cognito でなければなりません（Terraform 変数 auth_mode と同じ値）",
    );
  }
  return value;
}

/** プール識別子の書式（interaction-spec.md § 入力検証: 1〜64 文字）。 */
const POOL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidPoolId(poolId: string): boolean {
  return POOL_ID_PATTERN.test(poolId);
}

/**
 * クロスアカウントで、別アカウントのロールを操作するために引き受ける、ターゲット側のロールの名前
 * （Issue #85。`docs/design/iam-policy-design-note.md` 3.3）。
 *
 * Terraform 変数 `target_reader_role_name`・`target_manager_role_name` と対になる値で、`infra/lambda.tf` が
 * 環境変数 `ROLUST_TARGET_READER_ROLE_NAME`・`ROLUST_TARGET_MANAGER_ROLE_NAME` として渡す。IAM ポリシーの
 * `sts:AssumeRole` の Resource（`arn:aws:iam::*:role/<この名前>`）と同じ値でなければ、引き受けは `AccessDenied` になる。
 */
export interface TargetRoleNames {
  /** 読み取り用。CRUD と Diff が引き受ける（`iam:GetRole`・`iam:ListRoleTags`。読み取り専用）。 */
  readerRoleName: string;
  /** 更新用。Apply だけが引き受ける（`iam:GetRole`・`iam:UpdateAssumeRolePolicy`）。 */
  managerRoleName: string;
}

/** IAM ロール名。ワイルドカード（`*`）とパス（`/`）は含まない。Terraform 変数の `validation` と同じ書式。 */
const IAM_ROLE_NAME = /^[A-Za-z0-9+=,.@_-]{1,64}$/;

/**
 * 引き受けるロールの名前を環境変数から読む。
 *
 * **`loadConfig` とは別にし、別アカウントのロールを引き受けるときだけ読む。** 同じアカウントのロールだけを扱う運用で、
 * この 2 変数の不備が全リクエストを落とさないようにするため。不備があれば、別アカウントの操作が、原因を示す
 * `ConfigurationError` で失敗する。
 *
 * Reader と Manager が同じ名前なら落とす。同じだと、CRUD・Diff が更新用のロールを引き受けられる形になり、
 * CRUD が AWS へ書き込まないという保証（FR-3.2）が外れる。
 */
export function loadTargetRoleNames(env: NodeJS.ProcessEnv = process.env): TargetRoleNames {
  const readerRoleName = readTargetRoleName(env, "ROLUST_TARGET_READER_ROLE_NAME", "target_reader_role_name");
  const managerRoleName = readTargetRoleName(env, "ROLUST_TARGET_MANAGER_ROLE_NAME", "target_manager_role_name");

  if (readerRoleName === managerRoleName) {
    throw new ConfigurationError(
      "ROLUST_TARGET_READER_ROLE_NAME と ROLUST_TARGET_MANAGER_ROLE_NAME には別々の名前を設定してください。" +
        "同じ名前だと、CRUD・Diff が更新用のロールを引き受けられる形になります。CRUD は AWS へ書き込めないという保証が外れます",
    );
  }

  return { readerRoleName, managerRoleName };
}

/** Rolust 自身の実行ロール 1 本（Issue #194）。照合はアカウント ID とロール名の対で行う。 */
export interface SelfRole {
  accountId: string;
  roleName: string;
}

/** IAM ロールの ARN。パーティションは問わない（照合に使わない）。パスとワイルドカードは許さない。 */
const ROLE_ARN_PATTERN = /^arn:[a-z0-9-]+:iam::(\d{12}):role\/([A-Za-z0-9+=,.@_-]{1,64})$/;

/**
 * Rolust 自身の実行ロールを環境変数から読む（Issue #194）。
 *
 * `infra/lambda.tf` が `local.self_role_arns`（IAM ポリシーの `Sid: DenySelfEscalation` の `Resource` と
 * **同じ値**）をカンマ区切りで渡す。同じ `local` を参照するので、ポリシーとこの一覧が食い違うことはない。
 *
 * **`loadConfig` とは別にし、ロールの登録（`POST /roles`）だけが読む。** この 1 変数の不備で全リクエストを
 * 落とさないため。未設定・書式不正・0 件は `ConfigurationError` にする。既定を「空（＝拒否しない）」に倒すと、
 * 設定の付け忘れが「検査しているつもりで検査していない」状態になる（タグの 2 変数と同じ理由）。
 *
 * パーティション（`aws` / `aws-cn` など）は読み取るが照合には使わない。表記の差で照合が黙って外れるのを
 * 避けるため、アカウント ID とロール名の対で比べる。
 */
export function loadSelfRoleArns(env: NodeJS.ProcessEnv = process.env): SelfRole[] {
  const raw = env.ROLUST_SELF_ROLE_ARNS ?? "";
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (entries.length === 0) {
    throw new ConfigurationError(
      "環境変数 ROLUST_SELF_ROLE_ARNS が設定されていません（Rolust 自身の実行ロールの ARN。カンマ区切り）。" +
        "infra/main.tf の local.self_role_arns と同じ値である必要があります",
    );
  }

  return entries.map((entry) => {
    const match = ROLE_ARN_PATTERN.exec(entry);
    if (!match) {
      throw new ConfigurationError(
        `環境変数 ROLUST_SELF_ROLE_ARNS の要素「${entry}」は IAM ロールの ARN ではありません` +
          "（arn:<partition>:iam::<12 桁のアカウント ID>:role/<ロール名>。パスとワイルドカードは使えません）",
      );
    }
    return { accountId: match[1] as string, roleName: match[2] as string };
  });
}

function readTargetRoleName(env: NodeJS.ProcessEnv, envName: string, variableName: string): string {
  const value = env[envName]?.trim();
  if (!value) {
    throw new ConfigurationError(
      `環境変数 ${envName} が設定されていません（別アカウントで引き受けるロールの名前）。` +
        `Terraform 変数 ${variableName} と同じ値である必要があります`,
    );
  }
  if (!IAM_ROLE_NAME.test(value)) {
    throw new ConfigurationError(
      `環境変数 ${envName} の値「${value}」は、IAM ロール名に使える文字（英数字と + = , . @ _ -）の 1〜64 文字ではありません。` +
        "ワイルドカード（*）とパス（/）は使えません",
    );
  }
  return value;
}
