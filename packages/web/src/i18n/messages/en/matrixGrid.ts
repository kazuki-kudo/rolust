import type { Messages } from "../ja.js";

export const matrixGrid: Messages["matrixGrid"] = {
  caption:
    "A table of assignments: rows are IAM users and columns are IAM roles. Use the arrow keys to move between cells and Space to toggle a checkbox.",
  corner: "IAM user \\ IAM role",
  openColumn: (name) => `Expand the ${name} column`,
  foldColumn: (name) => `Collapse the ${name} column`,
  sortAndFilter: (name) => `Sort and filter ${name}`,
  noMatch: "No IAM users match the conditions.",
  assignAriaLabel: (userName, roleName) => `Assign ${roleName} to ${userName}`,
  added: "Add",
  removed: "Remove",
  hideDisabledReason: "A column included in the request cannot be hidden",
  lockedChipAriaLabel: (roleName, failed) =>
    `${roleName}: cannot be requested because there is 1 ${failed ? "failed" : "draft"} request`,
  noChange: "No changes",
  includeAriaLabel: (roleName) => `Include ${roleName} in the request`,
  includeLabel: (changes) => `Include in request (${changes} ${changes === 1 ? "change" : "changes"})`,

  filterLabel: {
    checked: "Checked",
    unchecked: "Unchecked",
    changed: "Has unapplied changes",
  },
  badge: {
    sortCheckedFirst: "↑ Checked first",
    sortUncheckedFirst: "↑ Unchecked first",
    sortAsc: "↑ Ascending",
    sortDesc: "↓ Descending",
    filter: (label) => `Filter: ${label}`,
    unset: "(unset)",
    separator: " / ",
  },

  menu: {
    groupSort: "Sort",
    groupFilter: "Filter",
    groupColumn: "Column",
    checkedFirst: "Checked first",
    uncheckedFirst: "Unchecked first",
    clearSort: "Clear sort",
    filterAll: "All",
    hideColumn: "Hide this column",
    ascending: "Ascending",
    descending: "Descending",
    valueCount: (value, count) => `${value} (${count})`,
    unsetCount: (count) => `(unset) (${count})`,
    openColumn: "Expand this column",
    foldColumn: "Collapse this column",
  },
};
