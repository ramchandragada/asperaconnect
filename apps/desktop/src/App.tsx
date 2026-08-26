import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { HelpCircle, Settings, Smartphone } from "lucide-react";
import { api } from "./lib/api";
import { locales, t } from "./lib/i18n";
import type {
  AppConfig,
  AppView,
  CompanionDevice,
  CompanionSessionState,
  UserFacingError,
} from "./lib/types";
import { ErrorBanner } from "./components/ErrorBanner";
import { FirstRunWizard } from "./components/FirstRunWizard";
import "./styles/app.css";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AppView>("companion");
  const [companion, setCompanion] = useState<CompanionSessionState | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [companionHost, setCompanionHost] = useState("192.168.1.20");
  const [companionName, setCompanionName] = useState("My Phone");
  const [companionPin, setCompanionPin] = useState("");
  const [discoveredCompanions, setDiscoveredCompanions] = useState<CompanionDevice[]>([]);

  const locale = config?.locale ?? "en";

  const bootstrap = useCallback(async () => {
    const cfg = await api.getConfig();
    setConfig(cfg);
    setCompanionPin(cfg.companionPin ?? "");
    if (cfg.companionHost) setCompanionHost(cfg.companionHost);
    if (cfg.companionName) setCompanionName(cfg.companionName);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    void api.getCompanionState().then(setCompanion);
    let unlisten: (() => void) | undefined;
    void listen<boolean>("companion://status", (ev) => {
      void api.getCompanionState().then(setCompanion);
      if (ev.payload) {
        setStatusMsg("Connected — Hub click-to-call can use this phone");
      } else {
        setStatusMsg("Disconnected — Connect again when the phone is listening.");
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (view !== "companion") return;
    void api.getCompanionState().then(setCompanion);
    const id = window.setInterval(() => {
      void api.getCompanionState().then(setCompanion);
    }, 2500);
    return () => window.clearInterval(id);
  }, [view]);

  useEffect(() => {
    let unlistenCall: (() => void) | undefined;
    void listen<string>("aspera://call", (ev) => {
      setView("companion");
      void (async () => {
        const res = await api.placeCall({
          number: ev.payload,
          serial: null,
          direct: true,
        });
        if (!res.ok) setError(res.error ?? null);
        else setStatusMsg(res.data ?? `Calling ${ev.payload}`);
      })();
    }).then((fn) => {
      unlistenCall = fn;
    });
    void api.takePendingCall().then((n) => {
      if (!n) return;
      setView("companion");
      void api.placeCall({ number: n, serial: null, direct: true }).then((res) => {
        if (!res.ok) setError(res.error ?? null);
        else setStatusMsg(res.data ?? `Calling ${n}`);
      });
    });
    return () => unlistenCall?.();
  }, []);

  async function persistConfig(next: AppConfig) {
    await api.saveConfig(next);
    setConfig(next);
  }

  if (!config) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
        Loading…
      </div>
    );
  }

  if (!config.firstRunCompleted) {
    return (
      <FirstRunWizard
        onContinue={async () => {
          const next = await api.completeFirstRun();
          setConfig(next);
        }}
      />
    );
  }

  return (
    <div className="app-shell" style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100%" }}>
      <aside
        style={{
          borderRight: "1px solid var(--line)",
          padding: "1.25rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          background: "rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ padding: "0.35rem 0.85rem 1rem" }}>
          <div className="brand" style={{ fontSize: "1.35rem" }}>
            {t(locale, "brand")}
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Click-to-call</div>
        </div>
        <Nav
          icon={<Smartphone size={18} />}
          label="Phone calls"
          active={view === "companion"}
          onClick={() => setView("companion")}
          badge={
            companion?.connected
              ? { text: "Linked", tone: "ok" }
              : config.companionHost
                ? { text: "Saved", tone: "warn" }
                : { text: "Off", tone: "bad" }
          }
        />
        <Nav
          icon={<Settings size={18} />}
          label={t(locale, "settings")}
          active={view === "settings"}
          onClick={() => setView("settings")}
        />
        <Nav
          icon={<HelpCircle size={18} />}
          label={t(locale, "help")}
          active={view === "help"}
          onClick={() => setView("help")}
        />
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.8rem" }}>
          Free forever · Apache-2.0
        </div>
      </aside>

      <main style={{ padding: "1.25rem 1.5rem", overflow: "auto", minWidth: 0 }}>
        <header style={{ marginBottom: "1rem" }}>
          <div className="brand" style={{ fontSize: "1.8rem" }}>
            {view === "companion" ? "Phone calls" : view === "settings" ? t(locale, "settings") : t(locale, "help")}
          </div>
          <div style={{ color: "var(--muted)" }}>PC → phone dialing. Nothing else.</div>
        </header>

        {error ? (
          <div style={{ marginBottom: "1rem" }}>
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          </div>
        ) : null}
        {statusMsg ? (
          <div
            className="panel fade-in"
            style={{ padding: "0.85rem 1rem", marginBottom: "1rem", color: "var(--accent)" }}
          >
            {statusMsg}
          </div>
        ) : null}

        {view === "companion" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "1rem", maxWidth: 520 }}>
            <EasyLinkStatus
              connected={!!companion?.connected}
              host={companion?.device?.host ?? companionHost}
              savedHost={config.companionHost ?? null}
              lastError={companion?.lastError ?? null}
            />

            <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.45 }}>
              On the phone open Aspera Connect → <strong>Start for calls</strong>. Enter the phone IP
              below, then connect. Hub / Zoho click-to-call dials every time.
            </p>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem", fontWeight: 600 }}>Phone IP</span>
              <input
                className="field"
                value={companionHost}
                onChange={(e) => setCompanionHost(e.target.value)}
                placeholder="e.g. 192.168.1.9"
              />
            </label>

            <button
              className="btn btn-primary"
              style={{ minHeight: 52, fontSize: "1.05rem" }}
              disabled={busy || !companionHost.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await api.companionHello(
                  companionHost,
                  companionName,
                  companionPin || undefined,
                );
                setBusy(false);
                if (!res.ok) {
                  setCompanion({
                    connected: false,
                    device: null,
                    mirroring: false,
                    lastError: res.error?.message ?? "Connection failed",
                  });
                  return setError(res.error ?? null);
                }
                setCompanion(res.data ?? null);
                setConfig(await api.getConfig());
                setStatusMsg("Connected — Hub click-to-call can use this phone");
              }}
            >
              Connect for phone calls
            </button>

            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await api.registerTelHandler();
                setBusy(false);
                if (!res.ok) return setError(res.error ?? null);
                setStatusMsg(res.data ?? "tel: handler registered");
              }}
            >
              Make Aspera handle tel: links (Zoho / browser)
            </button>

            <details style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              <summary style={{ cursor: "pointer" }}>More options</summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <input
                  className="field"
                  value={companionName}
                  onChange={(e) => setCompanionName(e.target.value)}
                  placeholder="Phone name"
                />
                <input
                  className="field"
                  value={companionPin}
                  onChange={(e) => setCompanionPin(e.target.value)}
                  placeholder="Optional PIN"
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    onClick={async () => {
                      setBusy(true);
                      const res = await api.discoverCompanions();
                      setBusy(false);
                      if (!res.ok) return setError(res.error ?? null);
                      setDiscoveredCompanions(res.data ?? []);
                      if (res.data?.[0]) setCompanionHost(res.data[0].host);
                      setStatusMsg(
                        res.data?.length
                          ? `Found ${res.data.length} phone(s)`
                          : "No phone found — tap Start for calls on the phone first",
                      );
                    }}
                  >
                    Find phone on network
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      const next = await api.setCompanionPin(companionPin);
                      setConfig(next);
                      setStatusMsg("PIN saved");
                    }}
                  >
                    Save PIN
                  </button>
                </div>
                {discoveredCompanions.map((d) => (
                  <button
                    key={d.id}
                    className="btn btn-ghost"
                    style={{ textAlign: "left" }}
                    onClick={() => {
                      setCompanionHost(d.host);
                      setCompanionName(d.name);
                    }}
                  >
                    {d.name} — {d.host}
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}

        {view === "settings" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.9rem", maxWidth: 420 }}>
            <label>
              Language
              <select
                className="field"
                style={{ marginTop: 6 }}
                value={config.locale}
                onChange={(e) => void persistConfig({ ...config, locale: e.target.value })}
              >
                {locales.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
              Calling uses Easy mode only. No ADB, scrcpy, or KDE Connect required.
            </p>
          </div>
        )}

        {view === "help" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", lineHeight: 1.55, maxWidth: 640 }}>
            <h3 style={{ marginTop: 0 }}>Click-to-call</h3>
            <ol>
              <li>Phone: open Aspera Connect → <strong>Start for calls</strong> (keep the notification).</li>
              <li>PC: enter the phone IP → <strong>Connect for phone calls</strong>.</li>
              <li>Optional: register <code>tel:</code> so Zoho / browser links dial here.</li>
              <li>Click a number in Hub / Zoho — the phone dials.</li>
            </ol>
            <p style={{ color: "var(--muted)" }}>
              Same office network is enough (phone Wi‑Fi + PC wired is fine). On OnePlus, set battery to
              Unrestricted for Aspera Connect.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Nav({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: { text: string; tone: "ok" | "warn" | "bad" };
}) {
  return (
    <button className="nav-item" data-active={active} onClick={onClick}>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? (
        <span className={`nav-badge nav-badge-${badge.tone}`} aria-label={`Phone calls ${badge.text}`}>
          {badge.text}
        </span>
      ) : null}
    </button>
  );
}

function EasyLinkStatus({
  connected,
  host,
  savedHost,
  lastError,
}: {
  connected: boolean;
  host: string;
  savedHost: string | null;
  lastError: string | null;
}) {
  if (connected) {
    return (
      <div className="easy-status easy-status-ok" role="status">
        <div className="easy-status-title">Connected</div>
        <div className="easy-status-detail">
          Phone ready at <code>{host}</code>. Hub click-to-call works.
        </div>
      </div>
    );
  }
  if (lastError) {
    return (
      <div className="easy-status easy-status-bad" role="status">
        <div className="easy-status-title">Not connected</div>
        <div className="easy-status-detail">{lastError}</div>
      </div>
    );
  }
  if (savedHost) {
    return (
      <div className="easy-status easy-status-warn" role="status">
        <div className="easy-status-title">Phone IP saved</div>
        <div className="easy-status-detail">
          Tap <strong>Connect for phone calls</strong> (IP <code>{savedHost}</code>).
        </div>
      </div>
    );
  }
  return (
    <div className="easy-status easy-status-bad" role="status">
      <div className="easy-status-title">Not connected</div>
      <div className="easy-status-detail">
        On the phone tap <strong>Start for calls</strong>, then type that IP below.
      </div>
    </div>
  );
}
