import type { Messages } from "../ja.js";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export const pool: Messages["pool"] = {
  title: "IAM users",
  counts: (users, accounts, roles) => `IAM users ${users} / AWS accounts ${accounts} / IAM roles ${roles}`,
  countsLoading: "IAM users — / AWS accounts — / IAM roles —",
  addUsers: "Register new user",
  editAttributeColumns: "Edit attribute columns",
  loading: "Loading IAM users",
  loadErrorHeader: "Could not load the IAM users",
  errorAriaLabel: "Error",
  warningAriaLabel: "Warning",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving",

  filter: {
    placeholder: "Filter by AWS account ID, IAM user name, or attribute value",
    ariaLabel: "Filter IAM users",
    countText: (shown, total) => `${shown} ${plural(shown, "match", "matches")} (of ${total})`,
  },
  empty: {
    noMatch: "No IAM users match the filter",
    clear: "Clear filter",
    none: "No IAM users yet",
  },

  columns: {
    accountId: "AWS account",
    userName: "IAM user name",
    actions: "Actions",
  },
  editAttributes: "Edit attributes",
  editAttributesAria: (userName) => `Edit attributes of ${userName}`,
  unregister: "Unregister",
  unregisterAria: (userName) => `Unregister ${userName}`,

  edit: {
    start: "Bulk edit attributes",
    title: "Editing",
    changes: (count) => `${count} ${plural(count, "change", "changes")}`,
    save: (count) => `Save (${count} ${plural(count, "change", "changes")})`,
    cellAria: (userName, columnName) => `${columnName} of ${userName}`,
    rowFailed: (reason) => `Could not save: ${reason}`,
    rowSaved: "Saved",
    retry: (failed) => `Retry the ${failed} ${plural(failed, "user", "users")} that failed`,
    partial: (saved, failed) =>
      `${saved > 0 ? `Saved the attributes of ${saved} ${plural(saved, "user", "users")}. ` : ""}` +
      `Could not save ${failed} ${plural(failed, "user", "users")}. ` +
      `Check the reason shown on each row that was not saved, then retry.`,
  },

  discard: {
    header: "Discard your input?",
    back: "Back to editing",
    body: (count) =>
      `You have ${count} unsaved ${plural(count, "change", "changes")}. This cannot be undone once discarded.`,
    navigateReason: "You tried to go to another screen.",
    navigateConfirm: "Discard and leave",
    confirm: "Discard",
  },

  notices: {
    attributesSaved: (count) => `Saved the attributes of ${count} ${plural(count, "user", "users")}`,
    userAttributesSaved: (userName) => `Saved the attributes of ${userName}`,
    columnsSaved: "Saved the attribute columns",
    unregistered: (userName, removedAssignments) =>
      `Unregistered ${userName} (${removedAssignments} ${plural(removedAssignments, "assignment", "assignments")} removed with it)`,
    registered: (created, skipped) => {
      const base = `${created} IAM ${plural(created, "user", "users")} registered`;
      return skipped > 0 ? `${base} (${skipped} already registered; unchanged)` : base;
    },
  },

  delete: {
    header: "Unregister the IAM user?",
    unregistering: "Unregistering",
    afterArn: " will be unregistered.",
    cascade:
      "All assignments of this IAM user (the checks in Role assignments) are also removed. The IAM user in AWS is not deleted.",
    requestsKept: "The contents of added and removed users recorded in existing requests do not change.",
    blocked:
      "It cannot be unregistered while it has an applied assignment or is included in an unapplied request. " +
      "Even if unregistered, it would remain in the trust policy and no longer be visible in the matrix.",
  },

  register: {
    header: "Register new user",
    submit: "Register",
    submitting: "Registering",
    methodLabel: "Registration method",
    single: "One at a time",
    csv: "CSV",
    accountIdLabel: "AWS account ID",
    accountIdRequired: "AWS account ID is required",
    accountIdFormat: "AWS account ID must be 12 digits",
    userNamesLabel: "IAM user names",
    userNamesDescription:
      "One name per line. Leading and trailing spaces and blank lines are ignored, and duplicates are merged into one.",
    userNamesRequired: "Enter at least one IAM user name",
    userNameInvalid: (name) => `IAM user name contains characters that are not allowed: ${name}`,
    arnPreviewLabel: "Derived ARN (first user)",
    csvRetry: (message) =>
      `${message} (You can resend the same CSV as is. IAM users that are already registered are not changed.)`,
  },

  csv: {
    label: "CSV",
    help: (header, max) =>
      `The header row is already filled in as the first row. A "${header}" column (the IAM user name) is required; the other column names must match the attribute column names of this pool ` +
      `(columns can be in any order, and you can use only some of the attribute columns). ` +
      `Separate columns with commas, up to ${max} rows at a time. ` +
      `IAM users that are already registered are not changed. If any row is invalid, nothing is registered.`,
    /** 説明の下に出す、データ行の例の前置き。 */
    exampleLead: "Add rows from the second row on, like this:",
    exampleValue: (position) => `value${position}`,
    line: (line) => `Line ${line}: `,
    required: "Enter the CSV",
  },

  attributeColumns: {
    header: "Edit attribute columns",
    label: "Attribute columns",
    description: (max) =>
      `Columns that can hold a value for each IAM user. Up to ${max} columns. Column names must be unique within the pool.`,
    nameAria: (position) => `Name of column ${position}`,
    remove: "Remove",
    removeAria: (position, name) => `Remove column ${position} (${name})`,
    add: "Add column",
    removedWarning: (names) =>
      `Removing ${names.map((name) => `"${name}"`).join(", ")} hides the values in ${plural(names.length, "that column", "those columns")}. ` +
      `Even if you recreate ${plural(names.length, "it", "them")} with the same name, the values do not come back.`,
  },

  userAttributes: {
    header: "Edit attributes",
    userLabel: "IAM user",
    valueDescription: (max) => `Leave empty to unset. Up to ${max} characters.`,
  },
};
