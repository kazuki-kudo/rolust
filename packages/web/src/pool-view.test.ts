import type { IamUser } from "@rolust/core";
import { describe, expect, it } from "vitest";

import { filterUsers, groupByAccount, sortUsers } from "./pool-view.js";

function user(accountId: string, userName: string, attributes: Record<string, string> = {}): IamUser {
  return {
    poolId: "pool",
    accountId,
    userName,
    arn: `arn:aws:iam::${accountId}:user/${userName}`,
    createdAt: "2026-07-30T00:00:00.000Z",
    attributes,
  };
}

const A1 = "111122223333";
const A2 = "444455556666";

const ayaka = user(A1, "ayaka.mori", { name: "森 彩花", role: "管理者" });
const kenji = user(A1, "kenji.sato", { name: "佐藤 健二", role: "開発" });
const dana = user(A2, "dana.okafor", { role: "開発" });
const ryo = user(A2, "ryo.abe", { name: "阿部 涼", role: "開発" });
const USERS = [kenji, ryo, dana, ayaka];

const names = (users: IamUser[]): string[] => users.map((u) => u.userName);

describe("filterUsers（Issue #104）", () => {
  it("空・空白だけなら全員を返す", () => {
    expect(filterUsers(USERS, "", ["name", "role"])).toEqual(USERS);
    expect(filterUsers(USERS, "   ", ["name", "role"])).toEqual(USERS);
  });

  it("ユーザ名に部分一致し、大文字小文字を無視する", () => {
    expect(names(filterUsers(USERS, "SATO", []))).toEqual(["kenji.sato"]);
  });

  it("AWSアカウントID に部分一致する", () => {
    expect(names(filterUsers(USERS, "4444", []))).toEqual(["ryo.abe", "dana.okafor"]);
  });

  it("属性値に部分一致する", () => {
    expect(names(filterUsers(USERS, "開発", ["name", "role"]))).toEqual(["kenji.sato", "ryo.abe", "dana.okafor"]);
  });

  it("現在の属性の項目に無い列の値（削除済みの列の残り）には一致しない", () => {
    expect(filterUsers(USERS, "管理者", ["name"])).toEqual([]);
  });

  it("入力全体を 1 語として扱い、前後の空白を除く（語の AND にしない）", () => {
    expect(names(filterUsers(USERS, " 森 彩花 ", ["name"]))).toEqual(["ayaka.mori"]);
    expect(filterUsers(USERS, "mori sato", ["name"])).toEqual([]);
  });

  it("一致しなければ空配列", () => {
    expect(filterUsers(USERS, "tanaka", ["name", "role"])).toEqual([]);
  });
});

describe("sortUsers（Issue #104）", () => {
  it("ソートなしはAWSアカウントID、ユーザ名の昇順", () => {
    expect(names(sortUsers(USERS, null))).toEqual(["ayaka.mori", "kenji.sato", "dana.okafor", "ryo.abe"]);
  });

  it("入力の配列を書き換えない", () => {
    const copy = [...USERS];
    sortUsers(USERS, { columnId: "userName", descending: true });
    expect(USERS).toEqual(copy);
  });

  it("AWSアカウントID の降順は、同じアカウントの中をユーザ名の昇順に保つ", () => {
    expect(names(sortUsers(USERS, { columnId: "accountId", descending: true }))).toEqual([
      "dana.okafor",
      "ryo.abe",
      "ayaka.mori",
      "kenji.sato",
    ]);
  });

  it("ユーザ名の昇順・降順（アカウントをまたぐ）", () => {
    expect(names(sortUsers(USERS, { columnId: "userName", descending: false }))).toEqual([
      "ayaka.mori",
      "dana.okafor",
      "kenji.sato",
      "ryo.abe",
    ]);
    expect(names(sortUsers(USERS, { columnId: "userName", descending: true }))).toEqual([
      "ryo.abe",
      "kenji.sato",
      "dana.okafor",
      "ayaka.mori",
    ]);
  });

  it("属性の項目は日本語の並びで比べる", () => {
    const sorted = sortUsers(USERS, { columnId: "attr-name", descending: false });
    // 阿部 → 佐藤 → 森（値の無い dana は最後）。
    expect(names(sorted)).toEqual(["ryo.abe", "kenji.sato", "ayaka.mori", "dana.okafor"]);
  });

  it("値の無いユーザは、昇順でも降順でも最後に置く", () => {
    const desc = sortUsers(USERS, { columnId: "attr-name", descending: true });
    expect(names(desc)).toEqual(["ayaka.mori", "kenji.sato", "ryo.abe", "dana.okafor"]);
  });

  it("空文字の属性値も「値なし」として最後に置く", () => {
    const blank = user(A1, "blank.user", { name: "" });
    const sorted = sortUsers([blank, ryo], { columnId: "attr-name", descending: false });
    expect(names(sorted)).toEqual(["ryo.abe", "blank.user"]);
  });

  it("属性値が同じユーザは既定の並び（AWSアカウントID、ユーザ名）を保つ", () => {
    // 漢字の照合順には依存しない。「開発」の 3 人が、既定の並びのまま連続することだけを見る。
    const sorted = names(sortUsers(USERS, { columnId: "attr-role", descending: false }));
    const developers = sorted.filter((name) => name !== "ayaka.mori");
    expect(developers).toEqual(["kenji.sato", "dana.okafor", "ryo.abe"]);
    expect(sorted.indexOf("kenji.sato") + 1).toBe(sorted.indexOf("dana.okafor"));
    expect(sorted.indexOf("dana.okafor") + 1).toBe(sorted.indexOf("ryo.abe"));
  });
});

describe("groupByAccount（Issue #104）", () => {
  it("AWSアカウントID ごとに束ね、ユーザ名の昇順にする", () => {
    expect(groupByAccount(USERS, false).map((row) => [row.accountId, names(row.users)])).toEqual([
      [A1, ["ayaka.mori", "kenji.sato"]],
      [A2, ["dana.okafor", "ryo.abe"]],
    ]);
  });

  it("降順はAWSアカウントID の並びだけを逆にし、行の中のユーザ名は昇順のまま", () => {
    expect(groupByAccount(USERS, true).map((row) => [row.accountId, names(row.users)])).toEqual([
      [A2, ["dana.okafor", "ryo.abe"]],
      [A1, ["ayaka.mori", "kenji.sato"]],
    ]);
  });

  it("ユーザが 0 件なら行も 0 件", () => {
    expect(groupByAccount([], false)).toEqual([]);
  });
});
