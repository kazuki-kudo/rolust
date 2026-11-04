import type {
  AddUsersResponse,
  AddUsersUserInput,
  ApiErrorBody,
  LocalizedMessage,
  AttributeColumnInput,
  SaveAttributeColumnsResponse,
  SaveUserAttributesResponse,
  ApplyResponse,
  ChangeRequestsResponse,
  ConfigResponse,
  CreateChangeRequestsResult,
  DeleteRoleResponse,
  RevertAssignmentsResponse,
  DiffResponse,
  DiscardResponse,
  DriftResponse,
  MeResponse,
  IamRole,
  MatrixView,
  PoolResponse,
  RoleColorId,
  RegisterRoleResponse,
  RepairResponse,
  ReorderRolesResponse,
  RolesResponse,
} from "@rolust/core";

/**
 * 型付き fetch ラッパ。
 *
 * 応答の異常は例外にして UI の error 状態へ渡す。握り潰して空配列を返すと、
 * 「データが 0 件」と「読み込めなかった」が画面上で区別できなくなる。
 */

/** 既定は同一オリジンの `/api`。CloudFront が API Gateway へ振り分ける。 */
const BASE_URL = import.meta.env.VITE_ROLUST_API_BASE_URL ?? "/api";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | null;
  readonly retryable: boolean;

  /** サーバが返した多言語の文言。旧 API・知らない ID のときは画面が `message` に戻る。 */
  readonly localized: LocalizedMessage | null;
  /** サーバが `message` を返したか。返さなかったときは画面が HTTP ステータス入りの定型文を出す。 */
  readonly hasServerMessage: boolean;
  /** ネットワーク失敗の原因の文字列。 */
  readonly detail: string | null;

  constructor(status: number, body: Partial<ApiErrorBody>, extra?: { detail?: string }) {
    super(
      body.message ??
        (extra?.detail !== undefined
          ? // eslint-disable-next-line no-restricted-syntax -- ログと旧テスト向けの日本語。画面は describeError で描画する
            `サーバに接続できませんでした: ${extra.detail}`
          : // eslint-disable-next-line no-restricted-syntax -- ログと旧テスト向けの日本語。画面は describeError で描画する
            `API 呼び出しに失敗しました (HTTP ${status})`),
    );
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.code ?? "UnknownError";
    this.field = body.field ?? null;
    this.retryable = body.retryable ?? false;
    this.localized = body.localized ?? null;
    this.hasServerMessage = body.message !== undefined;
    this.detail = extra?.detail ?? null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch (cause) {
    // ネットワーク層の失敗。再試行する価値がある。
    throw new ApiClientError(0, { code: "NetworkError", retryable: true }, { detail: String(cause) });
  }

  const text = await response.text();
  const parsed: unknown = text === "" ? null : safeParse(text);

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      (parsed as Partial<ApiErrorBody> | null) ?? {},
    );
  }
  return parsed as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export const api = {
  /**
   * デプロイ全体の実行時設定（質問 9 = A）。
   *
   * 画面 2 のロール名 blur 検証（GI-1）が、サーバと同じ接頭辞判定を再実装せずに
   * 済ませるために使う。取得に失敗しても登録そのものは止めない —
   * `POST /roles` の検証は残っており、事前検証は前倒しにすぎないためである。
   */
  getConfig: () => request<ConfigResponse>("GET", "/config"),

  /** 呼び出した人の権限（Issue #141）。画面が操作の有効・無効を決めるのに使う。拒否は API が行う。 */
  getMe: () => request<MeResponse>("GET", "/me"),

  // --- FR-7.1 ユーザプール管理（プールはデプロイにつき 1 つ。Issue #108） ---
  getPool: () => request<PoolResponse>("GET", "/pool"),

  addUsers: (
    input:
      | { accountId: string; userNames: string[] }
      | { accountId: string; users: AddUsersUserInput[] },
  ) => request<AddUsersResponse>("POST", "/pool/users", input),

  /** IamUser の削除（質問 4 = B）。配下の Assignment を連鎖削除する。 */
  deleteUser: (userArn: string) =>
    request<{ arn: string; removedAssignments: number }>(
      "DELETE",
      `/pool/users?arn=${encodeURIComponent(userArn)}`,
    ),

  /** 属性の項目の定義を丸ごと置き換える（Issue #61）。`columnId` の無い列が新規。 */
  saveAttributeColumns: (columns: AttributeColumnInput[]) =>
    request<SaveAttributeColumnsResponse>("PUT", "/pool/attribute-columns", { columns }),

  /** 1 ユーザの属性を丸ごと置き換える（Issue #61）。 */
  saveUserAttributes: (userArn: string, attributes: Record<string, string>) =>
    request<SaveUserAttributesResponse>(
      "PUT",
      `/pool/users/attributes?arn=${encodeURIComponent(userArn)}`,
      { attributes },
    ),

  // --- FR-7.2 IAMロール管理 ---
  listRoles: () => request<RolesResponse>("GET", "/roles"),

  /** ロールを新規登録する。登録と同時に固定プールへ紐づけ、信頼ポリシーから IAMユーザを取り込む（Issue #135）。 */
  createRole: (input: {
    accountId: string;
    roleName: string;
    displayName?: string | null;
    description?: string | null;
  }) =>
    request<RegisterRoleResponse>("POST", "/roles", input),

  /** ロールの並び順（マトリクスの列順）を保存する（FR-2.6 / Issue #135）。全登録ロールの ARN を、左から並べて送る。 */
  reorderRoles: (roleArns: string[]) => request<ReorderRolesResponse>("PUT", "/roles/order", { roleArns }),

  /** ロールの背景色を編集する（Issue #100）。`null` で解除。 */
  updateRoleColor: (roleArn: string, color: RoleColorId | null) =>
    request<{ role: IamRole }>("PATCH", `/roles?arn=${encodeURIComponent(roleArn)}`, { color }),

  /** ロールの表示名・説明を編集する（Issue #150・#21）。変えた項目だけを渡す。 */
  updateRoleFields: (roleArn: string, fields: { displayName?: string | null; description?: string | null }) =>
    request<{ role: IamRole }>("PATCH", `/roles?arn=${encodeURIComponent(roleArn)}`, fields),

  /** ロールを削除する（FR-2.4 / Issue #22）。未反映の申請があれば 409（Issue #135 で、紐づきは理由にしない）。 */
  deleteRole: (roleArn: string) =>
    request<DeleteRoleResponse>("DELETE", `/roles?arn=${encodeURIComponent(roleArn)}`),

  // --- FR-7.3 IAMロール割り当て ---
  getMatrix: () => request<MatrixView>("GET", "/pool/matrix"),

  /** 交点 1 件の保存（MQ-4）。AWS へは書き込まれない（FR-3.2）。 */
  saveAssignment: (input: { userArn: string; roleArn: string; checked: boolean }) =>
    request<{ assignment: MatrixView["assignments"][number] }>("PUT", "/pool/assignments", input),

  /** 未反映の変更をまとめて取り消す（Issue #88）。AWS へは書き込まれない（FR-3.2）。 */
  revertAssignments: () => request<RevertAssignmentsResponse>("POST", "/pool/assignments/revert", {}),

  // --- FR-7.4 / FR-7.5 申請 ---
  createChangeRequests: (input: { roleArns: string[] }) =>
    request<CreateChangeRequestsResult>("POST", "/change-requests", input),

  /**
   * 申請履歴の一覧（FR-7.5）。`createdFrom`（ISO 日時）があれば、反映済み・破棄は作成日がそれ以降のものだけ。
   * 下書き・失敗は常に返る（Issue #116）。
   */
  listChangeRequests: (options: { createdFrom?: string } = {}) =>
    request<ChangeRequestsResponse>(
      "GET",
      options.createdFrom === undefined
        ? "/change-requests"
        : `/change-requests?createdFrom=${encodeURIComponent(options.createdFrom)}`,
    ),

  discardChangeRequest: (changeRequestId: string) =>
    request<DiscardResponse>(
      "POST",
      `/change-requests/${encodeURIComponent(changeRequestId)}/discard`,
    ),

  /**
   * 1 件の申請の差分を取る（FR-7.4 のカード単位ローディング / 質問 8 = A）。
   *
   * `GET /diff` の形は変えず、画面が id ごとに 1 件で並列に呼ぶ。**1 要素配列の展開を
   * この関数だけに閉じ込める**のが役割であり、呼び出し側に `views[0]` を書かせない。
   *
   * 申請が見つからない（反映済み・破棄済み・存在しない）場合、サーバは空の `views` を
   * 返す。これを `null` として返し、「読み込めなかった」（例外）と区別できるようにする。
   */
  getDiff: async (changeRequestId: string) => {
    const response = await request<DiffResponse>(
      "GET",
      `/diff?ids=${encodeURIComponent(changeRequestId)}`,
    );
    return response.views[0] ?? null;
  },

  /**
   * 登録済みの全ロールについて、Rolust の記録と実際の信頼ポリシーの乖離を確かめる（FR-4.9。Issue #170）。
   * 利用者の指示でだけ呼ぶ。読み取りだけで、サーバは何も保存しない。
   */
  getDrift: () => request<DriftResponse>("GET", "/drift"),

  /** 乖離を直す（Issue #172）。IAM を記録に合わせる下書きの申請を作る（FR-4.10）。AWS は書き換えない。 */
  restoreDrift: (roleArn: string) => request<RepairResponse>("POST", "/drift/restore", { roleArn }),
  /** 乖離を直す（Issue #172）。記録を IAM の現状に合わせる（FR-4.11）。AWS は書き換えない。 */
  adoptDrift: (roleArn: string) => request<RepairResponse>("POST", "/drift/adopt", { roleArn }),

  applyChangeRequests: (changeRequestIds: string[]) =>
    request<ApplyResponse>("POST", "/apply", { changeRequestIds }),
};
