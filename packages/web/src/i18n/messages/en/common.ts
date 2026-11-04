import type { Messages } from "../ja.js";

export const common: Messages["common"] = {
  guardedModal: {
    warningAriaLabel: "Warning",
    discardHeader: "Discard your input?",
    defaultConfirmText: "If you close this dialog, the input you entered will be lost without being saved.",
    backToEdit: "Back to editing",
    discard: "Discard",
  },
  skipToActions: "Skip the matrix and go to the request actions",
  requestLink: {
    idLabel: "Request ID: ",
    copyUrl: "Copy URL",
    copied: "URL copied",
    copyFailed: "Could not copy. Select the URL by hand.",
  },
};
