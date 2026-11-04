import type { Messages } from "../ja.js";

export const kind: Messages["kind"] = {
  restore: "Drift repair (make IAM match the records)",
  adopt: "Records adopted (AWS was not modified)",
  restoreNote: "This request makes IAM match the records.",
};
