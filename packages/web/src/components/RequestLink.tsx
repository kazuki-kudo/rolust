import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";

import { useT } from "../i18n/index.js";
import { requestUrl } from "../routes.js";

/**
 * 申請の ID と、反映者へ渡す URL のコピー（Issue #141）。
 *
 * URL は画面 4（`/requests?ids=<id>`）。画面 4 は URL の再訪で成立する設計（FR-4.7）なので、新しい経路は要らない。
 * 受け取った人が開けば、差分確認と反映の画面が直接出る（反映できるかは、その人の権限による）。
 * `showId={false}` は、ID を別の場所に出している一覧の操作列で、コピーのボタンだけを出すとき。
 */
export function RequestLink({
  changeRequestId,
  showId = true,
}: {
  changeRequestId: string;
  showId?: boolean;
}): React.JSX.Element {
  const t = useT();
  const url = requestUrl(window.location.origin, changeRequestId);
  return (
    <span data-testid={`request-link-${changeRequestId}`} style={{ whiteSpace: "nowrap" }}>
      {showId && (
        <>
          {t.common.requestLink.idLabel}<code>{changeRequestId}</code>{" "}
        </>
      )}
      {showId ? (
        <CopyToClipboard
          variant="inline"
          textToCopy={url}
          textToDisplay={t.common.requestLink.copyUrl}
          copyButtonAriaLabel={t.common.requestLink.copyUrl}
          copySuccessText={t.common.requestLink.copied}
          copyErrorText={t.common.requestLink.copyFailed}
        />
      ) : (
        // inline は textToCopy（URL）をボタンの隣に出すので、ID を別に出す一覧では icon にして URL を出さない。
        <CopyToClipboard
          variant="icon"
          textToCopy={url}
          copyButtonAriaLabel={t.common.requestLink.copyUrl}
          copySuccessText={t.common.requestLink.copied}
          copyErrorText={t.common.requestLink.copyFailed}
        />
      )}
    </span>
  );
}
