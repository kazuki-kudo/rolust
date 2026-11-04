import { isDeepStrictEqual } from "node:util";

import type { FrozenInput, TrustPolicyDocument } from "@rolust/core";
import {
  computeTrustDrift,
  computeTrustPolicyDiff,
  findUnmanagedPrincipals,
  importableUserArns,
  listPrincipals,
  mergeTrustPolicy,
  parseRoleArn,
} from "@rolust/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIamTrustPolicyClient,
  createIamTrustPolicyReader,
  IamOperationError,
} from "../aws/iam-client.js";
import { assertCallerAccount, loadIntegrationEnv, withProfile } from "./support.js";

/**
 * 実 AWS に対する統合テスト（SM-1 / FR-5.1 / FR-5.2 / FR-5.3）。
 *
 * **既定の `npm run test` では実行されない。** `vitest.config.ts` が
 * `**\/*.integration.test.ts` を除外しており、実行には専用の設定と環境変数の明示が要る。
 *
 * ```bash
 * # `.local/rolust.env.example` を `.local/rolust.env` に写して値を入れ、読み込んでから実行する
 * source .local/rolust.env
 * ROLUST_INTEGRATION=1 npm run test:integration
 * ```
 *
 * ユニットテストが AWS SDK を `aws-sdk-client-mock` でスタブするのに対し、本ファイルは
 * **スタブしない**。FR-5.3（実 IAM API で信頼ポリシーを更新できること）は、定義上
 * モックでは検証できない。
 *
 * ## 対象リソース — 作成も削除もしない
 *
 * 検証対象は**事前に用意された既存のスイッチロール**である。本テストはロールを
 * 作成しない。`beforeAll` で実行前の内容を退避してから各シナリオの前提（`FIXTURE`）を
 * 書き込み、`afterAll` で**実行前の内容へ復元する**。復元の後に読み直して実行前と一致する
 * ことを確かめ、一致しなければ失敗させる（`CLAUDE.md` § テスト方針: 既存の実資源を
 * 書き換える検証は退避・復元・一致確認を必須とする）。
 *
 * 前提を書き込むのは、対象ロールが管理画面からも操作され、実行時点の内容がシナリオの前提と
 * 一致するとは限らないためである。2026-09-25 には `jump_role_sw_rolust_b` が 3 ユーザを持ち
 * シナリオ 2 が全削除に到達せず、`jump_role_sw_rolust_a` は `Statement1` を持たずシナリオ 1 が
 * 空振りしていた（Issue #16）。
 *
 * | ロール | アカウント | 役割 |
 * |---|---|---|
 * | `jump_role_sw_rolust_a` | DEPLOY | FR-5.1 シナリオ 1（管理外を保全したまま追加）、Issue #80（紐づけ時の取り込み対象の抽出） |
 * | `jump_role_sw_rolust_b` | DEPLOY | FR-5.1 シナリオ 2（削除）＋ merge 規則 5（空文書の禁止）＋ 規則 6（追加でプレースホルダを取り除く） |
 * | `dev1_role_sw_rolust_c` | TARGET1 | FR-5.2 シナリオ 3（凍結入力の優先）。DEPLOY のユーザを信頼するクロスアカウント構成 |
 *
 * ## 前提（実行する人が事前に用意する）
 *
 * - DEPLOY・TARGET1 の 2 アカウントのプロファイルがあり、それぞれ対象ロールの信頼ポリシーを読み書きできること
 *   （`iam:GetRole`・`iam:UpdateAssumeRolePolicy`）。
 * - 上の表の 3 本のロールが実在すること（このテストは作成も削除もしない）。
 * - DEPLOY に IAM ユーザ `test1@example.com`〜`test3@example.com` が実在すること（IAM は実在しない
 *   principal を拒否する）。
 * - 環境変数 `ROLUST_INTEGRATION_{DEPLOY,TARGET1}_{PROFILE,ACCOUNT}` を設定すること（既定値はない。
 *   書き込みの前に、プロファイルのアカウントが期待と一致するかを STS で照合する）。
 *
 * ## 2 アカウントをまたぐ理由と方法
 *
 * `createIamTrustPolicyClient()` は AWS SDK の認証情報チェーンから資格情報を得る
 * （NFR-3）。対象ロールが 2 アカウントに分かれているため、`AWS_PROFILE` を切り替えて
 * `resetIamClient()` でクライアントを作り直す。これはテストハーネスの都合である。
 *
 * **AssumeRole の経路（別アカウントのロールを Reader・Manager 経由で操作する経路。Issue #85）は、このテストでは通らない。**
 * 各ロールを、そのロールのアカウントのプロファイルの資格情報で直接読み書きする（デプロイ先 = ロールのアカウントとして
 * クライアントを作る）。引き受けは、Rolust の Lambda の実行ロールでしか成立しない（ターゲット側の信頼ポリシーが
 * その実行ロールだけを名指しするため）。実測は
 * `docs/runbooks/cross-account-roles.md` の手順で、デプロイした Rolust に対して行う。
 */

const RUN = process.env.ROLUST_INTEGRATION === "1";

// 既定値は持たない。RUN が真で未設定・不正なら、AWS を呼ぶ前にここで失敗する（Issue #176）。
const env = loadIntegrationEnv(
  [
    "ROLUST_INTEGRATION_DEPLOY_PROFILE",
    "ROLUST_INTEGRATION_DEPLOY_ACCOUNT",
    "ROLUST_INTEGRATION_TARGET1_PROFILE",
    "ROLUST_INTEGRATION_TARGET1_ACCOUNT",
  ] as const,
  RUN,
);
const DEPLOY_PROFILE = env.ROLUST_INTEGRATION_DEPLOY_PROFILE;
const TARGET1_PROFILE = env.ROLUST_INTEGRATION_TARGET1_PROFILE;
const DEPLOY_ACCOUNT = env.ROLUST_INTEGRATION_DEPLOY_ACCOUNT;
const TARGET1_ACCOUNT = env.ROLUST_INTEGRATION_TARGET1_ACCOUNT;

const ROLE_A = `arn:aws:iam::${DEPLOY_ACCOUNT}:role/jump_role_sw_rolust_a`;
const ROLE_B = `arn:aws:iam::${DEPLOY_ACCOUNT}:role/jump_role_sw_rolust_b`;
const ROLE_C = `arn:aws:iam::${TARGET1_ACCOUNT}:role/dev1_role_sw_rolust_c`;

const USER1 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test1@example.com`;
const USER2 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test2@example.com`;
const USER3 = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/test3@example.com`;

/**
 * ロールのアカウントをデプロイ先として渡し、`withProfile` で選んだプロファイルの資格情報で、そのロールを直接読み書きする。
 * 呼び出し側が渡すのは、これまでどおりロールの ARN だけである。
 */
const client = {
  getTrustPolicy: (roleArn: string) =>
    createIamTrustPolicyClient(parseRoleArn(roleArn).accountId).getTrustPolicy(roleArn),
  updateTrustPolicy: (roleArn: string, document: TrustPolicyDocument) =>
    createIamTrustPolicyClient(parseRoleArn(roleArn).accountId).updateTrustPolicy(roleArn, document),
};

/** 実行前の信頼ポリシー。afterAll でこの内容へ戻す。 */
const original = new Map<string, TrustPolicyDocument>();

/** 1 つの IAM ユーザだけを信頼する、Rolust 管理外（Sid が Rolust のものでない）の文書。 */
function trustedBy(sid: string, userArn: string): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      { Sid: sid, Effect: "Allow", Principal: { AWS: userArn }, Action: "sts:AssumeRole" },
    ],
  };
}

/**
 * 各シナリオの前提となる信頼ポリシー。beforeAll で、退避の後に書き込む。
 *
 * - ROLE_A: USER1 を信頼する `Statement1`。シナリオ 1 で USER1 は凍結入力に無く、管理外として保全される
 * - ROLE_B: 管理下の USER1 だけ。シナリオ 2 で USER1 を削除すると Statement が 0 件になる
 * - ROLE_C: USER1 を信頼する `Statement1`（クロスアカウント）
 */
const FIXTURE: Record<string, TrustPolicyDocument> = {
  [ROLE_A]: trustedBy("Statement1", USER1),
  [ROLE_B]: trustedBy("RolustManagedPrincipals", USER1),
  [ROLE_C]: trustedBy("Statement1", USER1),
};

const profileOf: Record<string, string> = {
  [ROLE_A]: DEPLOY_PROFILE,
  [ROLE_B]: DEPLOY_PROFILE,
  [ROLE_C]: TARGET1_PROFILE,
};

function readTrustPolicy(roleArn: string): Promise<TrustPolicyDocument> {
  return withProfile(profileOf[roleArn] as string, () => client.getTrustPolicy(roleArn));
}

/** 凍結入力を実 AWS へ反映し、反映後の信頼ポリシーを読み直して返す。 */
async function applyFrozenInput(input: FrozenInput): Promise<TrustPolicyDocument> {
  const profile = profileOf[input.roleArn] as string;
  return withProfile(profile, async () => {
    const current = await client.getTrustPolicy(input.roleArn);
    const merged = mergeTrustPolicy(current, input);
    if (merged.changed) {
      await client.updateTrustPolicy(input.roleArn, merged.document);
    }
    return client.getTrustPolicy(input.roleArn);
  });
}

/**
 * 比較用に、文字列の配列（`Principal.AWS`・`Action` など）を並べ替えた複製を返す。
 *
 * IAM は `Principal.AWS` の配列の順序を保持しない。書き込んだ順とも、前回読んだ順とも
 * 異なる順で返すことがある（2026-09-25 に実測。Issue #16）。順序は信頼ポリシーの意味を
 * 変えないため、復元の一致確認では順序を無視する。Statement の並びはそのまま比べる。
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return items.every((item) => typeof item === "string") ? [...items].sort() : items;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/** 信頼ポリシーに現れる principal を、プレースホルダを含めて全件列挙する。 */
function principalArns(document: TrustPolicyDocument): string[] {
  return listPrincipals(document).map((entry) => entry.value);
}

function statementBySid(
  document: TrustPolicyDocument,
  sid: string,
): TrustPolicyDocument["Statement"][number] | undefined {
  return document.Statement.find((statement) => statement.Sid === sid);
}

/** 失敗が確定している Promise から `IamOperationError` を取り出す。 */
async function captureError(attempt: Promise<unknown>): Promise<IamOperationError> {
  try {
    await attempt;
  } catch (caught) {
    if (caught instanceof IamOperationError) return caught;
    throw caught;
  }
  throw new Error("失敗を期待した処理が成功しました");
}

describe.skipIf(!RUN)("実 AWS に対する信頼ポリシー反映（SM-1）", () => {
  beforeAll(async () => {
    // 書き込みの前に、プロファイルが期待のアカウントを指していることを確かめる。外れていれば何も書かない
    // （退避の前なので、afterAll の復元は空振りになる）。
    await assertCallerAccount(DEPLOY_PROFILE, DEPLOY_ACCOUNT);
    await assertCallerAccount(TARGET1_PROFILE, TARGET1_ACCOUNT);

    // 全ロールの退避が済むまで何も書き込まない。退避に失敗したロールは復元できないため。
    for (const roleArn of [ROLE_A, ROLE_B, ROLE_C]) {
      original.set(roleArn, await readTrustPolicy(roleArn));
    }
    for (const [roleArn, fixture] of Object.entries(FIXTURE)) {
      const profile = profileOf[roleArn] as string;
      await withProfile(profile, () => client.updateTrustPolicy(roleArn, fixture));
    }
  }, 120_000);

  afterAll(async () => {
    // 1 ロールの復元失敗で残りを諦めない。全ロールを試してから、戻せなかったものを報告する。
    const notRestored: string[] = [];
    for (const [roleArn, document] of original) {
      const profile = profileOf[roleArn] as string;
      try {
        await withProfile(profile, () => client.updateTrustPolicy(roleArn, document));
        const restored = await withProfile(profile, () => client.getTrustPolicy(roleArn));
        if (!isDeepStrictEqual(canonical(restored), canonical(document))) {
          console.error(
            `[restore] ${roleArn} の信頼ポリシーが実行前と一致しません`,
            JSON.stringify({ expected: document, actual: restored }),
          );
          notRestored.push(roleArn);
        }
      } catch (error) {
        console.error(`[restore] ${roleArn} の信頼ポリシー復元に失敗しました`, error);
        notRestored.push(roleArn);
      }
    }
    expect(notRestored, "実行前の信頼ポリシーへ戻せなかったロール").toEqual([]);
  }, 120_000);

  it("FR-5.3: 実 IAM API で信頼ポリシーを読める", async () => {
    const document = await readTrustPolicy(ROLE_A);

    expect(document.Version).toBe("2012-10-17");
    expect(document.Statement.length).toBeGreaterThan(0);
  });

  it("FR-5.1 シナリオ 1: 管理外 principal を保全したまま追加する", async () => {
    const before = await readTrustPolicy(ROLE_A);
    // 凍結入力に test1 は含まれない ＝ この反映において test1 は管理外（Q5=A）
    const beforeStatement = statementBySid(before, "Statement1");
    expect(principalArns(before)).toContain(USER1);

    const after = await applyFrozenInput({
      roleArn: ROLE_A,
      addUserArns: [USER2],
      removeUserArns: [],
    });

    // Then: 更新後の信頼ポリシーには追加分と管理外の両方が含まれる
    expect(principalArns(after)).toContain(USER2);
    expect(principalArns(after)).toContain(USER1);
    // And: 管理外 principal の Statement は更新前と等価である
    expect(statementBySid(after, "Statement1")).toEqual(beforeStatement);
  }, 120_000);

  it("FR-5.1 シナリオ 2 / 規則 5: 最後の管理下 principal を削除しても IAM が受け付ける", async () => {
    const before = await readTrustPolicy(ROLE_B);
    expect(principalArns(before)).toContain(USER1);
    // 前提: このロールの信頼ポリシーは管理下の principal だけで構成されている
    expect(before.Statement).toHaveLength(1);

    const after = await applyFrozenInput({
      roleArn: ROLE_B,
      addUserArns: [],
      removeUserArns: [USER1],
    });

    // Then: 更新後の信頼ポリシーから削除対象が消えている
    expect(principalArns(after)).not.toContain(USER1);
    // And: IAM が受理した ＝ Statement 0 件の文書を送っていない（規則 5）
    expect(after.Statement.length).toBeGreaterThan(0);
    const placeholder = statementBySid(after, "RolustPlaceholder");
    expect(placeholder).toBeDefined();
    expect(placeholder?.Effect).toBe("Allow");
  }, 120_000);

  it("規則 6（Issue #16）: 全削除で入ったプレースホルダが、続く追加で取り除かれる（往復）", async () => {
    // 全削除。シナリオ 2 の後なら USER1 は削除済みで文書は変化しないが、
    // いずれの場合もプレースホルダだけが残った状態になる。
    const emptied = await applyFrozenInput({
      roleArn: ROLE_B,
      addUserArns: [],
      removeUserArns: [USER1],
    });
    expect(statementBySid(emptied, "RolustPlaceholder")).toBeDefined();
    expect(principalArns(emptied)).not.toContain(USER1);

    // 差分画面が示す内容: プレースホルダの削除を示し、その root を管理外として警告しない
    const addInput: FrozenInput = { roleArn: ROLE_B, addUserArns: [USER1], removeUserArns: [] };
    expect(computeTrustPolicyDiff(emptied, addInput).placeholderRemoved).toBe(true);
    expect(findUnmanagedPrincipals(emptied, [USER1])).toEqual([]);

    const after = await applyFrozenInput(addInput);

    // Then: IAM が受理した文書にプレースホルダは無く、Rolust 専用 Statement だけが残る
    expect(statementBySid(after, "RolustPlaceholder")).toBeUndefined();
    expect(after.Statement).toHaveLength(1);
    expect(statementBySid(after, "RolustManagedPrincipals")).toBeDefined();
    expect(principalArns(after)).toEqual([USER1]);
  }, 120_000);

  it("FR-5.2 シナリオ 3: 凍結入力に無いユーザは反映されない（クロスアカウントのロール）", async () => {
    const after = await applyFrozenInput({
      roleArn: ROLE_C,
      addUserArns: [USER2],
      removeUserArns: [],
    });

    expect(principalArns(after)).toContain(USER2);
    // 凍結後にマトリクスでチェックされた想定の USER3 は含まれない
    expect(principalArns(after)).not.toContain(USER3);
    // 管理外（凍結入力に無い）USER1 は保全される
    expect(principalArns(after)).toContain(USER1);
  }, 120_000);

  it("FR-4.1: 差分算出の結果が実際の反映結果と一致する", async () => {
    const current = await readTrustPolicy(ROLE_A);
    const input: FrozenInput = {
      roleArn: ROLE_A,
      addUserArns: [USER3],
      removeUserArns: [USER2],
    };

    const diff = computeTrustPolicyDiff(current, input);
    expect(diff.added).toEqual([USER3]);
    expect(diff.removed).toEqual([USER2]);

    const after = await applyFrozenInput(input);
    expect(principalArns(after)).toContain(USER3);
    expect(principalArns(after)).not.toContain(USER2);
  }, 120_000);

  it("probe: IAM は Statement 0 件の信頼ポリシーを拒否する（規則 5 の前提）", async () => {
    // 規則 5 が防いでいる状態そのものを、ガードを迂回して実 AWS へ送る。
    // これが成功してしまうなら規則 5 は不要であり、失敗するなら必要である。
    const attempt = withProfile(DEPLOY_PROFILE, () =>
      client.updateTrustPolicy(ROLE_A, { Version: "2012-10-17", Statement: [] }),
    );

    await expect(attempt).rejects.toBeInstanceOf(IamOperationError);
    const error = await captureError(attempt);
    console.info(
      `[probe] 空の Statement: kind=${error.kind} errorCode=${error.errorCode} message=${error.message}`,
    );
  }, 120_000);

  it("probe: 実在しない IAM ユーザを含む凍結入力は、静かに成功せず失敗として返る", async () => {
    // C-4 / FR-5.7 により Rolust は登録時に実在検証をしない。実在しないユーザを含む
    // 申請が反映まで到達したとき、IAM がどう振る舞うかを実データで確認する。
    const ghost = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/rolust-ghost-does-not-exist`;

    const attempt = applyFrozenInput({
      roleArn: ROLE_A,
      addUserArns: [ghost],
      removeUserArns: [],
    });

    // 握り潰して成功扱いにすることだけは許されない（phases/construction.md § Error Handling）
    await expect(attempt).rejects.toBeInstanceOf(IamOperationError);
    const error = await captureError(attempt);
    console.info(
      `[probe] 実在しない principal: kind=${error.kind} errorCode=${error.errorCode} message=${error.message}`,
    );
    expect(error.roleArn).toBe(ROLE_A);
  }, 120_000);

  it("Issue #208: 実在しない principal を書いたときの IAM の拒否を、「IAM ユーザが存在しない」と分かる文言に分類する", async () => {
    // 実測（2026-11-02）: IAM は、実在しないユーザ（パスの有無・別アカウントを問わず）も実在しないロールも、
    // 例外名 `MalformedPolicyDocumentException`・原文 `Invalid principal in policy: "AWS":"<ARN>"` で拒否する。
    // 複数の不在を書いても、返るのは配列の先頭の 1 件だけ。ユニットテストのフィクスチャはこの原文である。
    // 拒否されるはずの呼び出しだが、受理されたら失敗にする（afterAll が実行前へ戻す）。
    const ghostUser = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/rolust-ghost-does-not-exist`;
    const pathed = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/team/rolust-ghost-pathed`;
    const otherAccount = `arn:aws:iam::${TARGET1_ACCOUNT}:user/rolust-ghost-other-account`;
    const ghostRole = `arn:aws:iam::${DEPLOY_ACCOUNT}:role/rolust-ghost-role`;
    const firstOfTwo = `arn:aws:iam::${DEPLOY_ACCOUNT}:user/rolust-ghost-b`;
    const arrayOf = (sid: string, arns: string[]): TrustPolicyDocument => ({
      Version: "2012-10-17",
      Statement: [{ Sid: sid, Effect: "Allow", Principal: { AWS: arns }, Action: "sts:AssumeRole" }],
    });
    const cases: { label: string; document: TrustPolicyDocument; userArn: string | null; raw: string }[] = [
      { label: "実在しないユーザ（パスなし）", document: trustedBy("Ghost", ghostUser), userArn: ghostUser, raw: ghostUser },
      { label: "実在しないユーザ（パスあり）", document: trustedBy("Ghost", pathed), userArn: pathed, raw: pathed },
      { label: "別アカウントの実在しないユーザ", document: trustedBy("Ghost", otherAccount), userArn: otherAccount, raw: otherAccount },
      { label: "実在しないロール（ユーザとは言わない）", document: trustedBy("Ghost", ghostRole), userArn: null, raw: ghostRole },
      { label: "実在するユーザと実在しないユーザの配列", document: arrayOf("Mixed", [USER1, ghostUser]), userArn: ghostUser, raw: ghostUser },
      {
        label: "実在しないユーザ 2 件（先頭の 1 件だけが返る）",
        document: arrayOf("Two", [firstOfTwo, `arn:aws:iam::${DEPLOY_ACCOUNT}:user/rolust-ghost-a`]),
        userArn: firstOfTwo,
        raw: firstOfTwo,
      },
    ];

    for (const { label, document, userArn, raw } of cases) {
      const attempt = withProfile(DEPLOY_PROFILE, () => client.updateTrustPolicy(ROLE_A, document));
      const error = await captureError(attempt);
      const detail = `Invalid principal in policy: "AWS":"${raw}"`;

      expect(error.kind, label).toBe("invalid-policy");
      expect(error.errorCode, label).toBe("MalformedPolicyDocumentException");
      expect(error.localized, label).toEqual(
        userArn === null
          ? { id: "iam.awsMessage", params: { operation: "iam:UpdateAssumeRolePolicy", detail } }
          : { id: "iam.invalidPrincipalUser", params: { userArn, detail } },
      );
      // AWS の原文は、どちらの文言にも残る（GI-6 / M-3.3）。
      expect(error.message, label).toContain(detail);
    }
  }, 180_000);

  it("Issue #80: 実 IAM が返す信頼ポリシーから、取り込む IAM ユーザ（Allow のパスなしのユーザ）だけを抽出できる", async () => {
    // 前提は、このシナリオ自身が書き込む（ほかのシナリオが変えた内容に依存しない）。afterAll が実行前の内容へ戻す。
    // USER1〜USER3 は実在する IAM ユーザ（実在しない principal は IAM が拒否する。上の probe を参照）。
    const mixed: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        { Sid: "AllowedUsers", Effect: "Allow", Principal: { AWS: [USER2, USER1] }, Action: "sts:AssumeRole" },
        { Sid: "AllowedService", Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" },
        { Sid: "DeniedUser", Effect: "Deny", Principal: { AWS: USER3 }, Action: "sts:AssumeRole" },
      ],
    };
    await withProfile(DEPLOY_PROFILE, () => client.updateTrustPolicy(ROLE_A, mixed));

    // CRUD 系統がロールの登録時に使う、読み取りだけのクライアントで読む（`role-register-service.ts` が、`readImportPlans` 経由で使う。
    // Issue #135 で、紐づけ時から登録時に移した。読み取りの経路は同じ）。
    const read = await withProfile(DEPLOY_PROFILE, () =>
      createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_A),
    );

    // IAM が返す形（配列の順序・文字列か配列か）に依らず、Allow の IAM ユーザだけが、昇順で得られる。
    expect(importableUserArns(read)).toEqual([USER1, USER2].sort());
    // 取り込まない principal（サービス・Deny のユーザ）は、管理外として警告される側に残る。
    expect(principalArns(read)).toEqual(expect.arrayContaining([USER1, USER2, USER3, "ec2.amazonaws.com"]));
    expect(
      findUnmanagedPrincipals(read, importableUserArns(read))
        .map((entry) => entry.value)
        .sort(),
    ).toEqual([USER3, "ec2.amazonaws.com"].sort());
  }, 120_000);

  it("Issue #170: 外から書き換えられた信頼ポリシーに対して、足りない・余分・管理外を正しく分ける（FR-4.9）", async () => {
    // 外から書き換えられた状態を、このシナリオ自身が作る。afterAll が実行前の内容へ戻す。
    // USER1（Rolust の記録では「引き受けられない」）が許可されていて、USER2（記録では「引き受けられる」）は居ない。
    // USER3 は Deny だけに挙がり（許可されていない）、サービスの principal が増えている。
    const tampered: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        { Sid: "Statement1", Effect: "Allow", Principal: { AWS: USER1 }, Action: "sts:AssumeRole" },
        { Sid: "ExternalService", Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" },
        { Sid: "DeniedUser", Effect: "Deny", Principal: { AWS: USER3 }, Action: "sts:AssumeRole" },
      ],
    };
    await withProfile(DEPLOY_PROFILE, () => client.updateTrustPolicy(ROLE_A, tampered));

    // 乖離の確認（`GET /api/drift`。Diff 系統）が使う、読み取りだけのクライアントで読む。
    const read = await withProfile(DEPLOY_PROFILE, () =>
      createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_A),
    );

    // 実 IAM が返す形（単一の principal は文字列。配列の順序は非決定）でも、乖離が正しく出る。
    const drift = computeTrustDrift(read, ROLE_A, [USER1, USER2, USER3], [USER2, USER3]);
    expect(drift.missing).toEqual([USER2, USER3].sort()); // USER3 は Deny だけなので許可されていない
    expect(drift.extra).toEqual([USER1]);
    expect(drift.unmanaged.map((entry) => entry.value)).toEqual(["ec2.amazonaws.com"]);

    // 一致する状態: 記録が USER1 だけを「引き受けられる」とすれば、乖離は空（管理外のサービスは残る）。
    const matched = computeTrustDrift(read, ROLE_A, [USER1, USER2, USER3], [USER1]);
    expect(matched.missing).toEqual([]);
    expect(matched.extra).toEqual([]);
  }, 120_000);
});
