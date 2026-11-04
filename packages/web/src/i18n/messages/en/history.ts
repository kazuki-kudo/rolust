import type { Messages } from "../ja.js";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export const history: Messages["history"] = {
  title: "Request history",
  counts: (total, draft, failed, applied, discarded) =>
    `${total} ${plural(total, "request", "requests")} / Draft ${draft} · Failed ${failed} · Applied ${applied} · Discarded ${discarded}`,
  countsLoading: "— requests",
  rangeNote: (from) =>
    `Showing requests created on or after ${from} (drafts and failed requests are shown regardless of date)`,
  loading: "Loading request history",
  loadErrorHeader: "Could not load the request history",
  warningAriaLabel: "Warning",

  filter: {
    statusLabel: "Status",
    statusAria: "Filter by status",
    all: "All",
    createdLabel: "Created (date range; does not apply to drafts and failed requests)",
    createdAria: "Filter by created date range",
    appliedLabel: "Applied (date range)",
    appliedAria: "Filter by applied date range",
    rangePlaceholder: "Choose a date range",
    roleLabel: "IAM role",
    roleAria: "Filter by IAM role",
    rolePlaceholder: "IAM role name, AWS account ID, etc.",
    requestIdLabel: "Request ID (prefix match)",
    requestIdAria: "Filter by request ID prefix",
    matchCount: (shown, total) => `Showing ${shown} of ${total} ${plural(total, "request", "requests")}`,
    clearAll: "Clear all",
    invalidRange: "The start date must be on or before the end date.",
  },

  dateRange: {
    applyButtonLabel: "Apply",
    cancelButtonLabel: "Cancel",
    clearButtonLabel: "Clear",
    startDateLabel: "Start date",
    endDateLabel: "End date",
    startMonthLabel: "Start month",
    endMonthLabel: "End month",
    todayAriaLabel: "Today",
    nextMonthAriaLabel: "Next month",
    previousMonthAriaLabel: "Previous month",
    currentMonthAriaLabel: "Current month",
    nextYearAriaLabel: "Next year",
    previousYearAriaLabel: "Previous year",
    errorIconAriaLabel: "Error",
    isoDatePlaceholder: "YYYY-MM-DD",
    slashedDatePlaceholder: "YYYY/MM/DD",
    dateConstraintText: "Enter the date in YYYY/MM/DD format.",
    slashedDateConstraintText: "Enter the date in YYYY/MM/DD format.",
    isoDateConstraintText: "Enter the date in YYYY-MM-DD format.",
    selectedRangeAriaLive: (start, end) => `Selected from ${start} to ${end}`,
  },

  empty: {
    none: "No requests yet",
    noMatch: "No requests match the filters",
    toMatrix: "Go to Role assignments",
    clearFilter: "Clear all filters",
  },

  columns: {
    status: "Status",
    role: "IAM role",
    requestId: "Request ID",
    createdAt: "Created",
    appliedAt: "Applied",
    createdBy: "Created by",
    appliedBy: "Applied by",
    actions: "Actions",
  },

  detail: {
    requestId: "Request ID: ",
    roleArn: "IAM role ARN: ",
    addHeading: "Principals to add",
    removeHeading: "Principals to remove",
    arnList: (heading, count) => `${heading} (${count})`,
    appliedAt: "Applied: ",
    result: "Result: ",
  },

  actions: {
    resume: "Resume",
    reapply: "Re-apply",
    discard: "Discard",
    details: "Details",
  },

  discardModal: {
    header: "Discard this request?",
    cancel: "Cancel",
    confirm: "Discard",
    confirming: "Discarding",
    keptInHistory: 'The request stays in the history with the status "Discarded". It is not deleted.',
    unlockBefore: "After you discard it, you can create a new request for ",
    unlockAfter: ".",
  },

  notices: {
    discarded: "Request discarded.",
    discardedUnlocked: (roleName) =>
      `Request discarded. You can now create a new request for ${roleName}.`,
    discardedLockLeaked: (roleName, lockWarning) =>
      `Request discarded. Note for ${roleName}: ${lockWarning}`,
    discardFailed: (message) => `Could not discard the request: ${message}`,
  },
};
