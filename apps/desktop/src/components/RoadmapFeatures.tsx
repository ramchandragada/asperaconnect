import type { SetupReport, PhoneNotification } from "../lib/types";
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Props = {
  notifications: PhoneNotification[];
  onRefresh: () => void;
  onClear: () => void;
  onMarkRead: (id: string) => void;
  onPullKde?: () => void;
};

export function NotificationsPanel({ notifications, onRefresh, onClear, onMarkRead, onPullKde }: Props) {
  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Phone notifications</strong>
        <div style={{ display: "flex", gap: 8 }}>
          {onPullKde ? (
            <button className="btn" onClick={onPullKde}>
              Pull from KDE
            </button>
          ) : null}
          <button className="btn" onClick={onRefresh}>
            Refresh
          </button>
          <button className="btn" onClick={onClear} disabled={!notifications.length}>
            Clear all
          </button>
        </div>
      </div>
      <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
        Alerts arrive from Easy mode companion, or pull them from KDE Connect when paired.
      </p>
      {!notifications.length ? (
        <div style={{ color: "var(--muted)", padding: "1rem 0" }}>No notifications yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxHeight: 480, overflow: "auto" }}>
          {notifications.map((n) => (
            <button
              key={n.id}
              className="btn"
              onClick={() => onMarkRead(n.id)}
              style={{
                textAlign: "left",
                opacity: n.read ? 0.65 : 1,
                borderColor: n.read ? undefined : "color-mix(in srgb, var(--accent) 35%, var(--line))",
              }}
            >
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{n.app}</div>
              <div style={{ fontWeight: 700 }}>{n.title || "(no title)"}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{n.body}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SetupDoctorPanel({ report }: { report: SetupReport | null }) {
  if (!report) {
    return (
      <div className="panel fade-in" style={{ padding: "1.25rem", color: "var(--muted)" }}>
        Loading setup checks…
      </div>
    );
  }
  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: 10 }}>
      <strong>Setup doctor</strong>
      <p style={{ color: "var(--muted)", margin: 0 }}>
        {report.readyForProMode
          ? "Pro mode is ready — adb and scrcpy look good."
          : "Fix the items below for the best mirroring experience."}
      </p>
      {report.checks.map((c) => (
        <div
          key={c.id}
          style={{
            display: "grid",
            gap: 4,
            padding: "0.65rem 0.75rem",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "color-mix(in srgb, var(--ink) 3%, var(--bg2))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{c.label}</span>
            <span style={{ color: c.ok ? "var(--accent)" : "var(--danger)" }}>{c.ok ? "OK" : "Fix"}</span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{c.detail}</div>
          {c.fixHint ? (
            <code style={{ fontSize: "0.8rem", color: "var(--ink)", wordBreak: "break-all" }}>{c.fixHint}</code>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function useTauriFileDrop(onDrop: (paths: string[]) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          onDrop(event.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [enabled, onDrop]);
}

export function DropZone({
  label,
  disabled,
  onDropPaths,
}: {
  label: string;
  disabled?: boolean;
  onDropPaths: (paths: string[]) => void;
}) {
  return (
    <div
      className="drop-zone"
      data-disabled={disabled ?? false}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add("drag-over");
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove("drag-over");
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drag-over");
        if (disabled) return;
        const paths = Array.from(e.dataTransfer.files).map((f) => {
          // Tauri webview exposes path on File when allowed
          return (f as File & { path?: string }).path ?? f.name;
        });
        if (paths.length) onDropPaths(paths);
      }}
    >
      {label}
    </div>
  );
}
