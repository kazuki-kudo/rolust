import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import { localized, plainMessage, renderMessage } from "@rolust/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IamClientModule from "../aws/iam-client.js";
import { IamOperationError, createIamTrustPolicyReader } from "../aws/iam-client.js";
import { setupDdbMock, ddbMock } from "../testing/ddb-mock.js";
import { computeDiffViews } from "./diff-service.js";

// 既定の依存（デプロイ先のアカウント ID を渡して作る読み取りクライアント）の受け渡しを確かめるため、
// 生成関数だけを監視できる形にする。実物の実装は、そのまま呼ぶ。
vi.mock("../aws/iam-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof IamClientModule>();
  return { ...original, createIamTrustPolicyReader: vi.fn(original.createIamTrustPolicyReader) };
});

/**
 * 差分確認（FR-4.1 / FR-4.2）で、別アカウントのロールを、同じアカウントのロールと同じ手順で扱うこと（Issue #85）を固定する。
 *
 * `iam:GetRole` は `RoleName` しか受け取らず、呼び出しに使った資格情報のアカウントに対して解決される。
 * どの資格情報で呼ぶかは、読み取りクライアント（`deps.iam`。`packages/api/src/aws/iam-client.ts`）が、
 * ロールのアカウントに応じて選ぶ。サービスは、ロールの ARN をそのまま渡し、失敗をカードの読み取りエラーにする。
 */

const DEPLOY_ACCOUNT = "555566667777";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
// デプロイ先のロールと同名で、アカウント ID だけが違う（#27 の事象の形）。
const CROSS = "arn:aws:iam::999900001111:role/DeployProd";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";

function stubDraft(id: string, roleArn: string): void {
  ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${id}` } }).resolves({
    Item: {
      pk: "CR",
      sk: `CR#${id}`,
      itemType: "ChangeRequest",
      changeRequestId: id,
      poolId: "platform-team",
      roleArn,
      addUserArns: [AYAKA],
      removeUserArns: [],
      status: "draft",
      createdAt: "2026-07-31T10:04:00.000Z",
      appliedAt: null,
      result: null,
    },
  });
}

function spyIam() {
  return {
    getTrustPolicy: vi.fn(
      async (_roleArn: string): Promise<TrustPolicyDocument> => ({
        Version: "2012-10-17",
        Statement: [],
      }),
    ),
    updateTrustPolicy: vi.fn(async (_roleArn: string, _document: TrustPolicyDocument) => {}),
  };
}

beforeEach(() => {
  setupDdbMock();
  // 管理外 principal の基準集合（全 IamUser）は空にしておく。この判定には関わらない。
  ddbMock.on(QueryCommand).resolves({ Items: [] });
});

describe("デプロイ先と異なるアカウントのロール（Issue #85）", () => {
  it("別アカウントのロールも、読み取りクライアントへ ARN のまま渡して、差分を返す", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();

    const [view] = await computeDiffViews(["cr-cross"], DEPLOY_ACCOUNT, { iam });

    expect(iam.getTrustPolicy.mock.calls).toEqual([[CROSS]]);
    expect(view?.readError).toBeNull();
    expect(view?.diff?.added).toEqual([AYAKA]);
  });

  it("ターゲット側のロールを引き受けられなければ、そのカードを読み取りエラーにする。AWS のコードと、直し方を含む文言を隠さない（GI-6）", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();
    iam.getTrustPolicy.mockRejectedValue(
      new IamOperationError(
        "assume-role",
        "AccessDenied",
        CROSS,
        plainMessage("アカウント 999900001111 のロール RolustTrustPolicyReader を引き受けられませんでした（AccessDenied）。docs/guide/cross-account.md の手順で作成してください。"),
      ),
    );

    const [view] = await computeDiffViews(["cr-cross"], DEPLOY_ACCOUNT, { iam });

    expect(view?.diff).toBeNull();
    expect(view?.readError?.errorCode).toBe("AccessDenied");
    expect(view?.readError?.message).toContain("RolustTrustPolicyReader");
    expect(view?.readError?.message).toContain("docs/guide/cross-account.md");
  });

  it("別アカウントのカードが読み取りエラーでも、ほかのカードは差分を返す（1 件の失敗が他を止めない。FR-7.4）", async () => {
    stubDraft("cr-cross", CROSS);
    stubDraft("cr-ok", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockImplementation(async (roleArn: string) => {
      if (roleArn === CROSS) {
        throw new IamOperationError("assume-role", "AccessDenied", CROSS, plainMessage("引き受けられませんでした"));
      }
      return { Version: "2012-10-17", Statement: [] };
    });

    const views = await computeDiffViews(["cr-cross", "cr-ok"], DEPLOY_ACCOUNT, { iam });

    expect(views.map((view) => [view.changeRequest.changeRequestId, view.readError === null])).toEqual([
      ["cr-cross", false],
      ["cr-ok", true],
    ]);
  });

  it("デプロイ先のアカウント ID が分からないときは、読み取りクライアントが IAM を呼ばずに止め、そのカードを読み取りエラーにする", async () => {
    stubDraft("cr-unknown", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockRejectedValue(
      new IamOperationError("deploy-account-unknown", "DeployAccountUnknown", DEPLOY, plainMessage("デプロイ先を判定できません")),
    );

    const [view] = await computeDiffViews(["cr-unknown"], null, { iam });

    expect(view?.readError?.errorCode).toBe("DeployAccountUnknown");
  });

  it("既定の読み取りクライアントは、デプロイ先のアカウント ID を渡して作る（読み取りだけの型。Diff は更新しない）", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();
    vi.mocked(createIamTrustPolicyReader).mockReturnValueOnce(iam);

    await computeDiffViews(["cr-cross"], DEPLOY_ACCOUNT);

    expect(createIamTrustPolicyReader).toHaveBeenCalledWith(DEPLOY_ACCOUNT);
    expect(iam.getTrustPolicy).toHaveBeenCalledWith(CROSS);
    expect(iam.updateTrustPolicy).not.toHaveBeenCalled();
  });
});

/**
 * Issue #16 の症状: ユーザを全員外したロールに追加する申請の差分カードで、
 * プレースホルダの root が「管理外 principal」として警告されていた。
 */
describe("プレースホルダだけのロールに追加する申請（Issue #16）", () => {
  it("プレースホルダの root を管理外として警告せず、プレースホルダの削除を差分に示す", async () => {
    stubDraft("cr-placeholder", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockResolvedValue({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustPlaceholder",
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${DEPLOY_ACCOUNT}:root` },
          Action: "sts:AssumeRole",
          Condition: { DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" } },
        },
      ],
    });

    const [view] = await computeDiffViews(["cr-placeholder"], DEPLOY_ACCOUNT, { iam });

    expect(view?.unmanaged).toEqual([]);
    expect(view?.diff?.added).toEqual([AYAKA]);
    expect(view?.diff?.placeholderRemoved).toBe(true);
  });
});

describe("読み取りエラーの文言の ID（Issue #94）", () => {
  it("IamOperationError は、その localized をそのまま運び、message はその日本語の描画", async () => {
    stubDraft("cr-1", CROSS);
    const iam = spyIam();
    const cause = localized("iam.awsMessageForRole", {
      accountId: "999900001111",
      roleName: "DeployProd",
      operation: "iam:GetRole",
      detail: "denied",
    });
    iam.getTrustPolicy.mockRejectedValue(new IamOperationError("access-denied", "AccessDenied", CROSS, cause));

    const [view] = await computeDiffViews(["cr-1"], DEPLOY_ACCOUNT, { iam });

    expect(view?.readError?.localized).toEqual(cause);
    expect(view?.readError?.message).toBe(renderMessage("ja", cause));
  });

  it("ほかの Error は common.rawDetail、Error でない例外は diff.readFailed", async () => {
    stubDraft("cr-1", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockRejectedValueOnce(new Error("plain boom"));

    const [raw] = await computeDiffViews(["cr-1"], DEPLOY_ACCOUNT, { iam });

    expect(raw?.readError).toEqual({
      errorCode: "UnknownError",
      message: "plain boom",
      localized: localized("common.rawDetail", { detail: "plain boom" }),
    });

    iam.getTrustPolicy.mockRejectedValueOnce("not an Error");

    const [unknown] = await computeDiffViews(["cr-1"], DEPLOY_ACCOUNT, { iam });

    expect(unknown?.readError).toEqual({
      errorCode: "UnknownError",
      message: "現在の信頼ポリシーを読み取れませんでした",
      localized: localized("diff.readFailed", {}),
    });
  });
});
