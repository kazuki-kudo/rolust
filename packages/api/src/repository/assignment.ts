import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Assignment } from "@rolust/core";

import { loadConfig } from "../config.js";
import { getDocumentClient, isConditionalCheckFailed, withStorageErrors } from "../ddb/client.js";
import type { BaseItem } from "../ddb/keys.js";
import { ASSIGNMENT_SK_PREFIX, assignmentKey, poolPk } from "../ddb/keys.js";

/**
 * Assignment のリポジトリ（FR-3.1 / FR-3.2）。
 *
 * **交点 1 件 = 1 アイテム**。プール単位の集約アイテムは作らない（NFR-2）。
 * マトリクスの取得はプール 1 パーティションの Query 1 本で済む。
 *
 * `checked` は「あるべき状態」、`reflected` は「最後に AWS へ反映された状態」。
 * この 2 値の差が申請の凍結入力になる（`@rolust/core` の `buildFrozenInput`）。
 */

interface AssignmentItem extends BaseItem {
  itemType: "Assignment";
  poolId: string;
  userArn: string;
  roleArn: string;
  checked: boolean;
  reflected: boolean;
  updatedAt: string;
}

export async function listAssignments(poolId: string): Promise<Assignment[]> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("Query(Assignment)", () =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": poolPk(poolId),
          ":prefix": ASSIGNMENT_SK_PREFIX,
        },
      }),
    ),
  );

  return ((result.Items ?? []) as AssignmentItem[]).map((item) => ({
    poolId: item.poolId,
    userArn: item.userArn,
    roleArn: item.roleArn,
    checked: Boolean(item.checked),
    reflected: Boolean(item.reflected),
    updatedAt: item.updatedAt,
  }));
}

/**
 * 交点 1 件のチェック状態を保存する（FR-3.2 / MQ-4 のセル単位保存）。
 *
 * **AWS へは一切書き込まない。ChangeRequest も生成しない。**
 * `reflected` は触らない — 反映済みの状態は反映処理だけが動かす。
 */
export async function saveChecked(
  poolId: string,
  userArn: string,
  roleArn: string,
  checked: boolean,
  now: string,
): Promise<Assignment> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("UpdateItem(Assignment.checked)", () =>
    client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: assignmentKey(poolId, userArn, roleArn),
        // 属性名はすべて別名にする。DynamoDB の予約語（CHECK / STATUS など）との
        // 衝突を、名前を増やすたびに調べ直さなくて済むようにするため。
        UpdateExpression: [
          "SET #itemType = :itemType",
          "#poolId = :poolId",
          "#userArn = :userArn",
          "#roleArn = :roleArn",
          "#checked = :checked",
          "#reflected = if_not_exists(#reflected, :false)",
          "#updatedAt = :now",
        ].join(", "),
        ExpressionAttributeNames: {
          "#itemType": "itemType",
          "#poolId": "poolId",
          "#userArn": "userArn",
          "#roleArn": "roleArn",
          "#checked": "checked",
          "#reflected": "reflected",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":itemType": "Assignment",
          ":poolId": poolId,
          ":userArn": userArn,
          ":roleArn": roleArn,
          ":checked": checked,
          ":false": false,
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      }),
    ),
  );

  const item = result.Attributes as AssignmentItem;
  return {
    poolId: item.poolId,
    userArn: item.userArn,
    roleArn: item.roleArn,
    checked: Boolean(item.checked),
    reflected: Boolean(item.reflected),
    updatedAt: item.updatedAt,
  };
}

/**
 * 交点 1 件の `checked` を `reflected` にそろえる（未反映の変更の取り消し。Issue #88）。
 *
 * **AWS へは一切書き込まない。ChangeRequest も生成しない。`reflected` は触らない。**
 * 条件 `checked <> reflected` で、読んだ後に別の操作で食い違いが無くなった交点（取り消しの二重実行・
 * 画面での再チェックなど）を上書きしない。条件不一致は呼び出し側が「すでにそろっている」として扱う。
 *
 * @returns そろえたなら true、すでにそろっていた（条件不一致）なら false
 */
export async function revertChecked(
  poolId: string,
  userArn: string,
  roleArn: string,
  now: string,
): Promise<boolean> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await withStorageErrors("UpdateItem(Assignment.revert)", () =>
      client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: assignmentKey(poolId, userArn, roleArn),
          UpdateExpression: "SET #checked = #reflected, #updatedAt = :now",
          ConditionExpression: "attribute_exists(pk) AND #checked <> #reflected",
          ExpressionAttributeNames: {
            "#checked": "checked",
            "#reflected": "reflected",
            "#updatedAt": "updatedAt",
          },
          ExpressionAttributeValues: { ":now": now },
        }),
      ),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
}

/**
 * 反映済み状態（baseline）を更新する。反映が成功したロールについてのみ呼ぶ。
 *
 * 凍結入力に載っていた交点だけを動かす。凍結後にチェックされた交点（FR-5.1 シナリオ 3 の C）は
 * 触らないため、次の申請で改めて「追加される」として現れる。
 */
export async function markReflected(
  poolId: string,
  userArn: string,
  roleArn: string,
  reflected: boolean,
  now: string,
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("UpdateItem(Assignment.reflected)", () =>
    client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: assignmentKey(poolId, userArn, roleArn),
        UpdateExpression: [
          "SET #itemType = :itemType",
          "#poolId = :poolId",
          "#userArn = :userArn",
          "#roleArn = :roleArn",
          "#reflected = :reflected",
          "#checked = if_not_exists(#checked, :reflected)",
          "#updatedAt = :now",
        ].join(", "),
        ExpressionAttributeNames: {
          "#itemType": "itemType",
          "#poolId": "poolId",
          "#userArn": "userArn",
          "#roleArn": "roleArn",
          "#checked": "checked",
          "#reflected": "reflected",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":itemType": "Assignment",
          ":poolId": poolId,
          ":userArn": userArn,
          ":roleArn": roleArn,
          ":reflected": reflected,
          ":now": now,
        },
      }),
    ),
  );
}

/**
 * 交点 1 件の `checked` と `reflected` を同じ値で書く（乖離の取り込み `adopt`。Issue #172）。
 *
 * 条件なしの絶対値の書き込み。再実行しても同じ結果になる（途中で失敗した adopt のやり直しが冪等）。
 * 行が無ければ作る。**AWS へは書き込まない。**
 */
export async function setAssignmentState(
  poolId: string,
  userArn: string,
  roleArn: string,
  state: boolean,
  now: string,
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("UpdateItem(Assignment.state)", () =>
    client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: assignmentKey(poolId, userArn, roleArn),
        UpdateExpression: [
          "SET #itemType = :itemType",
          "#poolId = :poolId",
          "#userArn = :userArn",
          "#roleArn = :roleArn",
          "#checked = :state",
          "#reflected = :state",
          "#updatedAt = :now",
        ].join(", "),
        ExpressionAttributeNames: {
          "#itemType": "itemType",
          "#poolId": "poolId",
          "#userArn": "userArn",
          "#roleArn": "roleArn",
          "#checked": "checked",
          "#reflected": "reflected",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":itemType": "Assignment",
          ":poolId": poolId,
          ":userArn": userArn,
          ":roleArn": roleArn,
          ":state": state,
          ":now": now,
        },
      }),
    ),
  );
}

/**
 * 信頼ポリシーから取り込んだ交点を、`checked = reflected = true` で書く（ロールの紐づけ時。Issue #80）。
 *
 * 取り込む時点の信頼ポリシーがすでにそのユーザを信頼している（`reflected`）ので、あるべき状態（`checked`）も
 * 同じにする。条件なしの Put: 紐づけ前のロールの交点はマトリクスに出ず、途中で失敗した取り込みの再実行で
 * 同じ値に書き直すので、上書きしてよい。AWS へは書き込まない。
 */
export async function putReflectedAssignment(
  poolId: string,
  userArn: string,
  roleArn: string,
  now: string,
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("PutItem(Assignment)", () =>
    client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...assignmentKey(poolId, userArn, roleArn),
          itemType: "Assignment",
          poolId,
          userArn,
          roleArn,
          checked: true,
          reflected: true,
          updatedAt: now,
        } satisfies AssignmentItem,
      }),
    ),
  );
}

/**
 * 交点 1 件を条件なしで消す（Issue #18。Issue #79 で紐づけの解除でも使う）。
 *
 * プールの削除で、競合（#48）で残った交点を片付けるときに使う。IamUser も紐づけも無い
 * プールの交点はどのマトリクスにも出ないため、`checked`・`reflected` を問わず消す。
 * 紐づけの解除（FR-1.7）も、外すロールの交点を、割り当て（`checked` か `reflected`）が残っていても消す。
 * 管理外になったロールの記録は、実態とずれていくだけだからである（spec D-2）。
 */
export async function deleteAssignment(poolId: string, userArn: string, roleArn: string): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("DeleteItem(Assignment)", () =>
    client.send(new DeleteCommand({ TableName: tableName, Key: assignmentKey(poolId, userArn, roleArn) })),
  );
}
