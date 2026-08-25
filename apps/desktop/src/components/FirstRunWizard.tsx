import type { ToolsReport } from "../lib/types";

export function FirstRunWizard({
  tools,
  onContinue,
}: {
  tools: ToolsReport | null;
  onContinue: () => void;
}) {
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
      <div className="panel" style={{ maxWidth: 640, width: "100%", padding: "2rem", overflow: "hidden", position: "relative" }}>
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
            Mirror and control your Android phone from Linux. Free, local-first, no account.
          </p>

          <ol style={{ color: "var(--ink)", lineHeight: 1.6, paddingLeft: "1.2rem" }}>
            <li>On your phone: Settings → About phone → tap Build number 7 times.</li>
            <li>Enable USB debugging (and Wireless debugging if you want Wi‑Fi).</li>
            <li>Connect USB, unlock the phone, and tap Allow.</li>
            <li>Press Continue — then Mirror.</li>
          </ol>

          <div style={{ display: "grid", gap: "0.6rem", margin: "1.25rem 0" }}>
            <ToolRow label="adb" tool={tools?.adb} />
            <ToolRow label="scrcpy" tool={tools?.scrcpy} />
          </div>

          {!tools?.readyForProMode ? (
            <p style={{ color: "var(--accent-2)" }}>
              Install missing tools, then restart Aspera Connect:
              <br />
              <code>sudo apt install adb scrcpy</code>
            </p>
          ) : (
            <p style={{ color: "var(--accent)" }}>Tools detected. You’re ready.</p>
          )}

          <button className="btn btn-primary" onClick={onContinue} style={{ marginTop: "0.5rem" }}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolRow({
  label,
  tool,
}: {
  label: string;
  tool?: { found: boolean; version?: string | null; installHint: string };
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.75rem 0.9rem",
        borderRadius: 12,
        background: "rgba(0,0,0,0.22)",
        border: "1px solid var(--line)",
      }}
    >
      <div>
        <strong>{label}</strong>
        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {tool?.found ? tool.version ?? "found" : tool?.installHint ?? "checking…"}
        </div>
      </div>
      <span style={{ color: tool?.found ? "var(--accent)" : "var(--danger)" }}>
        {tool?.found ? "Ready" : "Missing"}
      </span>
    </div>
  );
}
