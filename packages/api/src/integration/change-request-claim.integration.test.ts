import { randomUUID } from "node:crypto";

import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { ChangeRequest } from "@rolust/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDocumentClient } from "../ddb/client.js";
import { changeRequestKey } from "../ddb/keys.js";
import { ConflictError } from "../errors.js";
import {
  claimChangeRequest,
  putChangeRequest,
  updateChangeRequestStatus,
} from "../repository/change-request.js";

/**
 * 同じ ChangeRequest の同時操作の排他（claim）を、実 DynamoDB で確かめる（Issue #121）。
 *
 * **既定の `npm run test` では実行されない。** `ROLUST_INTEGRATION=1` を明示しないと全件スキップする。
 *
 * ```bash
 * ROLUST_INTEGRATION=1 AWS_REGION=ap-northeast-1 \
 *   ROLUST_CHANGE_REQUEST_TABLE_NAME=rolust-change-requests \
 *   AWS_PROFILE=<profile> npm run test:integration
 * ```
 *
 * ## 対象リソース
 *
 * 申請テーブルに、このテスト専用のキー（`CR#concurrency-test-<UUID>`）の下書きを作り、`afterAll` で消す。
 * 既存のアイテムは読まず、書き換えない。IAM は呼ばない。RoleLock は作らない。
 * 消し忘れが起きたら、運用者が次のコマンドで消せる（`<id>` は失敗時に出力する）:
 *
 * ```bash
 * MSYS_NO_PATHCONV=1 aws dynamodb delete-item --table-name rolust-change-requests \
 *   --key '{"pk":{"S":"CR"},"sk":{"S":"CR#<id>"}}' --profile <profile> --region ap-northeast-1
 * ```
 *
 * ## 確かめること（モックでは確かめられない条件式の効き）
 *
 * 1. 同時に 2 回 claim すると、1 回だけ成功する。
 * 2. claim 中は、unclaimed の guard の書き込み（破棄）が `ConflictError` になる。
 * 3. 別の token の guard の書き込みは `ConflictError` になる。
 * 4. claim の持ち主の確定の書き込みは成功し、claim が外れる。
 * 5. 期限切れの claim には、別の claim が成功する。
 * 6. `applyingUntil` を持たない既存の形のアイテムにも、claim が成功する（移行不要）。
 */

const enabled = process.env.ROLUST_INTEGRATION === "1";

// loadConfig() が必須にする変数。この統合テストが使うのは申請テーブルだけ。
process.env.ROLUST_STATE_TABLE_NAME ??= "rolust-state";
process.env.ROLUST_CHANGE_REQUEST_TABLE_NAME ??= "rolust-change-requests";
process.env.ROLUST_MANAGED_TAG_KEY ??= "rolust:managed";
process.env.ROLUST_MANAGED_TAG_VALUE ??= "true";
process.env.ROLUST_POOL_ID ??= "integration-test";

const created: string[] = [];

function draft(changeRequestId: string): ChangeRequest {
  return {
    changeRequestId,
    poolId: "integration-test",
    roleArn: "arn:aws:iam::000000000000:role/concurrency-test-never-exists",
    addUserArns: [],
    removeUserArns: [],
    status: "draft",
    createdAt: new Date().toISOString(),
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };
}

async function newDraft(): Promise<string> {
  const id = `concurrency-test-${randomUUID()}`;
  created.push(id);
  await putChangeRequest(draft(id));
  return id;
}

function later(start: Date, seconds: number): string {
  return new Date(start.getTime() + seconds * 1000).toISOString();
}

async function getItem(id: string): Promise<Record<string, unknown> | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: process.env.ROLUST_CHANGE_REQUEST_TABLE_NAME as string,
      Key: changeRequestKey(id),
      ConsistentRead: true,
    }),
  );
  return result.Item;
}

describe.skipIf(!enabled)("ChangeRequest の claim（実 DynamoDB。Issue #121）", () => {
  beforeAll(() => {
    if (!process.env.AWS_REGION) throw new Error("AWS_REGION を指定してください");
  });

  afterAll(async () => {
    const client = getDocumentClient();
    const tableName = process.env.ROLUST_CHANGE_REQUEST_TABLE_NAME as string;
    const leftovers: string[] = [];
    for (const id of created) {
      try {
        await client.send(new DeleteCommand({ TableName: tableName, Key: changeRequestKey(id) }));
        if (await getItem(id)) leftovers.push(id);
      } catch {
        leftovers.push(id);
      }
    }
    // 後片付けの確認: 作ったアイテムがすべて消えていること。
    expect(leftovers, `消えていないテスト用の申請: ${leftovers.join(", ")}`).toEqual([]);
  });

  it("同時に 2 回 claim すると、1 回だけ成功する", async () => {
    const id = await newDraft();
    const now = new Date().toISOString();

    const results = await Promise.all([claimChangeRequest(id, now), claimChangeRequest(id, now)]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
  });

  it("claim 中は、破棄（unclaimed の guard）の書き込みが ConflictError になり、申請は下書きのまま", async () => {
    const id = await newDraft();
    const now = new Date().toISOString();
    expect((await claimChangeRequest(id, now)).claimed).toBe(true);

    await expect(
      updateChangeRequestStatus({ ...draft(id), status: "discarded" }, { kind: "unclaimed", now }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect((await getItem(id))?.status).toBe("draft");
  });

  it("別の token の guard の書き込みは ConflictError になる", async () => {
    const id = await newDraft();
    expect((await claimChangeRequest(id, new Date().toISOString())).claimed).toBe(true);

    await expect(
      updateChangeRequestStatus(
        { ...draft(id), status: "applied", appliedAt: new Date().toISOString() },
        { kind: "claim", token: "someone-else" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    expect((await getItem(id))?.status).toBe("draft");
  });

  it("claim の持ち主の確定の書き込みは成功し、claim が外れる（その後は破棄できる）", async () => {
    const id = await newDraft();
    const now = new Date().toISOString();
    const claim = await claimChangeRequest(id, now);
    if (!claim.claimed) throw new Error("claim が取れませんでした");

    await updateChangeRequestStatus(
      {
        ...draft(id),
        status: "failed",
        appliedAt: now,
        result: { ok: false, message: "ng", errorCode: "X" },
      },
      { kind: "claim", token: claim.token },
    );

    const item = await getItem(id);
    expect(item?.status).toBe("failed");
    expect(item).not.toHaveProperty("applyingToken");
    expect(item).not.toHaveProperty("applyingUntil");
    // 失敗の申請は、claim が外れたのですぐ破棄できる。
    await updateChangeRequestStatus({ ...draft(id), status: "discarded" }, { kind: "unclaimed", now });
    expect((await getItem(id))?.status).toBe("discarded");
  });

  it("期限切れの claim には、別の claim が成功する", async () => {
    const id = await newDraft();
    const start = new Date();
    expect((await claimChangeRequest(id, start.toISOString())).claimed).toBe(true);

    // 期限（2 分）の内側では取れず、外側（3 分後）では取れる。
    expect((await claimChangeRequest(id, later(start, 60))).claimed).toBe(false);
    expect((await claimChangeRequest(id, later(start, 180))).claimed).toBe(true);
  });

  it("applyingUntil を持たない既存の形のアイテムにも claim が成功する（移行不要）", async () => {
    const id = await newDraft();
    // putChangeRequest は applyingUntil を書かない。属性が無いことを確かめてから claim する。
    expect(await getItem(id)).not.toHaveProperty("applyingUntil");

    expect((await claimChangeRequest(id, new Date().toISOString())).claimed).toBe(true);
  });
});
