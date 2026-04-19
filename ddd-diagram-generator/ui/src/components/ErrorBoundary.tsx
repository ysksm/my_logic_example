import React from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#991b1b",
          background: "#fee2e2",
          height: "100%",
          overflow: "auto",
        }}
      >
        <h2 style={{ margin: 0 }}>Rendering error</h2>
        <p style={{ margin: "8px 0" }}>{this.state.error.message}</p>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", background: "white", padding: 12, borderRadius: 4 }}>
          {this.state.error.stack}
        </pre>
        <button
          onClick={this.reset}
          style={{ padding: "6px 12px", background: "#7c3aed", color: "white", border: 0, borderRadius: 4 }}
        >
          復帰
        </button>
      </div>
    );
  }
}
