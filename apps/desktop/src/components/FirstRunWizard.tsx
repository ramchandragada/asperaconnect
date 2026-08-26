export function FirstRunWizard({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      className="fade-in"
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div
        className="panel"
        style={{ maxWidth: 560, width: "100%", padding: "2rem", overflow: "hidden", position: "relative" }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 50%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative" }}>
          <div className="brand" style={{ fontSize: "2.4rem", marginBottom: "0.35rem" }}>
            Aspera Connect
          </div>
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "1.1rem" }}>
            Click-to-call from Linux to your phone. Free, local, no account.
          </p>

          <ol style={{ color: "var(--ink)", lineHeight: 1.6, paddingLeft: "1.2rem" }}>
            <li>Install the companion app on your phone.</li>
            <li>Tap <strong>Start for calls</strong> and note the phone IP.</li>
            <li>On this PC, connect with that IP — Hub / Zoho can dial.</li>
          </ol>

          <p style={{ color: "var(--muted)", fontSize: "0.95rem" }}>
            No Developer Options, USB debugging, scrcpy, or KDE Connect needed.
          </p>

          <button className="btn btn-primary" onClick={onContinue} style={{ marginTop: "0.5rem" }}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
