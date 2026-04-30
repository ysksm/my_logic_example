import { useState } from "react";
import { useRepositories, useBranches } from "@/application/hooks/useRepositories";

export default function RepositoriesPage() {
  const { repos, error, create, remove } = useRepositories();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const { branches, error: branchError, createBranch } = useBranches(selectedRepo);
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("");
  const [checkout, setCheckout] = useState(false);

  return (
    <>
      <h1>リポジトリ</h1>

      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name || !path) return;
          await create({ name, path, default_branch: defaultBranch });
          setName("");
          setPath("");
        }}
      >
        <h3 style={{ marginTop: 0 }}>リポジトリ登録</h3>
        <div className="row">
          <input placeholder="名前" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="ローカルパス (Git working tree)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            style={{ flex: 1, minWidth: 300 }}
          />
          <input placeholder="default branch" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
          <button type="submit">登録</button>
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </form>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>登録済み</h3>
        <table>
          <thead>
            <tr><th>名前</th><th>パス</th><th>default</th><th></th></tr>
          </thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td><code>{r.path}</code></td>
                <td>{r.default_branch}</td>
                <td>
                  <button className="secondary" onClick={() => setSelectedRepo(r.id)}>選択</button>{" "}
                  <button className="danger" onClick={() => remove(r.id)}>削除</button>
                </td>
              </tr>
            ))}
            {repos.length === 0 && <tr><td colSpan={4} className="muted">なし</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedRepo && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            ブランチ管理 ({repos.find((r) => r.id === selectedRepo)?.name})
          </h3>
          {branchError && <p style={{ color: "red" }}>{branchError}</p>}
          <div className="row" style={{ marginBottom: 12 }}>
            <input placeholder="新しいブランチ名" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            <select value={fromBranch} onChange={(e) => setFromBranch(e.target.value)}>
              <option value="">(default branch から)</option>
              {branches.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <label className="row">
              <input
                type="checkbox"
                checked={checkout}
                onChange={(e) => setCheckout(e.target.checked)}
              />
              checkout する
            </label>
            <button
              onClick={async () => {
                if (!newBranch) return;
                await createBranch({ branch: newBranch, from: fromBranch || undefined, checkout });
                setNewBranch("");
              }}
            >
              ブランチ作成
            </button>
          </div>
          <ul>
            {branches.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
