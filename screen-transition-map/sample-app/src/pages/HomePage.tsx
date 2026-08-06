import { Link, useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="page-header">
        <h1 data-wording="app-title">サンプルショップ</h1>
        <nav>
          <Link to="/settings" data-op="open-settings" data-op-label="「設定」リンクをクリック">
            設定
          </Link>
          <button
            data-op="logout"
            data-op-label="「ログアウト」をクリック"
            data-wording="logout-label"
            onClick={() => navigate("/login")}
          >
            ログアウト
          </button>
        </nav>
      </header>
      <h2 data-wording="home-heading">商品一覧</h2>
      <div className="item-grid">
        <button
          className="card item-card"
          data-op="open-item"
          data-op-label="商品カードをクリック"
          onClick={() => navigate("/items/1")}
        >
          <span className="item-name">コーヒー豆 (深煎り)</span>
          <span className="item-price">¥1,200</span>
        </button>
        <div className="card item-card disabled">
          <span className="item-name">ドリッパー (準備中)</span>
          <span className="item-price">—</span>
        </div>
      </div>
    </div>
  );
}
