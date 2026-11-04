/**
 * ドメインモデル。
 *
 * 型名は `requirements.md` の `## Data Model` が定めた 5 エンティティ名をそのまま使う
 * （`design-system-mapping.md` § Naming Conventions「ドメイン用語を訳し替えない」）。
 */

import type { LocalizedMessage } from "./messages/types.js";
import type { RoleColorId } from "./role-color.js";

/** ユーザプールの属性列の定義 1 件（Issue #61）。値は `columnId` で持つので、名前を変えても値は残る。 */
export interface AttributeColumn {
  /** 列の安定 ID。サーバが採番する。名前を変えても変わらない。 */
  columnId: string;
  /** 列名。プール内で一意。 */
  name: string;
}

/** ユーザプール。IAM ユーザのリスト。デプロイにつき固定の 1 つ（FR-1.3。Issue #108）。複数 AWS アカウントの IamUser を混在できる（FR-1.4 / C-5）。 */
export interface UserPool {
  /** プール識別子。デプロイごとの固定値（`ROLUST_POOL_ID`。Issue #108）。 */
  poolId: string;
  /** IAM ユーザの属性列の定義（Issue #61）。追加順。未設定なら空。最大 10 列。 */
  attributeColumns: AttributeColumn[];
  createdAt: string;
}

/** UserPool に属する IAM ユーザ。ARN でユニークに識別する（FR-1.2）。 */
export interface IamUser {
  poolId: string;
  accountId: string;
  userName: string;
  /** `arn:aws:iam::<accountId>:user/<userName>`（FR-1.2）。 */
  arn: string;
  /** 属性の値（Issue #61）。`columnId` をキーにする。値の無い列は持たない。 */
  attributes: Record<string, string>;
  createdAt: string;
}

/** 割り当て先の IAM ロール。UserPool には従属しない（Data Model 補足）。 */
export interface IamRole {
  accountId: string;
  roleName: string;
  /** `arn:aws:iam::<accountId>:role/<roleName>`（Data Model 補足）。 */
  arn: string;
  /** 任意の説明（Issue #21）。未設定なら null。`role.ts` の `normalizeRoleDescription` で正規化する。 */
  description: string | null;
  /** 任意の表示名（Issue #150）。マトリクスの列の名前に使う。未設定なら null。`role.ts` の `normalizeRoleDisplayName` で正規化する。 */
  displayName: string | null;
  /** 任意の背景色（Issue #100。固定パレットの ID）。未設定なら null。 */
  color: RoleColorId | null;
  createdAt: string;
}

/**
 * マトリクスの交点。IamUser × IamRole の関連（FR-3.1 / FR-3.2）。
 *
 * NFR-2 のため交点 1 件 = 1 レコードとし、プール単位の集約レコードは作らない。
 */
export interface Assignment {
  poolId: string;
  userArn: string;
  roleArn: string;
  /** **あるべき状態**。マトリクスのチェック内容（FR-3.2）。 */
  checked: boolean;
  /**
   * 最後に AWS の信頼ポリシーへ反映された状態。
   *
   * `checked !== reflected` の交点が「この申請で変更される点」であり、
   * `interaction-spec.md` の `AssignmentMatrix` が言う `baseline` の実体である。
   * FR-5.7 により反映時以外に AWS を参照できないため、baseline は Rolust 側で保持する。
   */
  reflected: boolean;
  updatedAt: string;
}

/** ChangeRequest の状態（requirements.md Data Model / FR-5.5 / FR-4.8）。 */
export type ChangeRequestStatus = "draft" | "applied" | "failed" | "discarded";

/**
 * ChangeRequest 作成時に凍結される入力（FR-4.5）。
 *
 * 生成後に Assignment が変わっても、この値は変化しない。
 * 反映処理はこの値のみを適用する（FR-5.2）。
 */
export interface FrozenInput {
  roleArn: string;
  /** 信頼ポリシーへ追加する IamUser の ARN。 */
  addUserArns: string[];
  /** 信頼ポリシーから削除する IamUser の ARN。 */
  removeUserArns: string[];
}

/** 反映結果（FR-5.5）。 */
export interface ApplyOutcome {
  ok: boolean;
  /** 管理者に見せる説明。失敗時は AWS のメッセージをそのまま含む（GI-6）。 */
  message: string;
  /** AWS が返したエラーコード（`AccessDenied` など）。成功時は null。 */
  errorCode: string | null;
  /** `message` の多言語版（Issue #94）。移行前に保存した結果には無い。 */
  localized?: LocalizedMessage;
}

/**
 * 操作した人（Issue #120）。edge-auth が認証後に `x-rolust-actor` ヘッダーで API へ渡す。
 *
 * `name` は読める名前（`cognito:username`。`basic` では Authorization のユーザ名）、`sub` は変わらない ID
 * （`cognito` のときだけ）。ユーザ名は変わりうるので両方を持つ。
 */
export interface Actor {
  name: string;
  sub?: string;
}

/**
 * 申請の種別（Issue #172）。無い（undefined）は通常の申請（`checked`/`reflected` の食い違いから作る）。
 * - `restore`: 乖離を直すために、IAM を記録（`reflected`）に合わせる下書きの申請。
 * - `adopt`: 記録を IAM の現状に合わせた監査の記録。AWS は書き換えていない（反映済みで作る）。
 */
export type ChangeRequestKind = "restore" | "adopt";

/**
 * 申請。信頼ポリシーへの反映を提案する単位で、監査・履歴情報として永続化する。
 *
 * **作成時点で凍結された変更イベント**であり、Assignment（あるべき状態）とは別実体
 * （requirements.md「Assignment と ChangeRequest の関係」）。
 */
export interface ChangeRequest {
  changeRequestId: string;
  /**
   * 申請の元になったマトリクスの UserPool。
   *
   * requirements.md の記録内容 5 項目には含まれないが、反映成功時に baseline
   * （Assignment.reflected）を更新する対象を特定するために保持する。
   */
  poolId: string;
  roleArn: string;
  /** 凍結入力（FR-4.5）。 */
  addUserArns: string[];
  /** 凍結入力（FR-4.5）。 */
  removeUserArns: string[];
  status: ChangeRequestStatus;
  createdAt: string;
  /**
   * 申請を作成した実行者（Issue #120）。特定できなかった操作と、#120 より前に作られた申請は null。
   * Assignment のセルの更新者は記録しない。
   */
  createdBy: Actor | null;
  /** 反映を試みた時刻。未反映なら null（FR-5.5）。 */
  appliedAt: string | null;
  /** 反映を試みた実行者（Issue #120）。`appliedAt` と同じく、失敗した反映でも入る。未反映・不明は null。 */
  appliedBy: Actor | null;
  /** 反映結果。未反映なら null（FR-5.5）。 */
  result: ApplyOutcome | null;
  /** 種別（Issue #172）。通常の申請と #172 より前の申請は持たない。 */
  kind?: ChangeRequestKind;
}

/** ChangeRequest から凍結入力だけを取り出す。 */
export function frozenInputOf(changeRequest: ChangeRequest): FrozenInput {
  return {
    roleArn: changeRequest.roleArn,
    addUserArns: [...changeRequest.addUserArns],
    removeUserArns: [...changeRequest.removeUserArns],
  };
}
