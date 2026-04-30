import { useNavigate } from "react-router-dom";
import { isDesktop } from "@/shared/runtime";

interface Props {
  id: string;
  label?: string;
  className?: string;
}

// Web: anchor with target=_blank → new browser tab.
// Desktop (Wails): button that navigates within the SPA, since the
// single-window webview can't open new tabs.
export default function TicketDetailLink({ id, label = "↗", className }: Props) {
  const navigate = useNavigate();
  const cls = `btn-link ${className ?? ""}`.trim();

  if (isDesktop()) {
    return (
      <button
        type="button"
        className={cls}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/tickets/${id}`);
        }}
        title="詳細編集"
      >{label}</button>
    );
  }
  return (
    <a
      href={`/tickets/${id}`}
      target="_blank"
      rel="noopener"
      className={cls}
      onMouseDown={(e) => e.stopPropagation()}
      title="別タブで詳細編集"
    >{label}</a>
  );
}
