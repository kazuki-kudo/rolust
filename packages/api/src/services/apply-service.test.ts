import { DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ApplyReport, TrustPolicyDocument } from "@rolust/core";
import { localized, plainMessage, renderMessage } from "@rolust/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IamClientModule from "../aws/iam-client.js";
import type { IamTrustPolicyClient } from "../aws/iam-client.js";
import { IamOperationError, createIamTrustPolicyClient } from "../aws/iam-client.js";
import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { applyChangeRequests } from "./apply-service.js";

// 既定の依存（デプロイ先のアカウント ID を渡して作る IAM クライアント）の受け渡しを確かめるため、
// 生成関数だけを監視できる形にする。実物の実装は、そのまま呼ぶ。
vi.mock("../aws/iam-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof IamClientModule>();
  return { ...original, createIamTrustPolicyClient: vi.fn(original.createIamTrustPolicyClient) };
});

const POOL_ID = "platform-team";
/** Rolust のデプロイ先アカウント（API Gateway の `requestContext.accountId`）。 */
const DEPLOY_ACCOUNT = "555566667777";
// 別アカウントのロールも、同じ手順で反映する。どの資格情報で呼ぶかは、IAM クライアントが選ぶ（Issue #85）。
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const ADMIN = "arn:aws:iam::555566667777:role/DataPlatformAdmin";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const NOW = "2026-07-31T10:07:00.000Z";

function changeRequestItem(options: {
  id: string;
  roleArn: string;
  status: string;
  addUserArns?: string[];
  removeUserArns?: string[];
  kind?: "restore" | "adopt";
}) {
  return {
    pk: "CR",
    sk: `CR#${options.id}`,
    itemType: "ChangeRequest",
    changeRequestId: options.id,
    poolId: POOL_ID,
    roleArn: options.roleArn,
    addUserArns: options.addUserArns ?? [],
    removeUserArns: options.removeUserArns ?? [],
    status: options.status,
    createdAt: "2026-07-31T10:04:00.000Z",
    createdBy: { name: "alice" },
    appliedAt: null,
    appliedBy: null,
    result: null,
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  };
}

function emptyPolicy(): TrustPolicyDocument {
  return { Version: "2012-10-17", Statement: [] };
}

/** 申請アイテムへの状態の書き込み（claim を除く）。claim は `:until` を持つ（Issue #121）。 */
function statusUpdates() {
  return ddbMock
    .commandCalls(UpdateCommand)
    .map((call) => call.args[0].input)
    .filter((input) => input.Key?.pk === "CR" && !input.ExpressionAttributeValues?.[":until"]);
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
});

describe("一括反映（FR-5.4）", () => {
  it("一部失敗しても成功ロールと失敗ロールが個別に識別できる", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ok" } })
      .resolves({
        Item: changeRequestItem({
          id: "cr-ok",
          roleArn: DEPLOY,
          status: "draft",
          addUserArns: [AYAKA],
        }),
      });
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ng" } })
      .resolves({
        Item: changeRequestItem({
          id: "cr-ng",
          roleArn: ADMIN,
          status: "draft",
          addUserArns: [KENJI],
        }),
      });

    const iam: IamTrustPolicyClient = {
      getTrustPolicy: vi.fn(async () => emptyPolicy()),
      updateTrustPolicy: vi.fn(async (roleArn: string) => {
        if (roleArn === ADMIN) {
          throw new IamOperationError(
            "access-denied",
            "AccessDenied",
            ADMIN,
            plainMessage("iam:UpdateAssumeRolePolicy が拒否されました"),
          );
        }
      }),
    };

    const reports = await applyChangeRequests(["cr-ok", "cr-ng"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(reports).toHaveLength(2);

    const success = reports.find((report) => report.changeRequestId === "cr-ok");
    expect(success).toMatchObject({
      ok: true,
      status: "applied",
      roleArn: DEPLOY,
      errorCode: null,
      appliedAt: NOW,
    });
    expect(success?.added).toEqual([AYAKA]);

    const failure = reports.find((report) => report.changeRequestId === "cr-ng");
    expect(failure).toMatchObject({
      ok: false,
      status: "failed",
      roleArn: ADMIN,
      errorCode: "AccessDenied",
      appliedAt: NOW,
    });
    // AWS のエラー内容を隠さず載せる（GI-6 / M-3.3）
    expect(failure?.message).toContain("iam:UpdateAssumeRolePolicy");
  });

  it("成功ロールのロックだけが解放され、失敗ロールのロックは残る（FR-4.6 / Q26）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ok" } }).resolves({
      Item: changeRequestItem({ id: "cr-ok", roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }),
    });
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ng" } }).resolves({
      Item: changeRequestItem({ id: "cr-ng", roleArn: ADMIN, status: "draft", addUserArns: [KENJI] }),
    });

    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async (roleArn: string) => {
        if (roleArn === ADMIN) {
          throw new IamOperationError("access-denied", "AccessDenied", ADMIN, plainMessage("拒否"));
        }
      },
    };

    await applyChangeRequests(["cr-ok", "cr-ng"], NOW, DEPLOY_ACCOUNT, null, { iam });

    const deletedLocks = ddbMock
      .commandCalls(DeleteCommand)
      .map((call) => call.args[0].input.Key?.pk);
    expect(deletedLocks).toContain(`ROLELOCK#${DEPLOY}`);
    expect(deletedLocks).not.toContain(`ROLELOCK#${ADMIN}`);
  });

  it("反映者（appliedBy）を、成功した申請にも失敗した申請にも記録する（Issue #120）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ok" } }).resolves({
      Item: changeRequestItem({ id: "cr-ok", roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }),
    });
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ng" } }).resolves({
      Item: changeRequestItem({ id: "cr-ng", roleArn: ADMIN, status: "draft", addUserArns: [KENJI] }),
    });
    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async (roleArn: string) => {
        if (roleArn === ADMIN) {
          throw new IamOperationError("access-denied", "AccessDenied", ADMIN, plainMessage("拒否されました"));
        }
      },
    };
    const bob = { name: "bob", sub: "user-2" };

    await applyChangeRequests(["cr-ok", "cr-ng"], NOW, DEPLOY_ACCOUNT, bob, { iam });

    const updates = statusUpdates();
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.ExpressionAttributeValues?.[":appliedBy"]).toEqual(bob);
    }
  });

  it("実行者が分からない反映（null）でも反映は進み、appliedBy は null", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ok" } }).resolves({
      Item: changeRequestItem({ id: "cr-ok", roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }),
    });
    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async () => undefined,
    };

    const [report] = await applyChangeRequests(["cr-ok"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({ ok: true, status: "applied" });
    const update = statusUpdates()[0];
    expect(update?.ExpressionAttributeValues?.[":appliedBy"]).toBeNull();
  });
});

describe("コミット点より後の失敗（B-1 / requirements.md § Assignment と ChangeRequest の関係）", () => {
  /** DynamoDB の一時障害（条件付き書き込みの失敗ではない）。`StorageError` へ変換される。 */
  function throttled(): Error {
    return Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" });
  }

  function stubApplicable(id: string): void {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${id}` } }).resolves({
      Item: changeRequestItem({
        id,
        roleArn: DEPLOY,
        status: "draft",
        addUserArns: [AYAKA],
      }),
    });
  }

  /** ChangeRequest 本体に書き込まれた status の履歴（Assignment の更新は除く）。 */
  function recordedStatuses(): unknown[] {
    return statusUpdates().map((input) => input.ExpressionAttributeValues?.[":status"]);
  }

  it("AWS 反映成功後にロック解放が失敗しても、状態は「反映済み」のまま巻き戻らない", async () => {
    stubApplicable("cr-leak");
    // ロック解放（DeleteItem）だけが DynamoDB の一時障害で失敗する。
    ddbMock.on(DeleteCommand).rejects(throttled());

    const updateTrustPolicy = vi.fn();
    const [report] = await applyChangeRequests(["cr-leak"], NOW, DEPLOY_ACCOUNT, null, {
      iam: { getTrustPolicy: async () => emptyPolicy(), updateTrustPolicy },
    });

    // AWS の信頼ポリシーは確かに更新されている。
    expect(updateTrustPolicy).toHaveBeenCalledTimes(1);

    // 記録も報告も「反映済み」。失敗へ倒れない。
    expect(report).toMatchObject({ ok: true, status: "applied", errorCode: null });

    // 監査記録が「失敗」で上書きされていないこと。
    // これが requirements.md § Assignment と ChangeRequest の関係「反映した内容と監査記録は必ず一致する」の担保である。
    expect(recordedStatuses()).toEqual(["applied"]);
  });

  it("解放できなかったロックは握り潰さず警告として報告される", async () => {
    stubApplicable("cr-leak");
    ddbMock.on(DeleteCommand).rejects(throttled());

    const [report] = await applyChangeRequests(["cr-leak"], NOW, DEPLOY_ACCOUNT, null, {
      iam: { getTrustPolicy: async () => emptyPolicy(), updateTrustPolicy: async () => {} },
    });

    // 漏れたロックは FR-4.6 により当該ロールの新規申請を止める。黙って消えてはならない。
    expect(
      report?.warnings.some((warning) => warning.includes("ロールロックを解放できませんでした")),
    ).toBe(true);
  });

  it("エッジケース: 別の申請がロックを保持していた場合は警告のみで、状態は「反映済み」", async () => {
    stubApplicable("cr-other");
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());

    const [report] = await applyChangeRequests(["cr-other"], NOW, DEPLOY_ACCOUNT, null, {
      iam: { getTrustPolicy: async () => emptyPolicy(), updateTrustPolicy: async () => {} },
    });

    expect(report).toMatchObject({ ok: true, status: "applied" });
    expect(
      report?.warnings.some((warning) => warning.includes("別の申請が保持しています")),
    ).toBe(true);
    expect(recordedStatuses()).toEqual(["applied"]);
  });

  it("エッジケース: AWS 反映そのものが失敗した場合は従来どおり「失敗」を記録する", async () => {
    stubApplicable("cr-aws-ng");

    const [report] = await applyChangeRequests(["cr-aws-ng"], NOW, DEPLOY_ACCOUNT, null, {
      iam: {
        getTrustPolicy: async () => emptyPolicy(),
        updateTrustPolicy: async () => {
          throw new IamOperationError("access-denied", "AccessDenied", DEPLOY, plainMessage("拒否"));
        },
      },
    });

    expect(report).toMatchObject({ ok: false, status: "failed", errorCode: "AccessDenied" });
    expect(recordedStatuses()).toEqual(["failed"]);
    // FR-4.6: 失敗は「未反映」に含まれるためロックは解放しない。
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

describe("デプロイ先と異なるアカウントのロール（Issue #85）", () => {
  // デプロイ先のロールと同名で、アカウント ID だけが違う（#27 の事象の形）。IAM はロール名だけで呼ばれるため、
  // デプロイ先の資格情報で呼ぶと、デプロイ先の DeployProd を書き換える。どの資格情報で呼ぶかは IAM クライアントが選び、
  // 引き受けに失敗してもデプロイ先の資格情報では呼ばない（`iam-client.test.ts` が固定する）。
  // このサービスは、ロールの ARN をそのまま渡し、失敗を「失敗」として記録する。
  const CROSS = "arn:aws:iam::999900001111:role/DeployProd";

  function stubDraft(id: string, roleArn: string): void {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${id}` } }).resolves({
      Item: changeRequestItem({ id, roleArn, status: "draft", addUserArns: [AYAKA] }),
    });
  }

  function spyIam() {
    return {
      getTrustPolicy: vi.fn(async (_roleArn: string) => emptyPolicy()),
      updateTrustPolicy: vi.fn(async (_roleArn: string, _document: TrustPolicyDocument) => {}),
    };
  }

  /** 書き込まれた status を、ChangeRequest 本体とロールロックに分けて返す。 */
  function recordedStatusesOf(pk: string): unknown[] {
    return ddbMock
      .commandCalls(UpdateCommand)
      .filter(
        (call) =>
          call.args[0].input.Key?.pk === pk && !call.args[0].input.ExpressionAttributeValues?.[":until"],
      )
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[":status"]);
  }

  it("別アカウントのロールも、IAM クライアントへ ARN のまま渡して読み、更新し、「反映済み」を記録する", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();

    const [report] = await applyChangeRequests(["cr-cross"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(iam.getTrustPolicy.mock.calls).toEqual([[CROSS]]);
    expect(iam.updateTrustPolicy.mock.calls.map(([roleArn]) => roleArn)).toEqual([CROSS]);
    expect(report).toMatchObject({ ok: true, status: "applied", roleArn: CROSS });
    expect(recordedStatusesOf("CR")).toEqual(["applied"]);
  });

  it("ターゲット側のロールを引き受けられなければ、更新せずに「失敗」を記録し、ロールロックは保持したまま失敗の状態にする", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();
    iam.getTrustPolicy.mockRejectedValue(
      new IamOperationError(
        "assume-role",
        "AccessDenied",
        CROSS,
        plainMessage("アカウント 999900001111 のロール RolustTrustPolicyManager を引き受けられませんでした（AccessDenied）。docs/guide/cross-account.md の手順で作成してください。"),
      ),
    );

    const [report] = await applyChangeRequests(["cr-cross"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(iam.updateTrustPolicy).not.toHaveBeenCalled();
    expect(report).toMatchObject({ ok: false, status: "failed", roleArn: CROSS, errorCode: "AccessDenied" });
    // GI-6: 何が問題か（どのアカウントのどのロールか）と、直し方（docs/guide/cross-account.md の手順）を示す。
    expect(report?.message).toContain("999900001111");
    expect(report?.message).toContain("RolustTrustPolicyManager");
    expect(report?.message).toContain("docs/guide/cross-account.md");
    // FR-5.5: 失敗として記録する。FR-4.6: 失敗は未反映なのでロックは解放しない。
    expect(recordedStatusesOf("CR")).toEqual(["failed"]);
    expect(recordedStatusesOf(`ROLELOCK#${CROSS}`)).toEqual(["failed"]);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("デプロイ先のアカウント ID が分からないときは、IAM クライアントが止めた失敗を「失敗」として記録する", async () => {
    stubDraft("cr-unknown", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockRejectedValue(
      new IamOperationError("deploy-account-unknown", "DeployAccountUnknown", DEPLOY, plainMessage("デプロイ先を判定できません")),
    );

    const [report] = await applyChangeRequests(["cr-unknown"], NOW, null, null, { iam });

    expect(iam.updateTrustPolicy).not.toHaveBeenCalled();
    expect(report).toMatchObject({ ok: false, status: "failed", errorCode: "DeployAccountUnknown" });
    expect(recordedStatusesOf("CR")).toEqual(["failed"]);
  });

  it("別アカウントの申請が失敗しても、デプロイ先の申請は反映される（FR-5.4）。失敗した申請のロールは更新しない", async () => {
    stubDraft("cr-cross", CROSS);
    stubDraft("cr-ok", DEPLOY);
    const iam = spyIam();
    iam.getTrustPolicy.mockImplementation(async (roleArn: string) => {
      if (roleArn === CROSS) {
        throw new IamOperationError("assume-role", "AccessDenied", CROSS, plainMessage("引き受けられませんでした"));
      }
      return emptyPolicy();
    });

    const reports = await applyChangeRequests(["cr-cross", "cr-ok"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(reports.map((report) => [report.changeRequestId, report.ok])).toEqual([
      ["cr-cross", false],
      ["cr-ok", true],
    ]);
    // 更新に渡ったのは、デプロイ先の ARN だけ。
    expect(iam.updateTrustPolicy.mock.calls.map(([roleArn]) => roleArn)).toEqual([DEPLOY]);
  });

  it("既定の IAM クライアントは、デプロイ先のアカウント ID を渡して作る（ロールのアカウントで資格情報を選ぶために要る）", async () => {
    stubDraft("cr-cross", CROSS);
    const iam = spyIam();
    vi.mocked(createIamTrustPolicyClient).mockReturnValueOnce(iam);

    await applyChangeRequests(["cr-cross"], NOW, DEPLOY_ACCOUNT, null);

    expect(createIamTrustPolicyClient).toHaveBeenCalledWith(DEPLOY_ACCOUNT);
    expect(iam.updateTrustPolicy).toHaveBeenCalledOnce();
  });
});

describe("再反映（FR-5.6）と凍結入力（FR-5.2 / Q5=A）", () => {
  it("失敗状態の申請を、凍結入力を変えずに再反映して成功させられる", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-retry" } }).resolves({
      Item: changeRequestItem({
        id: "cr-retry",
        roleArn: DEPLOY,
        status: "failed",
        addUserArns: [AYAKA],
      }),
    });

    const updated: TrustPolicyDocument[] = [];
    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async (_roleArn, document) => {
        updated.push(document);
      },
    };

    const [report] = await applyChangeRequests(["cr-retry"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({ ok: true, status: "applied" });
    expect(report?.added).toEqual([AYAKA]);
    // 凍結入力どおりの principal が信頼ポリシーへ入っている
    expect(JSON.stringify(updated[0])).toContain(AYAKA);
  });

  it("Q5=A: 反映は凍結入力のみを見る。現在の IamUser 一覧は参照しない", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-frozen" } }).resolves({
      Item: changeRequestItem({
        id: "cr-frozen",
        roleArn: DEPLOY,
        status: "draft",
        addUserArns: [AYAKA],
      }),
    });

    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async () => {},
    };

    await applyChangeRequests(["cr-frozen"], NOW, DEPLOY_ACCOUNT, null, { iam });

    // 反映経路が IamUser の一覧（POOLS の GSI Query）を引いていないことを確認する。
    // 引いていれば「削除済みユーザが管理外へ転落する」経路が混入している。
    const queried = ddbMock
      .commandCalls(GetCommand)
      .map((call) => call.args[0].input.Key?.pk);
    expect(queried).not.toContain("POOLS");
  });

  it("エッジケース: 反映済みの申請は再反映せず、状態も変えない", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-done" } }).resolves({
      Item: {
        ...changeRequestItem({ id: "cr-done", roleArn: DEPLOY, status: "applied" }),
        appliedAt: "2026-07-31T09:00:00.000Z",
      },
    });

    const updateTrustPolicy = vi.fn();
    const reports = await applyChangeRequests(["cr-done"], NOW, DEPLOY_ACCOUNT, null, {
      iam: { getTrustPolicy: async () => emptyPolicy(), updateTrustPolicy },
    });

    expect(reports[0]).toMatchObject({
      ok: false,
      status: "applied",
      errorCode: "InvalidState",
    });
    expect(updateTrustPolicy).not.toHaveBeenCalled();
  });

  it("エッジケース: 存在しない申請でも他ロールの結果を巻き込まず個別に報告する", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-ok" } }).resolves({
      Item: changeRequestItem({ id: "cr-ok", roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }),
    });
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-missing" } }).resolves({});

    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async () => {},
    };

    const reports = await applyChangeRequests(["cr-ok", "cr-missing"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ ok: true });
    expect(reports[1]).toMatchObject({ ok: false, errorCode: "NotFound" });
  });

  it("エッジケース: 信頼ポリシーが既に申請どおりなら AWS を更新しない（FR-4.3 の無駄書き防止）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-noop" } }).resolves({
      Item: changeRequestItem({
        id: "cr-noop",
        roleArn: DEPLOY,
        status: "draft",
        addUserArns: [AYAKA],
      }),
    });

    const updateTrustPolicy = vi.fn();
    const reports = await applyChangeRequests(["cr-noop"], NOW, DEPLOY_ACCOUNT, null, {
      iam: {
        getTrustPolicy: async () => ({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "RolustManagedPrincipals",
              Effect: "Allow" as const,
              Principal: { AWS: [AYAKA] },
              Action: "sts:AssumeRole",
            },
          ],
        }),
        updateTrustPolicy,
      },
    });

    expect(updateTrustPolicy).not.toHaveBeenCalled();
    expect(reports[0]).toMatchObject({ ok: true, status: "applied" });
  });
});

describe("同時操作の排他（claim。Issue #121）", () => {
  const CLAIM_EXPRESSION = "SET #applyingToken = :token, #applyingUntil = :until";

  function stubDraft(id: string, roleArn: string): void {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${id}` } }).resolves({
      Item: changeRequestItem({ id, roleArn, status: "draft", addUserArns: [AYAKA] }),
    });
  }

  function spyIam() {
    return {
      getTrustPolicy: vi.fn(async (_roleArn: string) => emptyPolicy()),
      updateTrustPolicy: vi.fn(async (_roleArn: string, _document: TrustPolicyDocument) => {}),
    };
  }

  /** claim の UpdateCommand だけを条件不一致で失敗させる。 */
  function refuseClaim(): void {
    ddbMock.on(UpdateCommand).callsFake((input: { UpdateExpression?: string }) => {
      if (input.UpdateExpression === CLAIM_EXPRESSION) throw conditionalCheckFailed();
      return {};
    });
  }

  it("IAM を呼ぶ前に claim を取り、確定の書き込みはその token を条件にして claim を外す", async () => {
    stubDraft("cr-1", DEPLOY);
    const iam = spyIam();

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({ ok: true, status: "applied" });
    const calls = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input);
    expect(calls[0]?.UpdateExpression).toBe(CLAIM_EXPRESSION);
    const token = calls[0]?.ExpressionAttributeValues?.[":token"];
    expect(typeof token).toBe("string");
    const [commit] = statusUpdates();
    expect(commit?.ConditionExpression).toBe("attribute_exists(pk) AND #applyingToken = :token");
    expect(commit?.ExpressionAttributeValues?.[":token"]).toBe(token);
    expect(commit?.UpdateExpression).toContain("REMOVE #applyingToken, #applyingUntil");
  });

  it("別の管理者が反映中（claim を取れず、申請は反映できる状態）なら Conflict を報告し、IAM も記録も書かない", async () => {
    stubDraft("cr-1", DEPLOY);
    refuseClaim();
    const iam = spyIam();

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({
      ok: false,
      status: "draft",
      roleArn: DEPLOY,
      errorCode: "Conflict",
    });
    expect(report?.message).toContain("別の管理者がこの申請を反映中");
    expect(iam.getTrustPolicy).not.toHaveBeenCalled();
    expect(iam.updateTrustPolicy).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("読んだ後に別の管理者が先に反映していたら（claim を取れず、読み直すと反映済み）InvalidState を報告する", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-1" } })
      .resolvesOnce({ Item: changeRequestItem({ id: "cr-1", roleArn: DEPLOY, status: "draft" }) })
      .resolves({ Item: changeRequestItem({ id: "cr-1", roleArn: DEPLOY, status: "applied" }) });
    refuseClaim();
    const iam = spyIam();

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({ ok: false, status: "applied", errorCode: "InvalidState" });
    expect(iam.updateTrustPolicy).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(0);
  });

  it("claim を取れなかった後の読み直しは、強い整合性で行う（先に確定した状態を古い値で見ない）", async () => {
    stubDraft("cr-1", DEPLOY);
    refuseClaim();

    await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: spyIam() });

    const reads = ddbMock.commandCalls(GetCommand).map((call) => call.args[0].input);
    expect(reads[0]?.ConsistentRead).toBeUndefined();
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.slice(1).every((input) => input.ConsistentRead === true)).toBe(true);
  });

  it("確定の書き込みが条件に外れて、自分のものでもなければ、失敗として報告し、例外にしない", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-1" } })
      .resolvesOnce({ Item: changeRequestItem({ id: "cr-1", roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }) })
      .resolves({ Item: { ...changeRequestItem({ id: "cr-1", roleArn: DEPLOY, status: "draft" }), applyingToken: "other" } });
    ddbMock.on(UpdateCommand).callsFake((input: { UpdateExpression?: string; ConditionExpression?: string }) => {
      if (input.ConditionExpression?.includes("#applyingToken = :token")) throw conditionalCheckFailed();
      return {};
    });

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: spyIam() });

    expect(report).toMatchObject({ ok: false, status: "failed" });
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("反映が失敗したときも、失敗の記録は token を条件にして claim を外す（すぐ再反映できる。FR-5.6）", async () => {
    stubDraft("cr-1", DEPLOY);
    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => emptyPolicy(),
      updateTrustPolicy: async () => {
        throw new IamOperationError("access-denied", "AccessDenied", DEPLOY, plainMessage("拒否"));
      },
    };

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam });

    expect(report).toMatchObject({ ok: false, status: "failed", errorCode: "AccessDenied" });
    const [failed] = statusUpdates();
    expect(failed?.ConditionExpression).toBe("attribute_exists(pk) AND #applyingToken = :token");
    expect(failed?.ExpressionAttributeValues?.[":status"]).toBe("failed");
    expect(failed?.UpdateExpression).toContain("REMOVE #applyingToken, #applyingUntil");
  });
});

describe("文言の ID（Issue #94）", () => {
  function stubApplicable(id: string): void {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: `CR#${id}` } }).resolves({
      Item: changeRequestItem({ id, roleArn: DEPLOY, status: "draft", addUserArns: [AYAKA] }),
    });
  }

  /** 保存した反映結果（`ChangeRequest.result`）。 */
  function savedResult(): { ok: boolean; message: string; localized?: unknown } | undefined {
    return statusUpdates()[0]?.ExpressionAttributeValues?.[":result"] as never;
  }

  /** `message` と `warnings` は、`localized` と `localizedWarnings` の日本語の描画と一致する。 */
  function expectJaMatchesLocalized(report: ApplyReport | undefined): void {
    expect(report?.localized).toBeDefined();
    expect(report?.message).toBe(renderMessage("ja", report!.localized!));
    expect(report?.localizedWarnings?.length).toBe(report?.warnings.length);
    expect(report?.localizedWarnings?.map((warning) => renderMessage("ja", warning))).toEqual(report?.warnings);
  }

  const okIam = { getTrustPolicy: async () => emptyPolicy(), updateTrustPolicy: async () => {} };

  it("反映の成功は apply.updated と件数を持ち、message は従来どおり、保存する result にも localized が入る", async () => {
    stubApplicable("cr-1");

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.localized).toEqual(localized("apply.updated", { added: 1, removed: 0 }));
    expect(report?.message).toBe("信頼ポリシーを更新しました（追加 1 / 削除 0）");
    expect(report?.warnings).toEqual([]);
    expect(report?.localizedWarnings).toEqual([]);
    expect(savedResult()?.localized).toEqual(report?.localized);
    expect(savedResult()?.message).toBe(report?.message);
  });

  it("信頼ポリシーが既に申請どおりなら apply.alreadyApplied", async () => {
    stubApplicable("cr-1");
    const already: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: [AYAKA] }, Action: "sts:AssumeRole" }],
    };

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, {
      iam: { getTrustPolicy: async () => already, updateTrustPolicy: async () => {} },
    });

    expect(report?.localized).toEqual(localized("apply.alreadyApplied", {}));
    expect(report?.message).toBe("信頼ポリシーは既に申請どおりの状態でした");
    expect(savedResult()?.localized).toEqual(report?.localized);
  });

  it("反映の失敗は、IamOperationError の localized をそのまま運び、保存する result にも入る", async () => {
    stubApplicable("cr-1");
    const cause = localized("iam.awsMessageForRole", {
      accountId: "555566667777",
      roleName: "DeployProd",
      operation: "iam:UpdateAssumeRolePolicy",
      detail: "denied",
    });

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, {
      iam: {
        getTrustPolicy: async () => emptyPolicy(),
        updateTrustPolicy: async () => {
          throw new IamOperationError("access-denied", "AccessDenied", DEPLOY, cause);
        },
      },
    });

    expect(report?.errorCode).toBe("AccessDenied");
    expect(report?.localized).toEqual(cause);
    expect(report?.message).toBe(renderMessage("ja", cause));
    expect(savedResult()?.localized).toEqual(cause);
  });

  it("IamOperationError でない Error は common.rawDetail、Error でない例外は apply.updateFailed", async () => {
    stubApplicable("cr-1");
    const [rawReport] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, {
      iam: {
        getTrustPolicy: async () => {
          throw new Error("plain boom");
        },
        updateTrustPolicy: async () => {},
      },
    });
    expect(rawReport?.errorCode).toBe("UnknownError");
    expect(rawReport?.message).toBe("plain boom");
    expect(rawReport?.localized).toEqual(localized("common.rawDetail", { detail: "plain boom" }));

    ddbMock.resetHistory();
    const [unknownReport] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, {
      iam: {
        getTrustPolicy: async () => {
          throw "not an Error";
        },
        updateTrustPolicy: async () => {},
      },
    });
    expect(unknownReport?.localized).toEqual(localized("apply.updateFailed", {}));
    expect(unknownReport?.message).toBe("信頼ポリシーの更新に失敗しました");
    expect(savedResult()?.localized).toEqual(unknownReport?.localized);
  });

  it("確定の書き込みが拒否された反映は、RolustError の localized（changeRequest.stateUpdateRefused）を運ぶ", async () => {
    stubApplicable("cr-1");
    ddbMock.on(UpdateCommand).callsFake((input: { UpdateExpression?: string }) => {
      if (input.UpdateExpression?.startsWith("SET #status")) throw conditionalCheckFailed();
      return {};
    });

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.ok).toBe(false);
    expect(report?.localized).toEqual(localized("changeRequest.stateUpdateRefused", { changeRequestId: "cr-1" }));
    expectJaMatchesLocalized(report);
  });

  it("存在しない申請は apply.notFound", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-missing" } }).resolves({});

    const [report] = await applyChangeRequests(["cr-missing"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.localized).toEqual(localized("apply.notFound", {}));
    expect(report?.message).toBe("申請が見つかりません");
    expect(report?.localizedWarnings).toEqual([]);
  });

  it("反映済みの申請は apply.invalidState と状態を持つ", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-done" } }).resolves({
      Item: changeRequestItem({ id: "cr-done", roleArn: DEPLOY, status: "applied" }),
    });

    const [report] = await applyChangeRequests(["cr-done"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.localized).toEqual(localized("apply.invalidState", { status: "applied" }));
    expect(report?.message).toBe("状態「applied」の申請は反映できません");
    expect(report?.localizedWarnings).toEqual([]);
  });

  it("別の管理者が反映中なら apply.inProgressByOther", async () => {
    stubApplicable("cr-1");
    ddbMock.on(UpdateCommand).callsFake((input: { UpdateExpression?: string }) => {
      if (input.UpdateExpression === "SET #applyingToken = :token, #applyingUntil = :until") {
        throw conditionalCheckFailed();
      }
      return {};
    });

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.errorCode).toBe("Conflict");
    expect(report?.localized).toEqual(localized("apply.inProgressByOther", {}));
    expect(report?.message).toBe(renderMessage("ja", localized("apply.inProgressByOther", {})));
    expect(report?.localizedWarnings).toEqual([]);
  });

  it("ロックの解放に失敗したら apply.lockReleaseFailed（cause は例外の localized）で、warnings と localizedWarnings は同じ長さ・並び", async () => {
    stubApplicable("cr-1");
    ddbMock.on(DeleteCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.localizedWarnings).toHaveLength(1);
    expect(report?.localizedWarnings?.[0]?.id).toBe("apply.lockReleaseFailed");
    // 括弧の中（DynamoDB の失敗）まで、en では英語で描画される。
    expect(renderMessage("en", report!.localizedWarnings![0]!)).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(report?.warnings[0]).toContain("ロールロックを解放できませんでした");
    expectJaMatchesLocalized(report);
  });

  it("別の申請がロックを保持していたら apply.lockNotHeld", async () => {
    stubApplicable("cr-1");
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.localizedWarnings).toEqual([localized("apply.lockNotHeld", {})]);
    expect(report?.warnings).toEqual(["この申請はロールロックを保持していませんでした（別の申請が保持しています）"]);
  });

  it("baseline の更新に失敗したら apply.baselineFailed と件数。ロックの警告と並べても並びが揃う", async () => {
    stubApplicable("cr-1");
    ddbMock.on(DeleteCommand).rejects(conditionalCheckFailed());
    // baseline（Assignment）の更新だけが失敗する。申請本体と claim の更新は通す。
    ddbMock.on(UpdateCommand).callsFake((input: { Key?: { pk?: string } }) => {
      if (input.Key?.pk !== "CR") throw Object.assign(new Error("slow"), { name: "ThrottlingException" });
      return {};
    });

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report?.ok).toBe(true);
    expect(report?.localizedWarnings).toEqual([
      localized("apply.lockNotHeld", {}),
      localized("apply.baselineFailed", { count: 1 }),
    ]);
    expectJaMatchesLocalized(report);
  });

  it("申請を読めず異常終了した反映は、例外の localized を運ぶ（結果が不明なロールを作らない）", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-1" } })
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam: okIam });

    expect(report).toMatchObject({ ok: false, errorCode: "InternalError", warnings: [], localizedWarnings: [] });
    expect(report?.localized?.id).toBe("storage.operationFailed");
    expect(report?.message).toBe(renderMessage("ja", report!.localized!));
  });
});

describe("種別 restore の申請の反映（FR-4.10。Issue #172）", () => {
  /** AYAKA を足し、KENJI を外す申請を、種別を変えて反映し、AWS・記録への書き込みを集める。 */
  async function applyWith(kind: "restore" | undefined) {
    setupDdbMock();
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});
    ddbMock.on(GetCommand, { Key: { pk: "CR", sk: "CR#cr-1" } }).resolves({
      Item: changeRequestItem({
        id: "cr-1",
        roleArn: DEPLOY,
        status: "draft",
        addUserArns: [AYAKA],
        removeUserArns: [KENJI],
        kind,
      }),
    });
    const updateTrustPolicy = vi.fn(async () => undefined);
    const iam: IamTrustPolicyClient = {
      getTrustPolicy: async () => ({
        Version: "2012-10-17",
        Statement: [{ Sid: "S1", Effect: "Allow", Principal: { AWS: [KENJI] }, Action: "sts:AssumeRole" }],
      }),
      updateTrustPolicy,
    };

    const [report] = await applyChangeRequests(["cr-1"], NOW, DEPLOY_ACCOUNT, null, { iam });

    const baseline = ddbMock
      .commandCalls(UpdateCommand)
      .map((call) => call.args[0].input)
      .filter((input) => input.Key?.pk !== "CR")
      .map((input) => ({ user: input.ExpressionAttributeValues?.[":userArn"], reflected: input.ExpressionAttributeValues?.[":reflected"] }));
    return { report, updateTrustPolicy, baseline, status: statusUpdates() };
  }

  it("restore の申請も、通常の申請と同じマージで反映し、反映済みにして、baseline を追随させる（kind は書き換えない）", async () => {
    const restore = await applyWith("restore");
    const normal = await applyWith(undefined);

    expect(restore.report).toMatchObject({ ok: true, status: "applied", added: [AYAKA], removed: [KENJI] });
    // マージ後の信頼ポリシー（AYAKA を足し KENJI を外す）。
    const [, document] = restore.updateTrustPolicy.mock.calls[0] as unknown as [string, TrustPolicyDocument];
    expect(JSON.stringify(document)).toContain(AYAKA);
    expect(JSON.stringify(document)).not.toContain(KENJI);
    // 状態の書き込みは「反映済み」で、kind の属性には触れない（申請の種別が残る）。
    expect(restore.status).toHaveLength(1);
    expect(restore.status[0]?.ExpressionAttributeValues?.[":status"]).toBe("applied");
    expect(JSON.stringify(restore.status[0]?.ExpressionAttributeNames)).not.toContain("kind");
    expect(String(restore.status[0]?.UpdateExpression)).not.toContain("kind");
    // baseline: 足したユーザは reflected=true、外したユーザは false。
    expect(restore.baseline).toEqual(
      expect.arrayContaining([{ user: AYAKA, reflected: true }, { user: KENJI, reflected: false }]),
    );
    expect(restore.baseline).toHaveLength(2);
    // 通常の申請と、AWS・記録への書き込みが同じ。
    expect(restore.updateTrustPolicy.mock.calls).toEqual(normal.updateTrustPolicy.mock.calls);
    expect(restore.baseline).toEqual(normal.baseline);
    expect(restore.status[0]?.ExpressionAttributeValues?.[":status"]).toBe(normal.status[0]?.ExpressionAttributeValues?.[":status"]);
  });
});
