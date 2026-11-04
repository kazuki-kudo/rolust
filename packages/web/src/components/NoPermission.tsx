import Alert from "@cloudscape-design/components/alert";

import { useT } from "../i18n/index.js";

/** どのグループにも属さないユーザに出す案内（Issue #141）。API は、参照を含むすべての操作を 403 にする。 */
export function NoPermission(): React.JSX.Element {
  const t = useT();
  return (
    <div data-testid="no-permission">
      <Alert type="warning" header={t.permission.noPermissionHeader}>
        {t.permission.noPermissionBody}
      </Alert>
    </div>
  );
}
