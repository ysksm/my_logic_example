import { useMemo, useRef, useState } from "react";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

// Jira / GitHub-style chip input. Tags are committed on Enter, comma, or
// blur. Backspace on an empty draft pops the last chip. Existing matches
// surface as a small dropdown.
export default function TagInput({ value, onChange, suggestions = [], placeholder = "タグ" }: Props) {
  const [draft, setDraft] = useState("");
  const [activeSugg, setActiveSugg] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const d = draft.trim().toLowerCase();
    if (!d) return [];
    return suggestions
      .filter((s) => !value.includes(s) && s.toLowerCase().includes(d))
      .slice(0, 6);
  }, [draft, suggestions, value]);

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (value.includes(t)) return;
    onChange([...value, t]);
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function commitDraft() {
    if (draft.trim()) {
      add(draft);
      setDraft("");
    }
  }

  return (
    <div
      className="tag-input"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <span
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              remove(t);
            }}
            aria-label={`${t} を削除`}
          >×</span>
        </span>
      ))}
      <span style={{ position: "relative", flex: 1, minWidth: 100 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveSugg(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length > 0 && activeSugg < filtered.length) {
                add(filtered[activeSugg]);
                setDraft("");
              } else {
                commitDraft();
              }
            } else if (e.key === "," || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault();
                commitDraft();
              }
            } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
              remove(value[value.length - 1]);
            } else if (e.key === "ArrowDown" && filtered.length > 0) {
              e.preventDefault();
              setActiveSugg((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp" && filtered.length > 0) {
              e.preventDefault();
              setActiveSugg((i) => Math.max(i - 1, 0));
            } else if (e.key === "Escape") {
              setDraft("");
            }
          }}
          onBlur={commitDraft}
          placeholder={value.length === 0 ? placeholder : ""}
          className="tag-input-field"
        />
        {filtered.length > 0 && (
          <ul className="tag-suggestions">
            {filtered.map((s, i) => (
              <li
                key={s}
                className={i === activeSugg ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s);
                  setDraft("");
                  inputRef.current?.focus();
                }}
              >{s}</li>
            ))}
          </ul>
        )}
      </span>
    </div>
  );
}
