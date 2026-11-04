// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Permission } from "@rolust/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en, ja } from "../i18n/index.js";
import { PermissionProvider } from "../permission.js";
import { PermissionButton, permissionBlock } from "./PermissionButton.js";

afterEach(cleanup);

describe("permissionBlock（Issue #141）", () => {
  it.each([
    ["none", "edit", "この操作には「作成」の権限が必要です"],
    ["view", "edit", "この操作には「作成」の権限が必要です"],
    ["edit", "edit", null],
    ["apply", "edit", null],
    ["none", "apply", "この操作には「反映」の権限が必要です"],
    ["view", "apply", "この操作には「反映」の権限が必要です"],
    ["edit", "apply", "この操作には「反映」の権限が必要です"],
    ["apply", "apply", null],
  ] as const)("have=%s need=%s", (have, need, expected) => {
    expect(permissionBlock(have, need, ja)).toBe(expected);
  });
});

function renderButton(permission: Permission | null, need: "edit" | "apply", extra = {}) {
  const onClick = vi.fn();
  const button = (
    <PermissionButton need={need} data-testid="pb" onClick={onClick} {...extra}>
      実行
    </PermissionButton>
  );
  render(permission === null ? button : <PermissionProvider value={permission}>{button}</PermissionProvider>);
  return { onClick, el: screen.getByTestId("pb").querySelector("button") ?? screen.getByTestId("pb") };
}

describe("PermissionButton", () => {
  it.each([
    ["none", "edit"],
    ["view", "edit"],
    ["none", "apply"],
    ["view", "apply"],
    ["edit", "apply"],
  ] as const)("権限 %s で need=%s は無効。押しても onClick が呼ばれない", (permission, need) => {
    const { onClick, el } = renderButton(permission, need);

    expect(el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ["edit", "edit"],
    ["apply", "edit"],
    ["apply", "apply"],
  ] as const)("権限 %s で need=%s は有効で、押すと onClick が呼ばれる", (permission, need) => {
    const { onClick, el } = renderButton(permission, need);

    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Provider が無いときは有効（既存の画面のテストを変えないための既定）", () => {
    const { onClick, el } = renderButton(null, "apply");

    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("権限があっても、元の disabled が真なら無効", () => {
    const { onClick, el } = renderButton("apply", "edit", { disabled: true });

    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("permissionBlock（英語。Issue #94）", () => {
  it("権限名と理由が英語になる", () => {
    expect(permissionBlock("view", "edit", en)).toBe('This action requires the "edit" permission');
    expect(permissionBlock("edit", "apply", en)).toBe('This action requires the "apply" permission');
    expect(permissionBlock("apply", "apply", en)).toBeNull();
  });
});
