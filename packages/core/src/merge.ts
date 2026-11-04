import { normalizeAwsPrincipal, parseRoleArn } from "./arn.js";
import { ValidationError } from "./errors.js";
import { localized } from "./messages/types.js";
import { buildPlaceholderStatement, isPlaceholderStatement } from "./placeholder.js";
import type { PrincipalBlock, TrustPolicyDocument, TrustPolicyStatement } from "./trust-policy.js";
import {
  PRINCIPAL_KINDS,
  cloneTrustPolicy,
  readPrincipalList,
  statementAllowsAction,
} from "./trust-policy.js";
import { allowedAwsPrincipalSet } from "./principals.js";
import type { UnmanagedPrincipal } from "./unmanaged.js";
import { findUnmanagedPrincipals } from "./unmanaged.js";
import type { FrozenInput } from "./types.js";

/**
 * 保全方式マージ（FR-5.1）。Rolust の中核。
 *
 * 「Rolust が管理する principal の記述のみを差し替え、Rolust 管理外の principal・
 * 条件・Statement はそのまま残す」を、次の 6 つの規則で実装する。
 *
 * 1. **管理下の定義は凍結入力**（Q5=A）。凍結入力に名前が挙がっていない principal は
 *    すべて管理外として一切触らない。反映時点の IamUser 集合は参照しない（FR-5.2）。
 * 2. **削除**は `Effect: Allow` の全 Statement から行う。手で他の Statement に
 *    書き加えられていても確実に消す。`Deny` は触らない — Deny から principal を
 *    取り除くことは拒否の解除であり、削除の意図と正反対になる。
 * 3. **追加**は Rolust 専用 Statement（`Sid: RolustManagedPrincipals`）にのみ行う。
 *    既存の Statement に相乗りしないため、Condition つき Statement が
 *    意図せず拡張されることがない（FR-5.1 の受け入れ基準 1 つ目）。同じ Sid が
 *    採用できない形（Condition つき・Deny・`sts:AssumeRole` を許さない）で使われていたら、
 *    Sid を重複させず拒否する — IAM は Sid の一意性を要求する（Issue #194）。
 * 4. **既に存在する principal は追加しない**。Condition つきで許可されている
 *    principal を無条件許可へ格上げしてしまうのを避ける。
 * 5. **Statement が 0 件の文書を作らない**。IAM の信頼ポリシーは「空」を表現できず、
 *    `Statement: []` は `MalformedPolicyDocument` で拒否される。管理下の principal
 *    だけで構成されたロールから最後の 1 件を削除するとこの状態に到達するため、
 *    プレースホルダ Statement（`placeholder.ts`）を注入して構文上の妥当性を保つ。
 *    管理外の Statement が残る場合は注入しない。IAM はその文書を受け付け、ロールは
 *    管理外 principal によって引き受けられる状態のままであるのが正しい。
 * 6. **追加が反映されたらプレースホルダを取り除く**（Issue #16）。プレースホルダは
 *    「管理下の principal が 1 件も無い」ことを表すため、追加が 1 件でもあれば役目を終える。
 *    識別は Sid だけで行い、中身が手で書き換えられていても取り除く。
 */

/** Rolust が追加する principal を収める Statement の Sid。 */
export const ROLUST_STATEMENT_SID = "RolustManagedPrincipals";

const ASSUME_ROLE_ACTION = "sts:AssumeRole";

/**
 * 凍結入力を検証する。
 *
 * 追加と削除に同じ ARN が現れる入力は矛盾しており、どちらを適用しても
 * 監査記録と実際の反映内容が食い違う。マトリクスからは生成されえないが、
 * 保存済みデータの破損を握り潰さないよう境界で fail fast する。
 */
export function assertFrozenInput(input: FrozenInput): void {
  const added = new Set(input.addUserArns.map(normalizeAwsPrincipal));
  for (const arn of input.removeUserArns) {
    if (added.has(normalizeAwsPrincipal(arn))) {
      throw new ValidationError(localized("merge.frozenConflict", { arn }), "frozenInput");
    }
  }
}

export interface MergeResult {
  /** 更新後の信頼ポリシー。入力の文書は変更しない。 */
  document: TrustPolicyDocument;
  /** 実際に追加した principal。 */
  added: string[];
  /** 実際に削除した principal。 */
  removed: string[];
  /** 追加対象だが既に存在したため何もしなかったもの。 */
  alreadyPresent: string[];
  /** 削除対象だが存在しなかったため何もしなかったもの。 */
  alreadyAbsent: string[];
  /**
   * 保全した principal — 更新後の文書のうち凍結入力に現れないものすべて。
   * FR-5.1 の受け入れ基準（管理外 principal が全件残っている）の検証に使う。
   */
  preserved: UnmanagedPrincipal[];
  /** 文書が変化したか。false なら `iam:UpdateAssumeRolePolicy` を呼ぶ必要がない。 */
  changed: boolean;
  /**
   * Statement が 0 件になるのを避けるためプレースホルダを注入したか（規則 5）。
   *
   * 真のとき、当該ロールは「Rolust 管理下の principal が 1 件も残っていない」状態である。
   * 管理者への提示に使う。
   */
  placeholderInjected: boolean;
  /** 追加を反映したためプレースホルダを取り除いたか（規則 6。Issue #16）。 */
  placeholderRemoved: boolean;
}

/**
 * 凍結入力を現在の信頼ポリシーへ保全方式でマージする。
 *
 * @param current AWS から読み取った現在の信頼ポリシー
 * @param input 対象 ChangeRequest の凍結入力（FR-5.2）
 */
export function mergeTrustPolicy(
  current: TrustPolicyDocument,
  input: FrozenInput,
): MergeResult {
  assertFrozenInput(input);

  const document = cloneTrustPolicy(current);
  const removeTargets = new Set(input.removeUserArns.map(normalizeAwsPrincipal));
  const removed = new Set<string>();

  // --- 規則 2: Allow Statement から削除対象を取り除く ---
  const survivingStatements: TrustPolicyStatement[] = [];
  for (const statement of document.Statement) {
    if (statement.Effect !== "Allow" || !isPrincipalBlock(statement.Principal)) {
      survivingStatements.push(statement);
      continue;
    }

    const block = statement.Principal;
    const originalAws = readPrincipalList(block.AWS);
    if (originalAws.length === 0) {
      survivingStatements.push(statement);
      continue;
    }

    const keptAws = originalAws.filter((raw) => {
      const normalized = normalizeAwsPrincipal(raw);
      if (removeTargets.has(normalized)) {
        removed.add(normalized);
        return false;
      }
      return true;
    });

    if (keptAws.length === originalAws.length) {
      survivingStatements.push(statement);
      continue;
    }

    const nextBlock: PrincipalBlock = { ...block };
    if (keptAws.length === 0) {
      delete nextBlock.AWS;
    } else {
      nextBlock.AWS = keptAws;
    }

    if (isEmptyPrincipalBlock(nextBlock)) {
      // Principal が空の Statement は IAM が MalformedPolicyDocument で拒否する。
      // ここに到達するのは、その Statement の principal が「凍結入力で削除を
      // 指示された ARN だけ」だった場合に限られる。すなわち管理外 principal を
      // 巻き添えにすることはない。
      continue;
    }

    survivingStatements.push({ ...statement, Principal: nextBlock });
  }
  document.Statement = survivingStatements;

  // --- 規則 3・4: 追加 ---
  const present = allowedAwsPrincipalSet(document);
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const arn of dedupe(input.addUserArns)) {
    if (present.has(arn)) {
      alreadyPresent.push(arn);
    } else {
      added.push(arn);
      present.add(arn);
    }
  }

  // --- 規則 6: 追加が反映されるならプレースホルダは役目を終える ---
  let placeholderRemoved = false;
  if (added.length > 0) {
    const withoutPlaceholder = document.Statement.filter(
      (statement) => !isPlaceholderStatement(statement),
    );
    placeholderRemoved = withoutPlaceholder.length < document.Statement.length;
    document.Statement = withoutPlaceholder;

    const target = findOrCreateRolustStatement(document);
    const existing = readPrincipalList(target.Principal.AWS);
    target.Principal.AWS = [...existing, ...added];
  }

  const alreadyAbsent = dedupe(input.removeUserArns).filter((arn) => !removed.has(arn));

  // --- 規則 5: 空文書の禁止 ---
  // Statement が 0 件になるのは「管理下の principal だけで構成されたロールから
  // 最後の 1 件を削除した」場合である。IAM はこの文書を受け付けないため、
  // ここで気づかずに `UpdateAssumeRolePolicy` を呼ぶと MalformedPolicyDocument になる。
  let placeholderInjected = false;
  if (document.Statement.length === 0) {
    const { accountId } = parseRoleArn(input.roleArn);
    document.Statement.push(buildPlaceholderStatement(accountId));
    placeholderInjected = true;
  }

  // --- 保全の証跡 ---
  // 基準集合は凍結入力（Q5=A）。unmanaged.ts の呼び出し 2 経路のうち、こちらが反映側。
  // プレースホルダは Rolust 自身の Statement なので、unmanaged.ts が保全の証跡から除く。
  const frozenArns = [...input.addUserArns, ...input.removeUserArns];
  const preserved = findUnmanagedPrincipals(document, frozenArns);

  return {
    document,
    added,
    removed: [...removed],
    alreadyPresent,
    alreadyAbsent,
    preserved,
    changed: added.length > 0 || removed.size > 0,
    placeholderInjected,
    placeholderRemoved,
  };
}

interface RolustStatement extends TrustPolicyStatement {
  Principal: PrincipalBlock;
}

/**
 * Rolust 専用 Statement を探すか、なければ作って末尾へ追加する。
 *
 * 既存の Statement を Sid で「乗っ取る」ことはしない。Sid が一致し、かつ
 * Condition を持たず Allow で `sts:AssumeRole` を許す Statement のみを採る。
 *
 * **採用できない形で Sid が使われていたら、2 つ目を作らず拒否する**（Issue #194）。
 * IAM はポリシー内の Sid の一意性を要求するので、重複した文書は
 * `MalformedPolicyDocument` で拒否され、そのロールは人が信頼ポリシーを直すまで
 * 反映できなくなる。しかも原因は AWS のエラー文からは読み取れない。ここで
 * 気づけば、反映は「失敗」に読める理由を残し、差分確認は反映を指示する前に
 * 同じ理由を示す（`diff.ts` が同じマージを通るため）。
 */
function findOrCreateRolustStatement(document: TrustPolicyDocument): RolustStatement {
  for (let index = 0; index < document.Statement.length; index += 1) {
    const statement = document.Statement[index] as TrustPolicyStatement;
    if (statement.Sid !== ROLUST_STATEMENT_SID) continue;
    if (
      statement.Effect === "Allow" &&
      statement.Condition === undefined &&
      statement.NotPrincipal === undefined &&
      statementAllowsAction(statement, ASSUME_ROLE_ACTION)
    ) {
      const block = isPrincipalBlock(statement.Principal) ? statement.Principal : {};
      const normalized: RolustStatement = { ...statement, Principal: { ...block } };
      document.Statement[index] = normalized;
      return normalized;
    }
    throw new ValidationError(
      localized("merge.sidConflict", { sid: ROLUST_STATEMENT_SID }),
      "trustPolicy",
    );
  }

  const created: RolustStatement = {
    Sid: ROLUST_STATEMENT_SID,
    Effect: "Allow",
    Principal: { AWS: [] },
    Action: ASSUME_ROLE_ACTION,
  };
  document.Statement.push(created);
  return created;
}

function isPrincipalBlock(value: unknown): value is PrincipalBlock {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyPrincipalBlock(block: PrincipalBlock): boolean {
  return PRINCIPAL_KINDS.every((kind) => readPrincipalList(block[kind]).length === 0);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(normalizeAwsPrincipal))];
}
