import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { BookUser, HelpCircle, Settings, Smartphone, Star } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "./lib/api";
import { locales, t } from "./lib/i18n";
import type {
  AppConfig,
  AppView,
  CallHistory,
  CompanionDevice,
  CompanionSessionState,
  ContactsCache,
  FavoritesStore,
  QrPairSession,
  UserFacingError,
} from "./lib/types";
import { ErrorBanner } from "./components/ErrorBanner";
import { FirstRunWizard } from "./components/FirstRunWizard";
import asperaLogo from "./assets/aspera-logo.png";
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
  const [qrSession, setQrSession] = useState<QrPairSession | null>(null);
  const [contactsCache, setContactsCache] = useState<ContactsCache>({ contacts: [] });
  const [callHistory, setCallHistory] = useState<CallHistory>({ entries: [] });
  const [favorites, setFavorites] = useState<FavoritesStore>({ favorites: [] });
  const [contactQuery, setContactQuery] = useState("");
  const [activeCall, setActiveCall] = useState<{
    name: string;
    number: string;
    phase: "dialing" | "sent" | "ended" | "failed";
    detail?: string;
  } | null>(null);

  const locale = config?.locale ?? "en";

  const favoriteIds = useMemo(
    () => new Set(favorites.favorites.map((f) => f.id)),
    [favorites.favorites],
  );

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
    const [cfg, cached, history, favs] = await Promise.all([
      api.getConfig(),
      api.loadCachedContacts(),
      api.loadCallHistory(),
      api.loadFavorites(),
    ]);
    setConfig(cfg);
    setContactsCache(cached ?? { contacts: [] });
    setCallHistory(history ?? { entries: [] });
    setFavorites(favs ?? { favorites: [] });
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
    let unlisten: (() => void) | undefined;
    void listen<{ phoneIp: string; phonePort: number; name: string }>("aspera://qr-paired", (ev) => {
      void (async () => {
        const phone = ev.payload;
        setCompanionHost(phone.phoneIp);
        if (phone.name) setCompanionName(phone.name);
        setQrSession(null);
        await api.stopQrPairing();
        setBusy(true);
        setError(null);
        setStatusMsg(`Phone scanned QR — connecting to ${phone.phoneIp}…`);
        const cfg = await api.getConfig();
        await api.saveConfig({ ...cfg, companionHost: phone.phoneIp, companionName: phone.name || cfg.companionName });
        setConfig(await api.getConfig());
        const res = await api.companionHello(
          phone.phoneIp,
          phone.name || "My Phone",
          cfg.companionPin || undefined,
        );
        setBusy(false);
        if (!res.ok) {
          setCompanion({
            connected: false,
            device: null,
            mirroring: false,
            lastError: res.error?.message ?? "Connection failed after QR pair",
          });
          return setError(res.error ?? null);
        }
        setCompanion(res.data ?? null);
        setStatusMsg("Connected — syncing contacts…");
        const sync = await api.syncPhoneContacts(phone.phoneIp);
        if (sync.ok) {
          setContactsCache(sync.data ?? { contacts: [] });
          const n = sync.data?.contacts?.length ?? 0;
          setStatusMsg(`Synced ${n} contact${n === 1 ? "" : "s"} from phone`);
        }
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      void api.stopQrPairing();
    };
  }, []);

  useEffect(() => {
    if (view !== "companion") return;
    void api.getCompanionState().then(setCompanion);
    const id = window.setInterval(() => {
      void api.getCompanionState().then(setCompanion);
    }, 2500);
    return () => window.clearInterval(id);
  }, [view]);

  const callNumber = useCallback(async (number: string, name?: string) => {
    const label = name?.trim() || number;
    setBusy(true);
    setError(null);
    setActiveCall({ name: label, number, phase: "dialing" });
    setStatusMsg(null);
    const res = await api.placeCall({ number, serial: null, direct: true });
    setBusy(false);
    if (!res.ok) {
      setActiveCall({
        name: label,
        number,
        phase: "failed",
        detail: res.error?.message ?? "Call failed",
      });
      setError(res.error ?? null);
      const hist = await api.recordCallHistory(label, number, "failed");
      if (hist.ok && hist.data) setCallHistory(hist.data);
      return;
    }
    setActiveCall({
      name: label,
      number,
      phase: "sent",
      detail: res.data ?? "Ringing on your phone",
    });
    setStatusMsg(null);
    const hist = await api.recordCallHistory(label, number, "dialed");
    if (hist.ok && hist.data) setCallHistory(hist.data);
  }, []);

  useEffect(() => {
    let unlistenCall: (() => void) | undefined;
    let unlistenClip: (() => void) | undefined;
    void listen<string>("aspera://call", (ev) => {
      setView("companion");
      void callNumber(ev.payload);
    }).then((fn) => {
      unlistenCall = fn;
    });
    void listen("tray://call-clipboard", () => {
      void (async () => {
        const clip = await api.readSystemClipboard();
        if (!clip.ok || !clip.data?.trim()) {
          setError(
            clip.error ?? {
              code: "clipboard",
              title: "No number",
              message: "Copy a phone number first, then use Call from clipboard.",
              hint: null,
            },
          );
          return;
        }
        const parsed = await api.parseCallUri(clip.data.trim());
        if (!parsed.ok || !parsed.data) {
          setError(
            parsed.error ?? {
              code: "clipboard",
              title: "No number",
              message: "Clipboard does not contain a dialable phone number.",
              hint: null,
            },
          );
          return;
        }
        setView("companion");
        await callNumber(parsed.data);
      })();
    }).then((fn) => {
      unlistenClip = fn;
    });
    void api.takePendingCall().then((n) => {
      if (!n) return;
      setView("companion");
      void callNumber(n);
    });
    return () => {
      unlistenCall?.();
      unlistenClip?.();
    };
  }, [callNumber]);

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

  async function discoverPhone(autoFill = true, manageBusy = true) {
    if (manageBusy) setBusy(true);
    const res = await api.discoverCompanions();
    if (manageBusy) setBusy(false);
    if (!res.ok) return { ok: false as const, error: res.error, devices: [] as CompanionDevice[] };
    const devices = res.data ?? [];
    setDiscoveredCompanions(devices);
    if (autoFill && devices[0]) {
      setCompanionHost(devices[0].host);
      if (devices[0].name) setCompanionName(devices[0].name);
    }
    return { ok: true as const, devices };
  }

  async function connectCompanion(host: string, tryDiscoverOnFailure = true) {
    setBusy(true);
    setError(null);
    await persistConfig({ ...config!, companionHost: host });
    let res = await api.companionHello(host, companionName, companionPin || undefined);
    let discovered: CompanionDevice[] = [];
    if (!res.ok && tryDiscoverOnFailure) {
      const discovery = await discoverPhone(true, false);
      discovered = discovery.devices;
      if (discovery.ok && discovered.length > 0) {
        const foundHost = discovered[0].host;
        if (foundHost !== host) {
          setCompanionHost(foundHost);
          await persistConfig({ ...config!, companionHost: foundHost });
          res = await api.companionHello(foundHost, companionName, companionPin || undefined);
          host = foundHost;
        } else {
          setStatusMsg("Phone found on network — retrying connect…");
          res = await api.companionHello(foundHost, companionName, companionPin || undefined);
        }
      }
    }
    setBusy(false);
    if (!res.ok) {
      const baseMsg = res.error?.message ?? "Connection failed";
      const hint =
        discoveryHintForError(baseMsg) ??
        (discovered.length === 0
          ? " Try Find phone on network or match the IP shown on the phone app."
          : null);
      setCompanion({
        connected: false,
        device: null,
        mirroring: false,
        lastError: hint ? `${baseMsg}${hint}` : baseMsg,
      });
      return setError(res.error ?? null);
    }
    setCompanion(res.data ?? null);
    setConfig(await api.getConfig());
    setStatusMsg("Connected — syncing contacts…");
    await syncContacts(host);
  }

  async function hangUp() {
    setBusy(true);
    setError(null);
    const res = await api.companionEndCall(companionHost.trim() || null);
    setBusy(false);
    if (!res.ok) {
      if (activeCall) {
        setActiveCall({
          ...activeCall,
          phase: "failed",
          detail: res.error?.message ?? "Hang up failed",
        });
      }
      setError(res.error ?? null);
      return;
    }
    const name = activeCall?.name ?? "Call";
    const number = activeCall?.number ?? "";
    setActiveCall({
      name,
      number,
      phase: "ended",
      detail: res.data ?? "Call ended",
    });
    if (number) {
      const hist = await api.recordCallHistory(name, number, "ended");
      if (hist.ok && hist.data) setCallHistory(hist.data);
    }
    window.setTimeout(() => setActiveCall(null), 2500);
  }

  async function toggleFavorite(id: string, name: string, number: string) {
    const res = await api.toggleFavorite(id, name, number);
    if (!res.ok) return setError(res.error ?? null);
    setFavorites(res.data ?? { favorites: [] });
  }

  async function clearHistory() {
    const res = await api.clearCallHistory();
    if (!res.ok) return setError(res.error ?? null);
    setCallHistory(res.data ?? { entries: [] });
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

  const savedHost = config.companionHost?.trim() ?? "";
  const currentHost = companionHost.trim();
  const ipChanged = savedHost.length > 0 && currentHost.length > 0 && savedHost !== currentHost;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img src={asperaLogo} alt="Aspera" className="brand-logo" />
          <div className="brand-sub">Connect · Click-to-call</div>
        </div>
        <Nav
          icon={<Smartphone size={18} />}
          label="Phone calls"
          active={view === "companion"}
          onClick={() => setView("companion")}
          badge={
            companion?.connected
              ? { text: "Linked", tone: "ok" }
              : ipChanged
                ? { text: "New IP", tone: "warn" }
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
          <div className="page-title">{heading}</div>
          <div style={{ color: "var(--muted)" }}>
            {view === "contacts"
              ? "Search contacts, dial favorites, or redial from Recents."
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
            className="panel fade-in status-toast"
            style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}
          >
            {statusMsg}
          </div>
        ) : null}

        {activeCall ? (
          <div
            className={`call-banner call-banner-${activeCall.phase} fade-in`}
            role="status"
            aria-live="polite"
            style={{ marginBottom: "1rem", maxWidth: 960 }}
          >
            <div className="call-banner-pulse" aria-hidden />
            <div className="call-banner-body">
              <div className="call-banner-title">
                {activeCall.phase === "dialing"
                  ? "Calling…"
                  : activeCall.phase === "sent"
                    ? "On your phone"
                    : activeCall.phase === "ended"
                      ? "Call ended"
                      : "Call failed"}
              </div>
              <div className="call-banner-detail">
                <strong>{activeCall.name}</strong>
                {activeCall.name !== activeCall.number && activeCall.number ? (
                  <>
                    {" "}
                    · <code>{activeCall.number}</code>
                  </>
                ) : null}
                {activeCall.detail ? (
                  <>
                    <br />
                    <span>{activeCall.detail}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="call-banner-actions">
              {activeCall.phase === "dialing" || activeCall.phase === "sent" ? (
                <button className="btn btn-danger" disabled={busy} onClick={() => void hangUp()}>
                  Hang up
                </button>
              ) : null}
              {activeCall.phase !== "dialing" ? (
                <button className="btn btn-ghost" onClick={() => setActiveCall(null)}>
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {view === "companion" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "1rem", maxWidth: 520 }}>
            <EasyLinkStatus
              connected={!!companion?.connected}
              currentHost={currentHost}
              savedHost={savedHost || null}
              lastError={companion?.lastError ?? null}
            />

            <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.45 }}>
              Easiest: tap <strong>Show QR to pair</strong>, then on the phone tap{" "}
              <strong>Scan PC QR</strong>. Phone and PC must be on the same office network
              (LAN + same Wi‑Fi router is OK).
            </p>

            {qrSession ? (
              <div
                className="easy-status easy-status-ok"
                style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}
              >
                <div className="easy-status-title">Scan with phone</div>
                <QRCodeSVG value={qrSession.qrPayload} size={220} level="M" includeMargin />
                <div className="easy-status-detail">
                  On the phone: <strong>Scan PC QR</strong>. Waiting for scan…
                  <br />
                  PC IPs: {qrSession.offer.h.join(", ")}
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    await api.stopQrPairing();
                    setQrSession(null);
                  }}
                >
                  Cancel QR
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                style={{ minHeight: 52, fontSize: "1.05rem" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await api.startQrPairing();
                  setBusy(false);
                  if (!res.ok) return setError(res.error ?? null);
                  setQrSession(res.data ?? null);
                  setStatusMsg("Show this QR to the phone app → Scan PC QR");
                }}
              >
                Show QR to pair
              </button>
            )}

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem", fontWeight: 600 }}>
                Or enter Phone IP manually
              </span>
              <input
                className="field"
                value={companionHost}
                onChange={(e) => {
                  setCompanionHost(e.target.value);
                  if (companion?.lastError) {
                    setCompanion((prev) =>
                      prev ? { ...prev, lastError: null } : prev,
                    );
                  }
                }}
                placeholder="e.g. 192.168.1.9"
              />
              {ipChanged ? (
                <span style={{ color: "var(--accent)", fontSize: "0.85rem" }}>
                  IP changed from <code>{savedHost}</code> — tap <strong>Connect for phone calls</strong>{" "}
                  to use <code>{currentHost}</code>.
                </span>
              ) : null}
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, minWidth: 200, minHeight: 52, fontSize: "1.05rem" }}
                disabled={busy || !currentHost}
                onClick={() => void connectCompanion(currentHost)}
              >
                Connect for phone calls
              </button>
              <button
                className="btn"
                style={{ minHeight: 52 }}
                disabled={busy}
                onClick={async () => {
                  const result = await discoverPhone(true);
                  if (!result.ok) return setError(result.error ?? null);
                  setStatusMsg(
                    result.devices.length
                      ? `Found ${result.devices.length} phone(s) — IP filled in`
                      : "No phone found — tap Start for calls on the phone first",
                  );
                }}
              >
                Find phone on network
              </button>
            </div>

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
                      const result = await discoverPhone(true);
                      if (!result.ok) return setError(result.error ?? null);
                      setStatusMsg(
                        result.devices.length
                          ? `Found ${result.devices.length} phone(s)`
                          : "No phone found — tap Start for calls on the phone first",
                      );
                    }}
                  >
                    Refresh discovery
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
          <div className="contacts-layout fade-in">
            <div className="panel contacts-main" style={{ padding: "1.25rem", display: "grid", gap: "0.85rem" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  className="field"
                  style={{ flex: 1, minWidth: 180 }}
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search name or number"
                  disabled={activeCall?.phase === "dialing"}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy || !companionHost.trim() || activeCall?.phase === "dialing"}
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
              <div className="contacts-list">
                {filteredContacts.map((c) => {
                  const primary = c.phones[0] ?? "";
                  const isThis =
                    activeCall &&
                    (activeCall.number === primary || activeCall.name === c.name);
                  const dialingThis = isThis && activeCall.phase === "dialing";
                  const starred = favoriteIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={dialingThis ? "contact-row contact-row-calling" : "contact-row"}
                    >
                      <button
                        type="button"
                        className={`star-btn${starred ? " is-on" : ""}`}
                        aria-label={starred ? "Remove favorite" : "Add favorite"}
                        title={starred ? "Remove favorite" : "Add favorite"}
                        disabled={!primary}
                        onClick={() => void toggleFavorite(c.id, c.name, primary)}
                      >
                        <Star size={16} fill={starred ? "currentColor" : "none"} />
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                          {c.phones.join(" · ")}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        disabled={busy || !primary || activeCall?.phase === "dialing"}
                        onClick={() => void callNumber(primary, c.name)}
                      >
                        {dialingThis ? "Calling…" : "Call"}
                      </button>
                    </div>
                  );
                })}
                {filteredContacts.length === 0 && (contactsCache.contacts?.length ?? 0) > 0 ? (
                  <p style={{ color: "var(--muted)" }}>No matches for “{contactQuery}”.</p>
                ) : null}
              </div>
            </div>

            <div className="contacts-side">
              <section className="panel side-panel">
                <div className="side-panel-head">
                  <h3>Favorites</h3>
                </div>
                {favorites.favorites.length === 0 ? (
                  <p className="side-empty">Star contacts in the list to pin them here.</p>
                ) : (
                  <div className="side-list">
                    {favorites.favorites.map((f) => (
                      <div key={f.id} className="side-row">
                        <div className="side-row-text">
                          <strong>{f.name}</strong>
                          <span>{f.number}</span>
                        </div>
                        <button
                          className="btn btn-primary btn-compact"
                          disabled={busy || activeCall?.phase === "dialing"}
                          onClick={() => void callNumber(f.number, f.name)}
                        >
                          Call
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel side-panel">
                <div className="side-panel-head">
                  <h3>Recents</h3>
                  {callHistory.entries.length > 0 ? (
                    <button className="btn btn-ghost btn-compact" onClick={() => void clearHistory()}>
                      Clear
                    </button>
                  ) : null}
                </div>
                {callHistory.entries.length === 0 ? (
                  <p className="side-empty">Calls you place from Aspera appear here.</p>
                ) : (
                  <div className="side-list">
                    {callHistory.entries.slice(0, 30).map((e) => (
                      <div key={e.id} className="side-row">
                        <div className="side-row-text">
                          <strong>{e.name || e.number}</strong>
                          <span>
                            {e.number}
                            {" · "}
                            {formatRecentTime(e.at)}
                            {" · "}
                            {e.outcome}
                          </span>
                        </div>
                        <button
                          className="btn btn-compact"
                          disabled={busy || !e.number || activeCall?.phase === "dialing"}
                          onClick={() => void callNumber(e.number, e.name)}
                        >
                          Call
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
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
            <h3 style={{ marginTop: 0 }}>Quick start</h3>
            <ol>
              <li>
                Phone: open Aspera Connect → <strong>Start for calls</strong> (allow Phone + Answer calls +
                Contacts).
              </li>
              <li>
                PC: enter the phone IP → <strong>Connect for phone calls</strong> (auto-syncs contacts).
              </li>
              <li>
                Open <strong>Contacts</strong>, search, tap <strong>Call</strong> — or use Favorites /
                Recents.
              </li>
              <li>
                Use <strong>Hang up</strong> on the banner to end the call from the PC.
              </li>
              <li>
                Optional: register <code>tel:</code> for Zoho / browser links (app must stay connected).
              </li>
            </ol>
            <h3>Common problems</h3>
            <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
              <li>
                <strong>Can&apos;t connect</strong> — same Wi‑Fi band on PC and phone (2.4 vs 5 GHz); phone
                shows <strong>Start for calls</strong>; try <strong>Find phone on network</strong>.
              </li>
              <li>
                <strong>Clipboard call fails</strong> — Linux Mint: <code>sudo apt install xclip</code>.
                KDE: <code>sudo apt install wl-clipboard</code>.
              </li>
              <li>
                <strong>Phone stops listening</strong> — battery optimization off for Aspera Connect; reopen
                app and tap Start for calls.
              </li>
              <li>
                <strong>No contacts</strong> — allow Contacts on phone, then Connect or Sync from phone.
              </li>
              <li>
                <strong>Zoho link does nothing</strong> — register tel handler once; keep PC app open and
                Linked.
              </li>
            </ul>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              Full troubleshooting list ships with the installer as <code>TROUBLESHOOTING.txt</code>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function formatRecentTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
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
  currentHost,
  savedHost,
  lastError,
}: {
  connected: boolean;
  currentHost: string;
  savedHost: string | null;
  lastError: string | null;
}) {
  if (connected) {
    return (
      <div className="easy-status easy-status-ok" role="status">
        <div className="easy-status-title">Connected</div>
        <div className="easy-status-detail">
          Phone ready at <code>{currentHost}</code>. Hub click-to-call works.
        </div>
      </div>
    );
  }
  if (lastError) {
    const dualBandHint = isNetworkReachabilityError(lastError)
      ? " Dual-band Wi‑Fi (2.4 GHz vs 5 GHz) often uses different IPs — put PC and phone on the same band, use Find phone on network, or copy the IP from the phone app."
      : "";
    return (
      <div className="easy-status easy-status-bad" role="status">
        <div className="easy-status-title">Not connected</div>
        <div className="easy-status-detail">
          {lastError}
          {dualBandHint}
        </div>
      </div>
    );
  }
  if (
    savedHost &&
    currentHost &&
    savedHost !== currentHost
  ) {
    return (
      <div className="easy-status easy-status-warn" role="status">
        <div className="easy-status-title">Phone IP changed</div>
        <div className="easy-status-detail">
          Saved IP was <code>{savedHost}</code>. Tap <strong>Connect for phone calls</strong> with{" "}
          <code>{currentHost}</code> (from the phone app).
        </div>
      </div>
    );
  }
  if (savedHost) {
    return (
      <div className="easy-status easy-status-warn" role="status">
        <div className="easy-status-title">Not connected yet</div>
        <div className="easy-status-detail">
          Phone IP <code>{savedHost}</code> is saved. Tap <strong>Connect for phone calls</strong>{" "}
          (phone must show <strong>Start for calls</strong>).
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

function isNetworkReachabilityError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("unreachable") ||
    lower.includes("no route") ||
    lower.includes("timed out") ||
    lower.includes("cannot reach")
  );
}

function discoveryHintForError(msg: string): string | null {
  if (!isNetworkReachabilityError(msg)) return null;
  return "If you switched Wi‑Fi bands (2.4 vs 5 GHz), use Find phone on network or the IP shown on the phone.";
}
