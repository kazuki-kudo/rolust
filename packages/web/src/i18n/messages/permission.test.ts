import { PERMISSION_LABELS } from "@rolust/core";
import { describe, expect, it } from "vitest";

import { en } from "./en.js";
import { ja } from "./ja.js";

describe("権限の名前のカタログ（Issue #94）", () => {
  it("ja.permission.labels は @rolust/core の PERMISSION_LABELS と同じ語（二重の定義がずれない）", () => {
    expect(ja.permission.labels).toEqual(PERMISSION_LABELS);
  });

  it("権限の不足を示す文は、need ごとに権限の名前を差し込む", () => {
    expect(ja.permission.required("view")).toBe("この操作には「参照」の権限が必要です");
    expect(en.permission.required("view")).toBe('This action requires the "view" permission');
  });
});
