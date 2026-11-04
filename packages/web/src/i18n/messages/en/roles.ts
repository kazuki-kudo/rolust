import type { Messages } from "../ja.js";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export const roles: Messages["roles"] = {
  title: "IAM roles",
  counts: (roles, accounts) => `IAM roles ${roles} / AWS accounts ${accounts}`,
  countsLoading: "IAM roles — / AWS accounts —",
  editOrder: "Edit order",
  register: "Register new role",
  loading: "Loading IAM roles",
  loadErrorHeader: "Could not load the IAM roles",
  errorAriaLabel: "Error",
  warningAriaLabel: "Warning",
  cancel: "Cancel",
  close: "Close",
  save: "Save",
  saving: "Saving",
  edit: "Edit",
  unregister: "Unregister",

  orderBar: {
    title: "Editing order",
    changes: (count) => `${count} ${plural(count, "change", "changes")}`,
    save: (count) => `Save (${count} ${plural(count, "change", "changes")})`,
  },
  moved: (roleName, position) => `Moved ${roleName} to position ${position}`,
  moveUpAria: (roleName) => `Move ${roleName} up`,
  moveDownAria: (roleName) => `Move ${roleName} down`,

  discard: {
    header: "Discard your input?",
    back: "Back to editing",
    body: (count) =>
      `You have ${count} unsaved ${plural(count, "change", "changes")}. This cannot be undone once discarded.`,
    navigateReason: "You tried to go to another screen.",
    navigateConfirm: "Discard and leave",
    confirm: "Discard",
  },

  empty: {
    header: "No IAM roles are registered yet",
    body: "Role assignments cannot have columns while there are 0 IAM roles. Register an IAM role first.",
    register: "Register new role",
    toMatrix: "Go to Role assignments",
  },

  columns: {
    order: "Order",
    accountId: "AWS account",
    roleName: "IAM role name",
    displayName: "Display name",
    unreflected: "Unapplied request",
    drift: "Trust policy",
    description: "Description",
    color: "Background color",
    move: "Move",
    actions: "Actions",
  },
  editDescriptionAria: (roleName) => `Edit the display name and description of ${roleName}`,
  editColorAria: (roleName) => `Edit the background color of ${roleName}`,
  unregisterAria: (roleName) => `Unregister ${roleName}`,

  notices: {
    orderSaved: (count) => `Saved the order of IAM roles (${count} ${plural(count, "change", "changes")})`,
    descriptionSaved: (roleName) => `Saved the display name and description of ${roleName}`,
    colorSaved: (roleName) => `Saved the background color of ${roleName}`,
    unregistered: (roleName) => `Unregistered IAM role ${roleName}`,
    registered: (arn, userCount, registeredCount, skippedCount) => {
      const base =
        userCount === 0
          ? `IAM role ${arn} registered.`
          : `IAM role ${arn} registered (imported ${userCount} IAM ${plural(userCount, "user", "users")} from its trust policy; ${registeredCount} new)`;
      if (skippedCount === 0) return base;
      const tail =
        `${skippedCount} IAM ${plural(skippedCount, "user", "users")} in ${plural(skippedCount, "an account", "accounts")} not on the allow list ` +
        `${plural(skippedCount, "was", "were")} not imported (${plural(skippedCount, "it remains", "they remain")} in the trust policy).`;
      return `${base.endsWith(".") ? base : `${base}.`} ${tail}`;
    },
  },

  create: {
    header: "Register new IAM role",
    submit: "Register",
    submitting: "Registering",
    accountIdLabel: "AWS account ID",
    accountIdDescription:
      "You can also register roles in accounts other than the deployment target. For preparing the target account, see docs/guide/cross-account.md.",
    accountIdRequired: "AWS account ID is required",
    accountIdFormat: "AWS account ID must be 12 digits",
    roleNameLabel: "IAM role name",
    roleNameRequired: "IAM role name is required",
    roleNameInvalid: (name) => `IAM role name contains characters that are not allowed: ${name}`,
    tagUnknown: "Whether the role exists in AWS is checked when you register it.",
    tagRequirement: (key, value) =>
      `The target IAM role needs the tag ${key} = ${value} (the value must match exactly). If the role has no such tag, ` +
      `add it with aws iam tag-role --role-name <name> --tags Key=${key},Value=${value} ` +
      `and then register it.`,
    arnPreviewLabel: "Derived ARN",
    linkNote:
      "Once registered, the role becomes the last column of the role assignments, and the IAM users (without a path) in its trust policy are imported as applied assignments.",
    displayNameLabel: "Role display name",
    optionalMax: (max) => `Optional. Up to ${max} characters.`,
    descriptionLabel: "Description",
  },

  editDescription: {
    header: "Edit display name and description",
    roleNameLabel: "IAM role name",
    displayNameLabel: "Role display name",
    displayNameDescription: (max) =>
      `Optional. Up to ${max} characters. Used as the column name in Role assignments. The IAM role name does not change.`,
    descriptionLabel: "Description",
    optionalMax: (max) => `Optional. Up to ${max} characters.`,
  },

  editColor: {
    header: "Edit background color",
    roleNameLabel: "IAM role name",
    label: "Background color",
    description:
      "The color applied to this IAM role's column in the matrix. The color is decoration only; IAM roles are identified by IAM role name.",
    none: "None",
    names: {
      red: "Red",
      orange: "Orange",
      yellow: "Yellow",
      green: "Green",
      teal: "Teal",
      blue: "Blue",
      purple: "Purple",
      pink: "Pink",
    },
  },

  delete: {
    blockedHeader: "Cannot unregister the IAM role",
    header: "Unregister the IAM role?",
    unregistering: "Unregistering",
    confirmWithAssignments: "Unregister with its assignments",
    blockedBody: "cannot be unregistered. Only IAM roles with no unapplied request can be unregistered.",
    unreflectedRequest: (statusLabel) =>
      `There is an unapplied request (${statusLabel}). Apply or discard it in the request history.`,
    openHistory: "Open in request history",
    assignmentsRemain: (total, pending) =>
      `${total} ${plural(total, "assignment remains", "assignments remain")} (including ${pending} unapplied ${plural(pending, "change", "changes")}). ` +
      `Unregistering also removes all assignments of this IAM role.`,
    introBeforeArn: " (",
    introAfterArn: ") will be unregistered.",
    notTouched:
      "The IAM role and its trust policy in AWS are not touched. IAM users that Rolust applied remain in the trust policy. " +
      "To remove them from the trust policy, uncheck them in Role assignments and request and apply the change before unregistering.",
    historyKept: "Existing requests remain in the request history. You can register the role again with the same ARN.",
  },

  drift: {
    check: "Check trust policies",
    caption:
      '"Check trust policies" reads the trust policies on AWS and compares them with Rolust\'s records (reflected assignments). ' +
      "It never modifies AWS. If they differ, you can choose how to fix it from the details.",
    /** 説明を開く「i」ボタンの読み上げ名（Issue #232）。 */
    helpAria: "About Check trust policies",
    checking: "Checking",
    cellChecking: "Checking…",
    match: "✓ Matches",
    mismatch: (count) => `! ${count} ${plural(count, "difference", "differences")}`,
    readFailed: "✗ Could not read",
    detail: "Details",
    detailAria: (roleName) => `Details of the trust policy check for ${roleName}`,
    dismiss: "Close",
    successAriaLabel: "Success",
    infoAriaLabel: "Information",
    errorHeader: "Could not check the trust policies",
    summary: {
      empty: "There are no roles to check",
      allMatch: (count, time) =>
        `All ${count} ${plural(count, "role matches", "roles match")} (as of ${time}). This disappears when you reload.`,
      allFailed: (count, time) =>
        `Could not read the trust policy of any of the ${count} ${plural(count, "role", "roles")} (as of ${time}). This disappears when you reload.`,
      issues: (total, drifted, failed, time) =>
        `${drifted} of ${total} ${plural(total, "role differs", "roles differ")} from Rolust's records` +
        (failed > 0 ? ` (${failed} could not be read)` : "") +
        ` (as of ${time}). This disappears when you reload.`,
    },
    modal: {
      header: (roleName) => `Trust policy differences for ${roleName}`,
      close: "Close",
      missingHeading: "Recorded by Rolust as able to assume the role, but missing from IAM",
      extraHeading: "Not in Rolust's records (not yet applied), but present in IAM",
      unmanagedHeading: "For reference: principals Rolust does not manage (not counted as differences)",
      denySuffix: " (Deny)",
      none: "None",
      readErrorHeading: "Could not read the trust policy",
      errorCode: (code) => `Error code: ${code}`,
    },
    needsRecheck: "Recheck needed",
    repair: {
      restore: {
        button: "Make IAM match the records (create request)",
        hint: "Treats Rolust's records as correct and restores the IAM trust policy. Creates a draft request; you instruct the apply from the diff review screen.",
        running: "Creating request",
      },
      adopt: {
        button: "Make the records match IAM",
        hint: "Treats the IAM trust policy as correct and updates Rolust's records. AWS is not modified.",
        running: "Updating records",
      },
      noDrift: 'The differences are gone. Choose "Check trust policies" again.',
      excluded: (status, requestId) =>
        `Cannot run because there is an unapplied request (${status === "failed" ? "failed" : "draft"}${requestId ? `: ${requestId}` : ""}). Apply or discard it in the request history, then try again.`,
      errorHeader: "Could not repair the differences",
      adoptedNotice: (count) =>
        `Updated the records for ${count} ${count === 1 ? "item" : "items"}. AWS was not modified. You can verify with "Check trust policies".`,
      partialHeader: "Some records could not be updated",
      partialBody: "Run it again to fix the rest.",
      confirm: {
        header: (roleName) => `${roleName}: make the records match IAM`,
        body: "Updates Rolust's records to match the current IAM trust policy. The AWS trust policy is not modified.",
        adoptHeading: "Add to the records (present in IAM)",
        dropHeading: "Remove from the records (not in IAM)",
        overwriteWarning: "Unapplied edits (checkbox changes) for these users will be overwritten.",
        confirm: "Update records",
        cancel: "Cancel",
      },
    },
  },
};
