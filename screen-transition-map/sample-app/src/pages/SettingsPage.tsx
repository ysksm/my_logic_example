import { Link, useNavigate } from "react-router-dom";

export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="page-header">
        <h1 data-wording="app-title">サンプルショップ</h1>
      </header>
      <h2 data-wording="settings-heading">設定</h2>
      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <label>
            表示名
            <input type="text" name="displayName" defaultValue="ユーザー" />
          </label>
          <label>
            <input type="checkbox" name="notify" defaultChecked /> 通知を受け取る
          </label>
          <button
            type="submit"
            data-op="save-settings"
            data-op-label="「保存」ボタンで送信"
          >
            保存
          </button>
        </form>
      </div>
      <Link to="/" data-op="back-home" data-op-label="「一覧へ戻る」をクリック">
        ← 一覧へ戻る
      </Link>
    </div>
  );
}
