import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { conditionalCheckFailed, ddbMock } from "./ddb-mock.js";

/**
 * `ddbMock` の上に置く、メモリ上の DynamoDB の写し（テスト用。**実 AWS は呼ばない**）。
 *
 * 実 IAM を呼ぶ統合テスト（Issue #172）で、DynamoDB の読み書きを実テーブルの代わりに受ける。
 * 受けるのは Rolust のリポジトリが実際に送る形だけである。知らない形の書き込みは**例外にする**
 * （モックが実物より寛容になって、経路がすり抜けるのを防ぐ。`CLAUDE.md` § テスト方針）。
 *
 * - キーは実テーブルと同じ `{ pk, sk }`。テーブル名ごとに分ける
 * - 条件付き書き込みは、リポジトリが使う条件（ロックの `attribute_not_exists(pk)`、反映の claim、
 *   状態の確定、ロックの解放）を実物と同じ意味で判定し、外れたら `ConditionalCheckFailedException` を投げる
 */

type Item = Record<string, unknown>;
type Key = { pk: string; sk: string };

interface UpdateInput {
  TableName: string;
  Key: Key;
  ConditionExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
}

export class MemoryTables {
  private readonly tables = new Map<string, Map<string, Item>>();

  /** 各テストの前に呼ぶ。`ddbMock` を、このストアへの読み書きに差し替える。 */
  install(): void {
    ddbMock.on(GetCommand).callsFake((input: { TableName: string; Key: Key }) => {
      const item = this.get(input.TableName, input.Key);
      return item === undefined ? {} : { Item: structuredClone(item) };
    });
    ddbMock.on(QueryCommand).callsFake((input: { TableName: string; KeyConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> }) => {
      if (input.KeyConditionExpression !== "pk = :pk AND begins_with(sk, :prefix)") {
        throw new Error(`MemoryTables: 未対応の Query です: ${JSON.stringify(input)}`);
      }
      const values = input.ExpressionAttributeValues ?? {};
      return { Items: this.query(input.TableName, String(values[":pk"]), String(values[":prefix"])) };
    });
    ddbMock.on(PutCommand).callsFake((input: { TableName: string; Item: Item; ConditionExpression?: string }) => {
      const key = { pk: String(input.Item.pk), sk: String(input.Item.sk) };
      if (input.ConditionExpression !== undefined) {
        if (input.ConditionExpression !== "attribute_not_exists(pk)") {
          throw new Error(`MemoryTables: 未対応の Put の条件です: ${input.ConditionExpression}`);
        }
        if (this.get(input.TableName, key) !== undefined) throw conditionalCheckFailed();
      }
      this.put(input.TableName, input.Item);
      return {};
    });
    ddbMock.on(UpdateCommand).callsFake((input: UpdateInput) => {
      this.update(input);
      return {};
    });
    ddbMock.on(DeleteCommand).callsFake((input: UpdateInput) => {
      const existing = this.get(input.TableName, input.Key);
      if (input.ConditionExpression !== undefined) {
        if (input.ConditionExpression !== "changeRequestId = :id") {
          throw new Error(`MemoryTables: 未対応の Delete の条件です: ${input.ConditionExpression}`);
        }
        if (existing?.changeRequestId !== input.ExpressionAttributeValues?.[":id"]) throw conditionalCheckFailed();
      }
      this.table(input.TableName).delete(keyOf(input.Key));
      return {};
    });
  }

  put(tableName: string, item: Item): void {
    this.table(tableName).set(keyOf({ pk: String(item.pk), sk: String(item.sk) }), structuredClone(item));
  }

  /** アイテムの複製（無ければ undefined）。 */
  get(tableName: string, key: Key): Item | undefined {
    const item = this.table(tableName).get(keyOf(key));
    return item === undefined ? undefined : structuredClone(item);
  }

  /** `pk` が一致し、`sk` が接頭辞で始まるアイテム（`sk` の昇順の複製）。 */
  query(tableName: string, pk: string, prefix: string): Item[] {
    return [...this.table(tableName).values()]
      .filter((item) => item.pk === pk && String(item.sk).startsWith(prefix))
      .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
      .map((item) => structuredClone(item));
  }

  private table(name: string): Map<string, Item> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  /** リポジトリが送る UpdateItem の形ごとに、実物と同じ意味で書く。 */
  private update(input: UpdateInput): void {
    const values = input.ExpressionAttributeValues ?? {};
    const existing = this.get(input.TableName, input.Key);
    const base: Item = existing ?? { ...input.Key };

    if (input.Key.sk.startsWith("ASSIGN#")) {
      if (input.ConditionExpression !== undefined) {
        throw new Error(`MemoryTables: 未対応の Assignment の条件です: ${input.ConditionExpression}`);
      }
      const next: Item = {
        ...base,
        itemType: values[":itemType"],
        poolId: values[":poolId"],
        userArn: values[":userArn"],
        roleArn: values[":roleArn"],
        updatedAt: values[":now"],
      };
      if (":state" in values) {
        // setAssignmentState: checked・reflected を絶対値で書く。
        next.checked = values[":state"];
        next.reflected = values[":state"];
      } else if (":reflected" in values) {
        // markReflected: reflected だけ。checked は if_not_exists。
        next.reflected = values[":reflected"];
        if (existing?.checked === undefined) next.checked = values[":reflected"];
      } else {
        throw new Error(`MemoryTables: 未対応の Assignment の更新です: ${JSON.stringify(values)}`);
      }
      this.put(input.TableName, next);
      return;
    }

    if (input.Key.pk === "CR") {
      if (existing === undefined) throw conditionalCheckFailed(); // attribute_exists(pk)
      if (":until" in values) {
        // claim: 状態が下書き・失敗で、claim が無いか期限切れ。
        const status = existing.status;
        const until = existing.applyingUntil;
        const unclaimed =
          (status === "draft" || status === "failed") &&
          (until === undefined || String(until) < String(values[":now"]));
        if (!unclaimed) throw conditionalCheckFailed();
        this.put(input.TableName, { ...existing, applyingToken: values[":token"], applyingUntil: values[":until"] });
        return;
      }
      if (":status" in values) {
        if (":token" in values) {
          if (existing.applyingToken !== values[":token"]) throw conditionalCheckFailed();
        } else {
          const until = existing.applyingUntil;
          const unclaimed =
            (existing.status === "draft" || existing.status === "failed") &&
            (until === undefined || String(until) < String(values[":now"]));
          if (!unclaimed) throw conditionalCheckFailed();
        }
        const next: Item = {
          ...existing,
          status: values[":status"],
          appliedAt: values[":appliedAt"],
          appliedBy: values[":appliedBy"],
          result: values[":result"],
        };
        delete next.applyingToken;
        delete next.applyingUntil;
        this.put(input.TableName, next);
        return;
      }
    }

    if (input.Key.pk.startsWith("ROLELOCK#") && ":status" in values) {
      if (existing === undefined || existing.changeRequestId !== values[":id"]) throw conditionalCheckFailed();
      this.put(input.TableName, { ...existing, status: values[":status"] });
      return;
    }

    throw new Error(`MemoryTables: 未対応の UpdateItem です: ${JSON.stringify(input)}`);
  }
}

function keyOf(key: Key): string {
  return `${key.pk}\u0000${key.sk}`;
}
