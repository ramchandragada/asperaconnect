import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { BookUser, HelpCircle, Settings, Smartphone } from "lucide-react";
import { api } from "./lib/api";
import { locales, t } from "./lib/i18n";
import type {
  AppConfig,
  AppView,
  CompanionDevice,
  CompanionSessionState,
  ContactsCache,
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
  const [contactsCache, setContactsCache] = useState<ContactsCache>({ contacts: [] });
  const [contactQuery, setContactQuery] = useState("");

  const locale = config?.locale ?? "en";

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const list = contactsCache.contacts ?? [];
    if (!q) return list;
    return list.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      return c.phones.some((p) => p.toLowerCase().includes(q));
    });
  }, [contactsCache.contacts, contactQuery]);

  const bootstrap = useCallback(async () => {
    const [cfg, cached] = await Promise.all([api.getConfig(), api.loadCachedContacts()]);
    setConfig(cfg);
    setContactsCache(cached ?? { contacts: [] });
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
    let unlistenClip: (() => void) | undefined;
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
    void listen("tray://call-clipboard", () => {
      void (async () => {
        try {
          const text = await navigator.clipboard.readText();
          const parsed = await api.parseCallUri(text.trim());
          if (!parsed.ok || !parsed.data) {
            setError(
              parsed.error ?? {
                code: "clipboard",
                title: "No number",
                message: "Copy a phone number first, then use Call from clipboard.",
                hint: null,
              },
            );
            return;
          }
          setView("companion");
          const res = await api.placeCall({
            number: parsed.data,
            serial: null,
            direct: true,
          });
          if (!res.ok) setError(res.error ?? null);
          else setStatusMsg(res.data ?? `Calling ${parsed.data}`);
        } catch {
          setError({
            code: "clipboard",
            title: "Clipboard read failed",
            message: "Allow clipboard access or paste the number in Hub instead.",
            hint: null,
          });
        }
      })();
    }).then((fn) => {
      unlistenClip = fn;
    });
    void api.takePendingCall().then((n) => {
      if (!n) return;
      setView("companion");
      void api.placeCall({ number: n, serial: null, direct: true }).then((res) => {
        if (!res.ok) setError(res.error ?? null);
        else setStatusMsg(res.data ?? `Calling ${n}`);
      });
    });
    return () => {
      unlistenCall?.();
      unlistenClip?.();
    };
  }, []);

  async function persistConfig(next: AppConfig) {
    await api.saveConfig(next);
    setConfig(next);
  }

  async function syncContacts(host?: string) {
    setBusy(true);
    setError(null);
    const res = await api.syncPhoneContacts(host ?? (companionHost.trim() || null));
    setBusy(false);
    if (!res.ok) return setError(res.error ?? null);
    setContactsCache(res.data ?? { contacts: [] });
    const n = res.data?.contacts?.length ?? 0;
    setStatusMsg(`Synced ${n} contact${n === 1 ? "" : "s"} from phone`);
  }

  async function callNumber(number: string) {
    setBusy(true);
    setError(null);
    const res = await api.placeCall({ number, serial: null, direct: true });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? null);
    setStatusMsg(res.data ?? `Calling ${number}`);
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

  const heading =
    view === "companion"
      ? "Phone calls"
      : view === "contacts"
        ? "Contacts"
        : view === "settings"
          ? t(locale, "settings")
          : t(locale, "help");

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
          icon={<BookUser size={18} />}
          label="Contacts"
          active={view === "contacts"}
          onClick={() => setView("contacts")}
          badge={
            (contactsCache.contacts?.length ?? 0) > 0
              ? { text: String(contactsCache.contacts.length), tone: "ok" }
              : undefined
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
            {heading}
          </div>
          <div style={{ color: "var(--muted)" }}>
            {view === "contacts"
              ? "Search synced phone contacts and dial from the PC."
              : "PC → phone dialing. Nothing else."}
          </div>
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
                setStatusMsg("Connected — syncing contacts…");
                await syncContacts(companionHost);
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

        {view === "contacts" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.85rem", maxWidth: 640 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="field"
                style={{ flex: 1, minWidth: 180 }}
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="Search name or number"
              />
              <button
                className="btn btn-primary"
                disabled={busy || !companionHost.trim()}
                onClick={() => void syncContacts()}
              >
                Sync from phone
              </button>
            </div>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>
              {(contactsCache.contacts?.length ?? 0) === 0
                ? "No contacts yet — Connect for phone calls (auto-syncs) or tap Sync from phone."
                : `${contactsCache.contacts.length} contact${contactsCache.contacts.length === 1 ? "" : "s"} cached${
                    contactsCache.syncedAt
                      ? ` · last sync ${new Date(contactsCache.syncedAt).toLocaleString()}`
                      : ""
                  }`}
            </p>
            <div style={{ display: "grid", gap: 6, maxHeight: "calc(100vh - 280px)", overflow: "auto" }}>
              {filteredContacts.map((c) => {
                const primary = c.phones[0] ?? "";
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "0.65rem 0.75rem",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {c.phones.join(" · ")}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      disabled={busy || !primary}
                      onClick={() => void callNumber(primary)}
                    >
                      Call
                    </button>
                  </div>
                );
              })}
              {filteredContacts.length === 0 && (contactsCache.contacts?.length ?? 0) > 0 ? (
                <p style={{ color: "var(--muted)" }}>No matches for “{contactQuery}”.</p>
              ) : null}
            </div>
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
              Calling uses Easy mode only. Contacts sync over the same link.
            </p>
          </div>
        )}

        {view === "help" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", lineHeight: 1.55, maxWidth: 640 }}>
            <h3 style={{ marginTop: 0 }}>Click-to-call</h3>
            <ol>
              <li>
                Phone: open Aspera Connect → <strong>Start for calls</strong> (allow Phone + Contacts).
              </li>
              <li>
                PC: enter the phone IP → <strong>Connect for phone calls</strong> (auto-syncs contacts).
              </li>
              <li>
                Open <strong>Contacts</strong>, search, tap <strong>Call</strong>.
              </li>
              <li>
                Optional: register <code>tel:</code> for Zoho / browser links.
              </li>
            </ol>
            <p style={{ color: "var(--muted)" }}>
              Close the window to the tray — dialing and cached contacts stay available while the phone
              notification is up.
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
        <span className={`nav-badge nav-badge-${badge.tone}`} aria-label={`${label} ${badge.text}`}>
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
