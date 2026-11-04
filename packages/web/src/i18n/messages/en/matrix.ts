import type { Messages } from "../ja.js";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** 取り消しの完了通知に添える、対象外にしたロール数。0 件なら空。 */
const skippedNote = (skipped: number): string =>
  skipped > 0
    ? ` (${skipped} IAM ${plural(skipped, "role was", "roles were")} excluded because ${plural(skipped, "it has an unapplied request", "they have unapplied requests")})`
    : "";

export const matrix: Messages["matrix"] = {
  title: "Role assignments",
  counts: (users, roles) => `IAM users ${users} / IAM roles ${roles}`,
  countsLoading: "IAM users — / IAM roles —",
  selectionSummary: (selected, excluded, totalChanges) =>
    `${selected} IAM ${plural(selected, "role", "roles")} selected · ${excluded} IAM ${plural(excluded, "role", "roles")} excluded` +
    (totalChanges === 0 ? " · No changes" : ` · ${totalChanges} ${plural(totalChanges, "change", "changes")}`),
  loading: "Loading the matrix",
  loadErrorHeader: "Could not load the role assignments",
  saving: "Saving",
  saved: "Saved",
  revertChanges: "Revert changes",
  createRequests: "Create requests",
  creating: "Creating",
  infoAriaLabel: "Information",
  warningAriaLabel: "Warning",

  // 理由（API の文言）が句点で終わっていても、句点が重ならないようにする。
  saveFailed: (roleName, detail) =>
    `Could not save the assignment (${roleName}): ${detail.replace(/[.。]$/, "")}. Try checking the box again.`,
  roleLine: (roleName, text) => `${roleName} — ${text}`,
  creationFailedHeader: (count) =>
    `Could not create requests for ${count} IAM ${plural(count, "role", "roles")}`,
  noRequestsHeader: "No requests could be created",
  createFailedHeader: "Could not create the requests",

  revertedNotice: (reverted, skipped) =>
    `Reverted ${reverted} ${plural(reverted, "change", "changes")}${skippedNote(skipped)}`,
  nothingToRevertNotice: (skipped) => `There were no changes to revert${skippedNote(skipped)}`,
  revertFailureHeader: (count) => `${count} ${plural(count, "change", "changes")} could not be reverted`,
  revertedCount: (count) => `${count} ${plural(count, "change was", "changes were")} reverted.`,
  revertFailureItem: (roleName, userName, message) => `${roleName} (${userName}) — ${message}`,
  revertRetryHint:
    'Press "Revert changes" again to revert the rest (running it more than once gives the same result).',

  revertModal: {
    header: "Revert the unapplied changes?",
    cancel: "Cancel",
    confirm: "Revert",
    confirming: "Reverting",
    body: (changes, roles) =>
      `${changes} unapplied ${plural(changes, "change", "changes")} (${roles} IAM ${plural(roles, "role", "roles")}) will be reverted to the applied state. This cannot be undone.`,
    noEffect: "This does not affect AWS, and no requests are created.",
    excluded: (roles) =>
      `${roles} IAM ${plural(roles, "role is", "roles are")} excluded because of unapplied requests. To drop those changes, discard the requests in Request history first, then revert.`,
  },

  empty: {
    noUsersHeader: "The matrix cannot be displayed",
    noRolesHeader: "No IAM roles are registered",
    goToRoles: "Go to IAM roles",
    noUsersBody: "No IAM users are registered. Register them on the IAM users screen.",
    noRolesBody: "Once you register an IAM role, it is shown as a column of Role assignments.",
  },

  filterField: {
    ariaLabel: "Filter IAM users",
    placeholder: "Filter by IAM user name, AWS account ID, or attribute",
  },
  viewStatus: (shown, total) => `Showing ${shown} of ${total} ${plural(total, "row", "rows")}`,
  clearAll: "Clear all",

  announce: {
    roleHidden: (name) => `The ${name} column is hidden`,
    roleShown: (name) => `The ${name} column is shown`,
    allShown: "All columns are shown",
  },
  allHidden: {
    message: "All columns are hidden",
    showAll: "Show all",
  },
  legend: {
    add: "Add",
    remove: "Remove",
    separator: "/",
    lockNote:
      'Columns marked "Draft" or "Failed" cannot be requested because they have an unapplied request',
  },

  hiddenColumns: {
    summary: (count, changed) =>
      `${count} hidden ${plural(count, "column", "columns")}${changed > 0 ? ` (${changed} with changes)` : ""}`,
    openListAriaLabel: (summary) => `${summary}. Open the list to show columns`,
    groupAriaLabel: "Hidden columns",
    changed: "(has changes)",
    conditioned: "(has conditions)",
    show: "Show",
    showAll: "Show all",
  },

  exclusionBanner: {
    allExcluded: "No IAM roles can be requested",
    excluded: (count) =>
      `${count} IAM ${plural(count, "role was", "roles were")} excluded from the request`,
    body: "Because unapplied requests remain, new requests cannot be created. Apply or discard the existing requests.",
  },
};
