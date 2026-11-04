/**
 * IamUser を削除できない理由の判定（Issue #44）。
 *
 * 削除は Assignment を連鎖削除するが、信頼ポリシーには触れない（FR-1.5）。反映済みの交点を消すと、
 * 信頼ポリシーに残る権限がどのマトリクスからも見えなくなり、Rolust から外す申請も作れなくなる。
 * 未反映の申請に名前が残ったまま消すと、その申請の反映が `markReflected` でユーザの無い交点を
 * 作り直し、同じずれが起きる。どちらかに当たれば削除を拒否する。
 *
 * DynamoDB に触れない純粋な関数にしている（純粋な判定関数の作り）。
 */

/** 判定に要る Assignment の属性。 */
export interface UserAssignmentFlags {
  userArn: string;
  roleArn: string;
  checked: boolean;
  reflected: boolean;
}

/** ロールロックを持つ未反映の申請（FR-4.6 によりロールごとに高々 1 件）。 */
export interface PendingRequest {
  changeRequestId: string;
  poolId: string;
  roleArn: string;
  addUserArns: string[];
  removeUserArns: string[];
}

export interface UserDeleteBlockers {
  /** そのユーザが反映済み（`reflected`）の交点を持つロール。 */
  reflectedRoleArns: string[];
  /** このプールから作った未反映の申請のうち、凍結入力にそのユーザの名前があるもの。 */
  changeRequestIds: string[];
}

export function computeUserDeleteBlockers(input: {
  poolId: string;
  userArn: string;
  /** そのプールの Assignment。 */
  assignments: UserAssignmentFlags[];
  pendingRequests: PendingRequest[];
}): UserDeleteBlockers {
  const reflectedRoleArns = input.assignments
    .filter((assignment) => assignment.userArn === input.userArn && assignment.reflected)
    .map((assignment) => assignment.roleArn);

  const changeRequestIds = input.pendingRequests
    .filter(
      (request) =>
        request.poolId === input.poolId &&
        (request.addUserArns.includes(input.userArn) || request.removeUserArns.includes(input.userArn)),
    )
    .map((request) => request.changeRequestId);

  return { reflectedRoleArns, changeRequestIds };
}
