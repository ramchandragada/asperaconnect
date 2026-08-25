import type { UserFacingError } from "../lib/types";

export function ErrorBanner({ error, onDismiss }: { error: UserFacingError; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="panel fade-in"
      style={{
        padding: "1rem 1.1rem",
        borderColor: "color-mix(in srgb, var(--danger) 45%, var(--line))",
        background: "color-mix(in srgb, var(--danger) 10%, var(--bg2))",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{error.title}</div>
          <div style={{ color: "var(--muted)" }}>{error.message}</div>
          {error.hint ? (
            <div style={{ marginTop: 8, color: "var(--accent-2)", fontSize: "0.95rem" }}>
              {error.hint}
            </div>
          ) : null}
        </div>
        {onDismiss ? (
          <button className="btn btn-ghost" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
