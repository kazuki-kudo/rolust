import type { TrustPolicyDiff } from "./diff.js";
import type { LocalizedMessage } from "./messages/types.js";
import type { Permission } from "./permission.js";
import type { UnmanagedPrincipal } from "./unmanaged.js";
import type {
  Actor,
  Assignment,
  AttributeColumn,
  ChangeRequest,
  ChangeRequestStatus,
  IamRole,
  IamUser,
  UserPool,
} from "./types.js";

/**
 * REST API の応答の型（`packages/api` と `packages/web` の共有契約）。
 *
 * ここに置くのは、両パッケージが同じ形を別々に宣言して静かにずれるのを防ぐため。
 * core は AWS SDK にも React にも依存しないため、どちらからも安全に参照できる。
 */

/**
 * `GET /api/config` — デプロイ全体の実行時設定（質問 9 = A / 質問 10 = A）。
 *
 * ロール集合の属性ではなくデプロイ単位の設定値であるため、`RolesResponse` に同梱せず
 * 独立した経路に置く。画面 2 の登録モーダルが、対象ロールに必要なタグを**要件として
 * 表示する**ために使う。事前検証には使えない（タグは AWS 上のロールにしか無いため）。
 *
 * 値そのものは登録時検証が返す 400 の本文に既に含まれており、
 * この経路で新たに露出する情報はない。
 */
/** `GET /api/me` — 呼び出した人の権限（Issue #141）。SPA が操作の有効・無効を決めるのに使う。拒否は API が行う。 */
export interface MeResponse {
  permission: Permission;
  actor: Actor | null;
  /** 認証方式（Issue #160）。`cognito` のときだけ、SPA がログアウトの操作を出す。 */
  authMode: "basic" | "cognito";
}

export interface ConfigResponse {
  /** 管理対象 IAM ロールを示すタグのキー（`infra` の `managed_tag_key`）。 */
  managedTagKey: string;
  /** そのタグが取るべき値。IAM ポリシーは `StringEquals` で完全一致を要求する。 */
  managedTagValue: string;
}

/** FR-4.6 のロールロック。「このロールには未反映の申請が 1 件ある」という事実。 */
export interface RoleLock {
  roleArn: string;
  changeRequestId: string;
  /** ロックを保持している申請の状態（`draft` または `failed`）。 */
  status: ChangeRequestStatus;
  createdAt: string;
}

/** `GET /api/pool`（画面 1。Issue #108 で `GET /api/pools` の一覧から、固定の 1 つに改めた）。 */
export interface PoolView extends UserPool {
  users: IamUser[];
  /** このプールに紐づく IamRole の件数（FR-1.7）。画面 1 の見出しに出す。 */
  linkedRoleCount: number;
}

export interface PoolResponse {
  pool: PoolView;
}

/** `GET /api/roles` の 1 件（画面 2 の「未反映の申請」列を含む）。 */
export interface RoleView extends IamRole {
  unreflected: RoleLock | null;
  /** このロールの割り当て（`checked` または `reflected`）の件数。削除の確認に出す（Issue #135）。 */
  assignments: AssignmentSummary;
}

/** `POST /api/roles` の応答（Issue #135）。登録と同時に紐づけ、信頼ポリシーから取り込んだ結果を返す。 */
export interface RegisterRoleResponse {
  role: IamRole;
  imported: ImportedRole;
}

/** `PUT /api/roles/order` の応答（Issue #135）。保存後の列順（マトリクスの左から）。 */
export interface ReorderRolesResponse {
  roleArns: string[];
}

export interface RolesResponse {
  roles: RoleView[];
}

/** `POST /api/pool/assignments/revert`（FR-3.2 / Issue #88）。 */
export interface RevertAssignmentsResponse {
  /** `checked` を `reflected` にそろえた交点の件数。 */
  reverted: number;
  /** 未反映の申請（ロック）があるため触れなかったロール（変更のある列だけ）。 */
  skippedRoleArns: string[];
  /** 保存に失敗した交点。やり直せば残りが戻る（取り消しは冪等）。 */
  failures: { userArn: string; roleArn: string; message: string; localized?: LocalizedMessage }[];
}

/** `DELETE /api/roles?arn=`（FR-2.4 / Issue #22）。 */
export interface DeleteRoleResponse {
  roleArn: string;
  /** 片付けた、残っていた交点の件数（固定プールの分。Issue #108）。 */
  removedAssignments: number;
}

/** 削除すると消える、そのロールの割り当ての件数（Issue #79。Issue #135 で、削除の確認に出すものに改めた）。 */
export interface AssignmentSummary {
  /** `checked` または `reflected` の交点の数（チェックも反映も無い残骸は数えない）。 */
  total: number;
  /** そのうち `checked` と `reflected` が食い違う（未反映の変更がある）交点の数。 */
  pending: number;
}

/**
 * 登録時の信頼ポリシーからの取り込みの結果（Issue #80。Issue #135 で、紐づけ時から登録時に移した）。
 * デプロイ先と別アカウントのロールも、ターゲット側の Reader を引き受けて読み、同じように取り込む（Issue #85）。
 */
export interface ImportedRole {
  roleArn: string;
  /** 取り込み対象だった IAM ユーザの数（信頼ポリシーにいた、パスなしの IAM ユーザ）。 */
  userCount: number;
  /** そのうち、当該プールに新しく登録した数。 */
  registeredCount: number;
  /**
   * 許可リスト（Issue #139）に無いアカウントのため、取り込まなかった未登録ユーザの数。信頼ポリシーには管理外の
   * principal として残る。
   */
  skippedCount: number;
}

/** `PUT /api/pool/attribute-columns` の応答（Issue #61）。保存後の列定義。 */
export interface SaveAttributeColumnsResponse {
  columns: AttributeColumn[];
}

/** `PUT /api/pool/users/attributes` の応答（Issue #61）。保存後の IAM ユーザ。 */
export interface SaveUserAttributesResponse {
  user: IamUser;
}

/** `GET /api/pool/matrix`（画面 3）。 */
export interface MatrixView {
  pool: UserPool;
  users: IamUser[];
  roles: IamRole[];
  assignments: Assignment[];
  /** ロール ARN → 未反映申請。FR-4.6 の除外列を描くために使う。 */
  locks: Record<string, RoleLock>;
}

/** FR-4.6 などにより申請の作成対象から除外されたロール。 */
export interface ExcludedRole {
  roleArn: string;
  reason: "draft" | "failed" | "no-changes" | "not-registered";
  changeRequestId: string | null;
}

/** 作成に失敗したロール。握り潰さず画面に出す。 */
export interface CreationFailure {
  roleArn: string;
  message: string;
  localized?: LocalizedMessage;
}

/** `POST /api/change-requests`（FR-4.4 / FR-4.6）。 */
export interface CreateChangeRequestsResult {
  created: ChangeRequest[];
  excluded: ExcludedRole[];
  failures: CreationFailure[];
}

export interface ChangeRequestsResponse {
  changeRequests: ChangeRequest[];
}

export interface DiscardResponse {
  changeRequest: ChangeRequest;
  /** FR-4.6 のロールロックが解けたか（画面 5 の確認モーダルが明示する副作用）。 */
  lockReleased: boolean;
  /**
   * ロックの解放に**失敗**したときの警告（漏れたロックの可視化）。
   *
   * 破棄そのものは確定しているため 200 で返す。しかしロックが残ると当該ロールの
   * 新しい申請を作れなくなるため（FR-4.6）、黙って捨てず画面へ伝える。
   * 別の申請がロックを保持していただけの場合（正常）は `null`。
   */
  lockWarning: string | null;
  /** `lockWarning` の多言語版（Issue #94）。`lockWarning` と対。 */
  localizedLockWarning?: LocalizedMessage | null;
}

/** `GET /api/diff?ids=...` の 1 件（画面 4）。 */
export interface DiffView {
  changeRequest: ChangeRequest;
  /** 読み取りに失敗した場合は null。 */
  diff: TrustPolicyDiff | null;
  /** FR-4.2 の管理外 principal。判定基準は反映時点の全 IamUser の ARN 集合。 */
  unmanaged: UnmanagedPrincipal[];
  /** 信頼ポリシーの読み取り失敗。1 件の失敗が他のカードを止めない。 */
  readError: { errorCode: string; message: string; localized?: LocalizedMessage } | null;
}

export interface DiffResponse {
  views: DiffView[];
}

export type TrustDriftStatus = "match" | "drift" | "readError";

/** `GET /api/drift` の 1 ロール（画面 2。FR-4.9）。 */
export interface TrustDriftView {
  roleArn: string;
  /** `readError` が非 null なら `readError`、`missing` か `extra` があれば `drift`、それ以外は `match`。 */
  status: TrustDriftStatus;
  /** Rolust は引き受けられると記録しているが、信頼ポリシーで許可されていない管理下のユーザの ARN。`readError` のときは空。 */
  missing: string[];
  /** Rolust は引き受けられないと記録しているが、信頼ポリシーで許可されている管理下のユーザの ARN。`readError` のときは空。 */
  extra: string[];
  /** FR-4.2 の管理外 principal（乖離に数えない。参考）。`readError` のときは空。 */
  unmanaged: UnmanagedPrincipal[];
  /** 信頼ポリシーの読み取り失敗。形は `DiffView.readError` と同じ。 */
  readError: { errorCode: string; message: string; localized?: LocalizedMessage } | null;
}

export interface DriftResponse {
  /** サーバが確認を始めた時刻（ISO 8601）。保存しない（D-11）。 */
  checkedAt: string;
  /** 登録済みのロールの列順（FR-2.6）。 */
  roles: TrustDriftView[];
}

export type RepairOutcome = "created" | "adopted" | "no-drift" | "excluded";

/** adopt で書けなかった交点（Issue #172）。再実行で、乖離を再計算して残りを直せる。 */
export interface RepairFailure {
  userArn: string;
  message: string;
  localized?: LocalizedMessage;
}

/** `POST /api/drift/restore`・`/api/drift/adopt` の応答（FR-4.10・FR-4.11）。 */
export interface RepairResponse {
  outcome: RepairOutcome;
  /** `created`（restore の下書き）・`adopted`（adopt の監査）のとき。それ以外は null。 */
  changeRequest: ChangeRequest | null;
  /** `excluded` のときの理由（未反映の申請あり。FR-4.6）。それ以外は null。 */
  exclusion: { reason: "draft" | "failed"; changeRequestId: string | null } | null;
  /** adopt で書けなかった交点。空なら全件書けた。 */
  failures: RepairFailure[];
}

/** `POST /api/apply` のロール単位の結果（FR-5.4 / FR-5.5）。 */
export interface ApplyReport {
  changeRequestId: string;
  roleArn: string;
  ok: boolean;
  status: ChangeRequestStatus;
  appliedAt: string;
  /** AWS が返したエラーコード。成功時は null（GI-6 のため隠さない）。 */
  errorCode: string | null;
  message: string;
  /** `message` の多言語版（Issue #94）。 */
  localized?: LocalizedMessage;
  added: string[];
  removed: string[];
  warnings: string[];
  /** `warnings` の多言語版（Issue #94）。`warnings` と同じ並び・同じ長さ。 */
  localizedWarnings?: LocalizedMessage[];
}

export interface ApplyResponse {
  reports: ApplyReport[];
  total: number;
  applied: number;
}

/** `POST /api/pool/users` の本文の `users` の 1 要素（Issue #98）。`attributes` は列名 → 値。 */
export interface AddUsersUserInput {
  userName: string;
  attributes?: Record<string, string>;
}

/** `POST /api/pool/users` の応答（Issue #98）。`users` は要求した全員（登録済みは実際の値）。 */
export interface AddUsersResponse {
  users: IamUser[];
  /** 今回新しく登録した人数。 */
  createdCount: number;
  /** すでに登録済みで、何も変えなかった人数（FR-1.4）。 */
  skippedCount: number;
}

/** エラー応答の本文。 */
export interface ApiErrorBody {
  code: string;
  message: string;
  field?: string;
  retryable: boolean;
  /** SPA が言語に合わせて訳す文言（Issue #94）。無いときは `message` を出す。 */
  localized?: LocalizedMessage;
}
