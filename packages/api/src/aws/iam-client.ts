import {
  GetRoleCommand,
  IAMClient,
  ListRoleTagsCommand,
  UpdateAssumeRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { LocalizedMessage, TrustPolicyDocument } from "@rolust/core";
import {
  buildRoleArn,
  localized,
  parseRoleArn,
  parseTrustPolicy,
  renderMessage,
  serializeTrustPolicy,
} from "@rolust/core";

import { loadTargetRoleNames } from "../config.js";
import { awsErrorDetail, awsErrorName } from "../errors.js";

/**
 * AWS IAM クライアント。
 *
 * **ラップする IAM API は 3 つだけである**: `iam:GetRole`、
 * `iam:UpdateAssumeRolePolicy`、`iam:ListRoleTags`。それ以外の IAM API は import も
 * export もしない。`ListRoles` / `ListUsers` / `GetUser` / `SimulatePrincipalPolicy` は、
 * Rolust のどのコード経路からも到達できない（FR-5.7 / C-4 の担保の一部）。
 *
 * **`iam:ListRoleTags` は 3.4 のタグ方式移行で加わった**（RQ-4 = A）。登録時検証を
 * 成立させるために要る読み取りであり、`FR-5.7` の「AWS への問い合わせを信頼ポリシーの
 * 読み取りと更新の 2 時点に限る」を明確に破る。3.4 の承認ゲートで、登録時検証を残す
 * （誤りをそれが作られた場所で報せる）ほうを人間が選んだ結果である。
 *
 * 実行ロールにもこれらの権限を付与しない（`infra/iam.tf`）。二重の担保である。
 *
 * **`iam:GetRole` は CRUD 系統も持つ**（Issue #80。ロールの紐づけ時に、信頼ポリシーにいる IAM ユーザを取り込むため）。
 * タグ条件つきで、Diff 系統と同じ範囲の読み取り専用である。CRUD には読み取りだけの `IamTrustPolicyReader` を渡す。
 *
 * **別アカウントのロールは、ターゲット側のロールを引き受けて操作する**（Issue #85。`iam-policy-design-note.md` 3.3）。
 * `iam:GetRole`・`iam:UpdateAssumeRolePolicy`・`iam:ListRoleTags` は `RoleName` しか受け取らず、
 * **呼び出し元（クライアントの資格情報）のアカウントに対して解決される**。したがって、どの資格情報のクライアントで
 * 呼ぶかが、どのアカウントのロールに作用するかを決める。この選択は、クライアントを選ぶ 1 か所（`resolveClient`）に閉じてある。
 *
 * - ロールのアカウントがデプロイ先と同じ: 実行ロール自身の資格情報のクライアント（従来どおり）。
 * - 別アカウント: ターゲット側の Reader（読み取り）か Manager（更新）を引き受けた資格情報のクライアント。
 * - デプロイ先を判定できない（`null`）: どちらか決められないので、IAM を呼ばずに止める（`DeployAccountUnknown`）。
 *
 * **引き受けに失敗しても、デプロイ先の資格情報で呼び直さない。** 呼び直すと、別アカウントのロール向けの操作が
 * デプロイ先の同名ロールに作用し、監査記録の roleArn と実際に書き換えたロールが食い違う（Issue #27）。
 * 呼び直す分岐そのものを持たない（失敗は `IamOperationError` として返る）。
 *
 * NFR-3: 認証情報は SDK の認証情報チェーン（Lambda 実行ロール）と、そこから引き受けた一時資格情報だけから得る。
 * 資格情報を引数にも環境変数にも持たない。
 */

/**
 * IAM 呼び出しの失敗種別。管理者への提示（GI-6）と再試行判断に使う。
 *
 * `assume-role` と `deploy-account-unknown` は、IAM を呼ぶ前に止めた失敗である。
 * `assume-role` はターゲットアカウントのロールを引き受けられなかった（ロールが無い、信頼ポリシーが許していない）。
 */
export type IamFailureKind =
  | "access-denied"
  | "not-found"
  | "throttling"
  | "invalid-policy"
  | "assume-role"
  | "deploy-account-unknown"
  | "unknown";

/**
 * IAM 操作の失敗。AWS が返したコードとメッセージを隠さず保持する（GI-6 / M-3.3）。
 *
 * `message` は `localized` の ja の描画（SPA は `localized` を言語に合わせて描画する。Issue #94）。
 */
export class IamOperationError extends Error {
  readonly kind: IamFailureKind;
  /** AWS が返した例外名（`AccessDenied` など）。取得できなければ "UnknownError"。 */
  readonly errorCode: string;
  readonly roleArn: string;
  readonly retryable: boolean;
  readonly localized: LocalizedMessage;

  constructor(
    kind: IamFailureKind,
    errorCode: string,
    roleArn: string,
    message: LocalizedMessage,
    options?: { cause?: unknown },
  ) {
    super(renderMessage("ja", message), options && "cause" in options ? { cause: options.cause } : undefined);
    this.name = "IamOperationError";
    this.kind = kind;
    this.errorCode = errorCode;
    this.roleArn = roleArn;
    this.retryable = kind === "throttling";
    this.localized = message;
  }
}

/**
 * 信頼ポリシーを読むクライアント（FR-4.1 / FR-5.1。ロールの紐づけ時の取り込み。Issue #80）。
 *
 * 更新（`updateTrustPolicy`）とは**別のインタフェース**にしてある。CRUD 系統は `iam:GetRole` だけを持ち
 * `iam:UpdateAssumeRolePolicy` を持たない（FR-3.2）ので、更新の関数を持つ型を CRUD に渡すと、
 * 持っていない権限を呼べる形になる（`IamRoleTagClient` と同じ考え方）。
 */
export interface IamTrustPolicyReader {
  /** 信頼ポリシー（`AssumeRolePolicyDocument`）を読む（FR-4.1 / FR-5.1）。 */
  getTrustPolicy(roleArn: string): Promise<TrustPolicyDocument>;
}

export interface IamTrustPolicyClient extends IamTrustPolicyReader {
  /** 信頼ポリシーを更新する（FR-5.3）。 */
  updateTrustPolicy(roleArn: string, document: TrustPolicyDocument): Promise<void>;
}

/**
 * ロールのタグを読むクライアント（FR-2.1 / FR-7.2 の登録時検証）。
 *
 * 信頼ポリシーの読み書きとは**別のインタフェース**にしてある。両者は権限も
 * 使う Lambda も違う（タグ読み取りは CRUD、信頼ポリシーは Diff / Apply）ため、
 * 片方しか持たない系統に他方の型を配ると、持っていない権限を呼べる形になる。
 */
export interface IamRoleTagClient {
  /**
   * ロールに付いたタグを読む。
   *
   * @throws IamOperationError `kind: "not-found"` はロールが存在しない
   *   （`NoSuchEntity`）、`kind: "access-denied"` は実行ロールの権限不足。
   *   両者は呼び出し側で扱いが異なるため、潰さずに区別して返す。
   */
  listRoleTags(roleArn: string): Promise<Record<string, string>>;
}

/** ターゲットアカウントで引き受けるロールの役割。読み取りは Reader、更新は Manager だけ（spec D-1）。 */
type Tier = "reader" | "manager";

/** 実行ロール自身の資格情報のクライアント（デプロイ先アカウントのロール用）。 */
let ownClient: IAMClient | null = null;

/** ターゲットアカウントのロールを引き受けた資格情報のクライアント。キーは `<アカウント ID>:<役割>`。 */
const assumedClients = new Map<string, IAMClient>();

function getOwnClient(): IAMClient {
  // IAM はグローバルサービス。エンドポイントは us-east-1 に解決される。
  ownClient ??= new IAMClient({});
  return ownClient;
}

/** テスト用。キャッシュを捨てて次回の生成をやり直させる。 */
export function resetIamClient(): void {
  ownClient = null;
  assumedClients.clear();
}

/**
 * ロールのアカウントに応じて、IAM を呼ぶクライアント（= 資格情報）を選ぶ。
 *
 * **どのアカウントのロールに作用するかは、ここで選んだ資格情報が決める。** 選択をここに閉じ、
 * 失敗したときに別の資格情報へ切り替える分岐を持たない（Issue #27 の再発防止）。
 *
 * @throws IamOperationError `deploy-account-unknown`（デプロイ先を判定できない）、`assume-role`（引き受けに失敗）。
 *   どちらも IAM を呼ぶ前の失敗である。
 * @throws ConfigurationError 別アカウントを引き受けるのに、ロール名の環境変数が不正。
 */
async function resolveClient(
  roleArn: string,
  deployAccountId: string | null,
  tier: Tier,
): Promise<IAMClient> {
  const { accountId } = parseRoleArn(roleArn);

  if (deployAccountId === null) {
    throw new IamOperationError(
      "deploy-account-unknown",
      "DeployAccountUnknown",
      roleArn,
      localized("iam.deployAccountUnknown", { roleArn }),
    );
  }

  if (accountId === deployAccountId) return getOwnClient();

  return await getAssumedClient(roleArn, accountId, tier);
}

async function getAssumedClient(roleArn: string, accountId: string, tier: Tier): Promise<IAMClient> {
  const names = loadTargetRoleNames();
  const assumeRoleName = tier === "reader" ? names.readerRoleName : names.managerRoleName;
  const key = `${accountId}:${tier}`;

  // 同期で取得と登録を済ませる（await を挟まない）ので、同時に呼ばれても 1 つのアカウント・役割につき 1 つしか作らない。
  let client = assumedClients.get(key);
  if (!client) {
    client = new IAMClient({
      credentials: fromTemporaryCredentials({
        params: { RoleArn: buildRoleArn(accountId, assumeRoleName), RoleSessionName: sessionName() },
      }),
    });
    assumedClients.set(key, client);
  }

  try {
    // 資格情報を IAM の呼び出しの前に解決する。引き受けの失敗を、IAM の `AccessDenied` と区別するため。
    // クライアントが資格情報をキャッシュし、期限が近づくと更新するので、通常は STS を呼ばない。
    // 失敗しても、次の呼び出しでやり直す（ターゲット側を用意すれば、再起動なしで通る）。
    await client.config.credentials();
  } catch (cause) {
    throw assumeRoleFailure(roleArn, accountId, assumeRoleName, cause);
  }
  return client;
}

/**
 * 引き受けのセッション名。CloudTrail で、呼び出した系統（`rolust-crud`・`rolust-diff`・`rolust-apply`）を特定できる。
 * Lambda では関数名（`<project>-crud` など）。IAM のセッション名は英数字と `_+=,.@-` の 2〜64 文字。
 */
function sessionName(): string {
  const name = process.env.AWS_LAMBDA_FUNCTION_NAME?.trim() || "rolust-local";
  return name.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}

/** 引き受けの失敗を、原因と直し方を含む文言（GI-6）の `IamOperationError` にする。STS のコードは隠さない。 */
function assumeRoleFailure(
  roleArn: string,
  accountId: string,
  assumeRoleName: string,
  cause: unknown,
): IamOperationError {
  const code = awsErrorName(cause) ?? "UnknownError";
  const kind: IamFailureKind = classify(code) === "throttling" ? "throttling" : "assume-role";

  const detail = awsErrorDetail(cause);
  return new IamOperationError(
    kind,
    code,
    roleArn,
    localized("iam.assumeRoleFailed", { accountId, assumeRoleName, code, detail }),
    { cause },
  );
}

/** 信頼ポリシーを読むクライアント。`tier` は、引き受けるロールの役割（CRUD・Diff は Reader、Apply は Manager）。 */
function trustPolicyReader(deployAccountId: string | null, tier: Tier): IamTrustPolicyReader {
  return {
    async getTrustPolicy(roleArn: string): Promise<TrustPolicyDocument> {
      const { roleName } = parseRoleArn(roleArn);
      // クライアントの選択の失敗は、すでに分類済みの例外で返る。IAM の呼び出しの失敗とは分けて扱う。
      const client = await resolveClient(roleArn, deployAccountId, tier);
      try {
        const response = await client.send(new GetRoleCommand({ RoleName: roleName }));
        const raw = response.Role?.AssumeRolePolicyDocument;
        if (!raw) {
          throw new IamOperationError(
            "unknown",
            "EmptyAssumeRolePolicyDocument",
            roleArn,
            localized("iam.emptyPolicy", {}),
          );
        }
        return parseTrustPolicy(raw);
      } catch (error) {
        throw toIamOperationError(error, roleArn, "iam:GetRole");
      }
    },
  };
}

/**
 * 信頼ポリシーを読むだけのクライアント（CRUD・Diff 系統。`iam:GetRole`）。
 * 別アカウントのロールは Reader を引き受けて読む。
 *
 * @param deployAccountId デプロイ先の AWS アカウント ID（API Gateway の `requestContext.accountId`）。
 */
export function createIamTrustPolicyReader(deployAccountId: string | null): IamTrustPolicyReader {
  return trustPolicyReader(deployAccountId, "reader");
}

/**
 * 信頼ポリシーを読み書きするクライアント（Apply 系統）。別アカウントのロールは Manager を引き受けて読み書きする。
 * Apply の実行ロールが引き受けられるのは Manager だけなので、読み取りも Manager で行う。
 *
 * @param deployAccountId デプロイ先の AWS アカウント ID（API Gateway の `requestContext.accountId`）。
 */
export function createIamTrustPolicyClient(deployAccountId: string | null): IamTrustPolicyClient {
  return {
    ...trustPolicyReader(deployAccountId, "manager"),

    async updateTrustPolicy(
      roleArn: string,
      document: TrustPolicyDocument,
    ): Promise<void> {
      const { roleName } = parseRoleArn(roleArn);
      const client = await resolveClient(roleArn, deployAccountId, "manager");
      try {
        await client.send(
          new UpdateAssumeRolePolicyCommand({
            RoleName: roleName,
            PolicyDocument: serializeTrustPolicy(document),
          }),
        );
      } catch (error) {
        throw toIamOperationError(error, roleArn, "iam:UpdateAssumeRolePolicy");
      }
    },
  };
}

/**
 * ロールのタグを読むクライアント（CRUD 系統。ロール登録時の検証）。別アカウントのロールは Reader を引き受けて読む。
 *
 * @param deployAccountId デプロイ先の AWS アカウント ID（API Gateway の `requestContext.accountId`）。
 */
export function createIamRoleTagClient(deployAccountId: string | null): IamRoleTagClient {
  return {
    async listRoleTags(roleArn: string): Promise<Record<string, string>> {
      const { roleName } = parseRoleArn(roleArn);
      const client = await resolveClient(roleArn, deployAccountId, "reader");
      const tags: Record<string, string> = {};
      let marker: string | undefined;

      try {
        // ページングを最後まで辿る。打ち切ると「タグが無い」と「まだ読んでいない」が
        // 区別できなくなり、正しくタグ付けされたロールを登録時に弾きうる。
        do {
          const response = await client.send(
            new ListRoleTagsCommand({ RoleName: roleName, Marker: marker }),
          );
          for (const tag of response.Tags ?? []) {
            if (tag.Key !== undefined) tags[tag.Key] = tag.Value ?? "";
          }
          marker = response.IsTruncated ? response.Marker : undefined;
        } while (marker);
      } catch (error) {
        throw toIamOperationError(error, roleArn, "iam:ListRoleTags");
      }

      return tags;
    },
  };
}

/**
 * AWS SDK の例外を `IamOperationError` へ分類する（FR-5.5 の失敗記録に載る形）。
 *
 * 分類できない例外も握り潰さず `unknown` として返す。
 */
export function toIamOperationError(
  error: unknown,
  roleArn: string,
  operation: string,
): IamOperationError {
  if (error instanceof IamOperationError) return error;

  const name = awsErrorName(error) ?? "UnknownError";
  const kind = classify(name);
  const detail = awsErrorDetail(error);

  const invalidUserArn = invalidPrincipalUserArn(name, detail);
  const message =
    invalidUserArn !== null && detail !== null
      ? localized("iam.invalidPrincipalUser", { userArn: invalidUserArn, detail })
      : withRoleContext(kind, roleArn, operation, detail);

  return new IamOperationError(kind, name, roleArn, message, { cause: error });
}

/**
 * 実在しない IAM ユーザを `Principal.AWS` に書いたときの IAM の拒否から、そのユーザの ARN を取り出す（Issue #208）。
 *
 * 実 IAM が返す原文は、例外名 `MalformedPolicyDocumentException`、メッセージ
 * `Invalid principal in policy: "AWS":"<ARN>"`（2026-11-02 の実測。パス付きのユーザ・別アカウントのユーザも同じ形。
 * ロールの不在も同じ形で、ユーザとの違いは ARN の種別だけ）。複数の不在があるときに返るのは先頭の 1 件だけである。
 *
 * 判定は狭くとる: 例外名が MalformedPolicyDocument 系で、原文がこの形で、ARN がユーザのものであるときだけ返す。
 * AWS の文言が変わって合わなくなっても、誤って「ユーザが無い」と言わず、AWS の原文を出す側へ倒れる。
 */
function invalidPrincipalUserArn(errorName: string, detail: string | null): string | null {
  if (errorName !== "MalformedPolicyDocument" && errorName !== "MalformedPolicyDocumentException") return null;
  if (detail === null) return null;
  const match = /^Invalid principal in policy: "AWS":"(arn:aws[a-z-]*:iam::\d{12}:user\/[^"]+)"/.exec(detail);
  return match?.[1] ?? null;
}

/**
 * 「存在しない」「権限不足」の文言に、対象のアカウント ID とロール名を添える（spec D-10）。
 *
 * IAM のメッセージはロール名しか示さない。デプロイ先に同名のロールがあると、どのアカウントのロールの失敗かを
 * 文言から区別できず、運用者が違うアカウントを直しに行く。AWS のコードとメッセージは隠さない（GI-6）。
 */
function withRoleContext(
  kind: IamFailureKind,
  roleArn: string,
  operation: string,
  detail: string | null,
): LocalizedMessage {
  if (kind !== "not-found" && kind !== "access-denied") return localized("iam.awsMessage", { operation, detail });
  const { accountId, roleName } = parseRoleArn(roleArn);
  return localized("iam.awsMessageForRole", { accountId, roleName, operation, detail });
}

function classify(errorName: string): IamFailureKind {
  if (errorName.startsWith("AccessDenied") || errorName === "UnauthorizedOperation") {
    return "access-denied";
  }
  if (errorName === "NoSuchEntity" || errorName === "NoSuchEntityException") {
    return "not-found";
  }
  if (
    errorName === "Throttling" ||
    errorName === "ThrottlingException" ||
    errorName === "TooManyRequestsException" ||
    errorName === "LimitExceeded"
  ) {
    return "throttling";
  }
  if (
    errorName === "MalformedPolicyDocument" ||
    errorName === "MalformedPolicyDocumentException" ||
    errorName === "PolicyNotAttachable"
  ) {
    return "invalid-policy";
  }
  return "unknown";
}
