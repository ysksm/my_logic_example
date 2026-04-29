import { CapturePage } from "./pages/CapturePage";

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>pcap-go</h1>
        <span className="tag">macOS packet capture</span>
      </header>
      <main className="app-main">
        <CapturePage />
      </main>
    </div>
  );
}
