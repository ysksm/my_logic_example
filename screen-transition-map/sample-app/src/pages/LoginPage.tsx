import { useNavigate } from "react-router-dom";

export function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className="page login-page">
      <h1 data-wording="app-title">サンプルショップ</h1>
      <div className="card">
        <h2 data-wording="login-heading">ログイン</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <label>
            ユーザー名
            <input type="text" name="username" placeholder="user@example.com" />
          </label>
          <label>
            パスワード
            <input type="password" name="password" />
          </label>
          <button
            type="submit"
            data-op="login-submit"
            data-op-label="「ログイン」ボタンで送信"
            data-wording="login-button-label"
          >
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}
