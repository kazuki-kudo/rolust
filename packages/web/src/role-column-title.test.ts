import { describe, expect, it } from "vitest";

import { roleColumnTitle } from "./role-column-title.js";

describe("roleColumnTitle（Issue #150 の D-11）", () => {
  it("表示名がある列は、正式名を 1 行目に出す", () => {
    expect(
      roleColumnTitle({ roleName: "本番デプロイ", formalRoleName: "RolustManaged-DeployProd", description: null }),
    ).toBe("RolustManaged-DeployProd");
  });

  it("表示名がある列で説明もあれば、2 行目に説明を続ける", () => {
    expect(
      roleColumnTitle({ roleName: "本番デプロイ", formalRoleName: "RolustManaged-DeployProd", description: "本番用" }),
    ).toBe("RolustManaged-DeployProd\n本番用");
  });

  it("表示名が無い列は、今までどおり説明だけを出す（説明が無ければ出さない）", () => {
    expect(roleColumnTitle({ roleName: "RolustManaged-Audit", formalRoleName: "RolustManaged-Audit", description: "監査" })).toBe("監査");
    expect(roleColumnTitle({ roleName: "RolustManaged-Audit", formalRoleName: "RolustManaged-Audit", description: null })).toBeUndefined();
  });
});
