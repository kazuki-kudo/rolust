import type { Messages } from "../ja.js";

const labels = { view: "view", edit: "edit", apply: "apply" };

export const permission: Messages["permission"] = {
  labels,
  required: (need) => `This action requires the "${labels[need]}" permission`,
  noPermissionHeader: "You have no permission for any operation",
  noPermissionBody:
    "This account has none of the view, edit, or apply permissions. Ask an administrator to grant a permission.",
};
