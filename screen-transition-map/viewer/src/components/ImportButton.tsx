import { useRef } from "react";
import { loadDocument } from "../lib/loadDocument";
import type { ScreenMapDocument } from "../types";

interface Props {
  onImport: (doc: ScreenMapDocument) => void;
}

export function ImportButton({ onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImport(loadDocument(String(reader.result)));
      } catch (error) {
        alert(`読み込みに失敗しました\n${(error as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <button className="import-button" onClick={() => inputRef.current?.click()}>
        📂 JSON を開く
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
