import type { SaveUserAttributesResponse } from "@rolust/core";
import { localized, normalizeUserAttributes } from "@rolust/core";

import { NotFoundError } from "../errors.js";
import { getUser, requirePool, updateUserAttributes } from "../repository/pool.js";

/**
 * 1 ユーザの属性の保存（Issue #61。アクセスパターン 24）。
 *
 * 属性を丸ごと置き換える。定義に無い `columnId`（削除した列の古い値）は書かれない（spec D-6）。
 * AWS へは問い合わせない。
 */
export async function saveUserAttributes(
  poolId: string,
  userArn: string,
  rawAttributes: unknown,
): Promise<SaveUserAttributesResponse> {
  const pool = await requirePool(poolId);
  const user = await getUser(poolId, userArn);
  if (!user) {
    throw new NotFoundError(localized("pool.userNotFound", { userArn }));
  }
  const attributes = normalizeUserAttributes(rawAttributes, pool.attributeColumns);
  await updateUserAttributes(poolId, userArn, attributes);
  return { user: { ...user, attributes } };
}
