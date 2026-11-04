import type { Messages } from "../ja.js";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export const diff: Messages["diff"] = {
  title: "Review and apply",
  backToMatrix: "← Back to Role assignments",
  counts: (count, createdAt) => `${count} ${plural(count, "request", "requests")} / created ${createdAt}`,
  countsLoading: (loaded, total) => `Loading ${loaded} / ${total} ${plural(total, "request", "requests")}`,
  errorAriaLabel: "Error",
  warningAriaLabel: "Warning",

  applying: "Applying",
  applySelected: (count) => `Apply ${count} selected ${plural(count, "request", "requests")}`,
  summary: (total, applied) => `Applied ${applied} of ${total} ${plural(total, "request", "requests")}.`,
  applyErrorHeader: "Could not run the apply",
  applyErrorBody: (message) =>
    `${message} (Check the request history to see which IAM roles were applied.)`,

  missingHeader: (count) => `${count} ${plural(count, "request was", "requests were")} not found`,
  empty: {
    header: "No requests are waiting to be applied",
    body: "All the requests this URL points to have been applied or discarded.",
    toMatrix: "Go to Role assignments",
  },

  loadingPolicy: "Loading the current trust policy",
  cardLoadErrorHeader: (id) => `Could not load request ${id}`,
  reloadAll: (count) => `Could not load ${count} ${plural(count, "request", "requests")} — retry all`,

  panel: {
    sectionAria: (roleName) => `Diff for ${roleName}`,
    include: "Include in apply",
    includeAria: (roleName) => `Include ${roleName} in the apply`,
    applying: "Applying",
    readErrorHeader: "Could not read the current trust policy",
    addedHeading: "Principals to add",
    addedMarker: "Add",
    removedHeading: "Principals to remove",
    removedMarker: "Remove",
    none: "(none)",
    placeholderRemoved:
      "The placeholder that means no one can assume the role (RolustPlaceholder) will be removed.",
    placeholderInjected:
      "No Rolust-managed principals will remain, so the placeholder (RolustPlaceholder) will be inserted. After applying, no one will be able to assume this IAM role.",
    noop: (total, present, absent) =>
      `${total} ${plural(total, "item", "items")} would not change if applied (${present} to add already present / ${absent} to remove already absent).`,
    unmanagedDetail: (kind, deny) => `(${kind}${deny ? " / Deny" : ""})`,
    unmanagedHeader: (count) =>
      `There ${plural(count, "is", "are")} ${count} ${plural(count, "principal", "principals")} not managed by Rolust. Applying will not remove ${plural(count, "it", "them")}.`,
  },

  result: {
    counts: (added, removed) => `${added} added / ${removed} removed`,
    failedHeader: "Apply failed",
    retry: "Re-apply this request",
  },
};
