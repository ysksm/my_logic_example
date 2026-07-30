interface Props {
  message: string;
}

/** API 取得失敗時のエラーバナー。バックエンド未起動でも画面を壊さないための表示。 */
export function ErrorBanner({ message }: Props) {
  return (
    <div className="error-banner" role="alert">
      <strong>データを取得できませんでした。</strong>{" "}
      バックエンド（http://localhost:8000）が起動しているか確認してください。
      <div className="error-detail">{message}</div>
    </div>
  );
}
