/* Shown instead of the globe when WebGL is unavailable or the scene fails
   to start, so the app explains itself rather than rendering a blank page. */

export default function SceneUnavailable() {
  return (
    <div style={S.root}>
      <div style={S.card}>
        <div style={S.emoji} role="img" aria-label="Globe">🌍</div>
        <h1 style={S.h1}>
          Poly Planet<span style={S.dot}>.</span>
        </h1>
        <p style={S.lead}>
          This little world needs <strong>WebGL</strong>, and your browser
          isn&apos;t able to start it right now.
        </p>
        <ul style={S.list}>
          <li>Turn on hardware acceleration in your browser settings</li>
          <li>Update to a current version of Chrome, Firefox, Edge, or Safari</li>
          <li>If you&apos;re on a work device, graphics access may be restricted</li>
        </ul>
        <button style={S.button} onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </div>
  );
}

const S = {
  root: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "linear-gradient(#dcebf8, #a8c9e6)",
    font: '600 15px/1.55 Nunito, ui-sans-serif, system-ui, sans-serif',
    color: "#22395b",
  },
  card: {
    maxWidth: "420px",
    width: "100%",
    background: "#fdfbf6",
    borderRadius: "20px",
    padding: "28px 26px",
    boxSizing: "border-box",
    boxShadow: "0 10px 30px rgba(20,32,54,.16)",
    textAlign: "center",
  },
  emoji: { fontSize: "44px", lineHeight: 1, marginBottom: "6px" },
  h1: { margin: "0 0 10px", fontSize: "26px", fontWeight: 800, letterSpacing: "-.01em" },
  dot: { color: "#e0523f" },
  lead: { margin: "0 0 16px" },
  list: {
    margin: "0 0 22px",
    padding: "0 0 0 20px",
    textAlign: "left",
    fontSize: "14px",
    fontWeight: 600,
    opacity: 0.85,
  },
  button: {
    border: "none",
    borderRadius: "999px",
    background: "#e0523f",
    color: "#fff",
    font: "inherit",
    fontWeight: 800,
    padding: "11px 22px",
    cursor: "pointer",
  },
};
