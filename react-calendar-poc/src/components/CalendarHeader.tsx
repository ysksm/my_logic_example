import type { ViewMode } from "../types";
import { formatRangeLabel } from "../utils/dateUtils";

interface Props {
  date: Date;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreate: () => void;
}

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "day", label: "1日" },
  { value: "5day", label: "5日" },
  { value: "week", label: "7日" },
  { value: "month", label: "1ヶ月" },
];

export function CalendarHeader({
  date,
  view,
  onChangeView,
  onPrev,
  onNext,
  onToday,
  onCreate,
}: Props) {
  return (
    <header className="cal-header">
      <div className="cal-header__left">
        <button className="btn btn-primary" onClick={onCreate}>
          + 予定を作成
        </button>
        <button className="btn" onClick={onToday}>
          今日
        </button>
        <div className="cal-header__nav">
          <button className="icon-btn" onClick={onPrev} aria-label="前へ">
            ‹
          </button>
          <button className="icon-btn" onClick={onNext} aria-label="次へ">
            ›
          </button>
        </div>
        <div className="cal-header__title">{formatRangeLabel(date, view)}</div>
      </div>
      <div className="cal-header__right">
        <div className="view-switch" role="tablist">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={view === opt.value}
              className={`view-switch__btn${
                view === opt.value ? " is-active" : ""
              }`}
              onClick={() => onChangeView(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
