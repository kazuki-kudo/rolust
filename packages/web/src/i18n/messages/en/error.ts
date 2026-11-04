import type { Messages } from "../ja.js";

export const error: Messages["error"] = {
  network: (detail) => `Could not connect to the server: ${detail}`,
  requestFailed: (status) => `The API call failed (HTTP ${status})`,
  server: "An internal server error occurred",
  codeLabel: "Error code",
  retryHint: " (try again after a while)",
  retry: "Retry",
  statusIconAriaLabel: "Error",
  screenLoadHeader: "Could not load the screen",
  screenLoadBody: "A new version may have been released, or the connection may have been interrupted. Reload the page.",
  reload: "Reload",
};
