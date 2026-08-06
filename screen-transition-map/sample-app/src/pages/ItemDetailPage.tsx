import { Link } from "react-router-dom";

export function ItemDetailPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 data-wording="app-title">サンプルショップ</h1>
        <nav>
          <Link to="/settings" data-op="open-settings" data-op-label="「設定」リンクをクリック">
            設定
          </Link>
        </nav>
      </header>
      <h2 data-wording="item-heading">商品詳細</h2>
      <div className="card">
        <h3>コーヒー豆 (深煎り)</h3>
        <p>コクのある深煎りブレンド。200g。</p>
        <p className="item-price">¥1,200</p>
      </div>
      <Link to="/" data-op="back-home" data-op-label="「一覧へ戻る」をクリック">
        ← 一覧へ戻る
      </Link>
    </div>
  );
}
