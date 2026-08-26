import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Bell,
  Cable,
  FolderUp,
  HelpCircle,
  Home,
  Image,
  LayoutGrid,
  MessageSquare,
  Radio,
  Settings,
  Share2,
  Smartphone,
  Wifi,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "./lib/api";
import { locales, t } from "./lib/i18n";
import type {
  AppConfig,
  AppView,
  CompanionSessionState,
  Device,
  KdeStatus,
  MirrorHandle,
  MirrorProfile,
  MirrorProfileId,
  PhoneApp,
  PhoneNotification,
  SetupReport,
  ToolsReport,
  UserFacingError,
} from "./lib/types";
import { ErrorBanner } from "./components/ErrorBanner";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { PhoneBezel } from "./components/PhoneBezel";
import {
  DropZone,
  NotificationsPanel,
  SetupDoctorPanel,
  useTauriFileDrop,
} from "./components/RoadmapFeatures";
import { resolveSkinIdentity } from "./lib/skins";
import "./styles/app.css";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tools, setTools] = useState<ToolsReport | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<MirrorProfile[]>([]);
  const [mirrors, setMirrors] = useState<MirrorHandle[]>([]);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AppView>("home");
  const [kde, setKde] = useState<KdeStatus | null>(null);
  const [companion, setCompanion] = useState<CompanionSessionState | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [pairHost, setPairHost] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectHost, setConnectHost] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [shareText, setShareText] = useState("");
  const [smsNumber, setSmsNumber] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [callNumber, setCallNumber] = useState("");
  const [callDirect, setCallDirect] = useState(true);
  const [companionHost, setCompanionHost] = useState("192.168.1.20");
  const [companionName, setCompanionName] = useState("My Phone");
  const [companionPin, setCompanionPin] = useState("");
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [setupReport, setSetupReport] = useState<SetupReport | null>(null);
  const [discoveredCompanions, setDiscoveredCompanions] = useState<
    import("./lib/types").CompanionDevice[]
  >([]);
  const [phoneApps, setPhoneApps] = useState<PhoneApp[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [kdeShareText, setKdeShareText] = useState("");

  const locale = config?.locale ?? "en";
  const selectedDevice = useMemo(
    () => devices.find((d) => d.serial === selected) ?? null,
    [devices, selected],
  );

  const bootstrap = useCallback(async () => {
    const [cfg, toolReport, profileList] = await Promise.all([
      api.getConfig(),
      api.getTools(),
      api.listProfiles(),
    ]);
    setConfig(cfg);
    setTools(toolReport);
    setProfiles(profileList);
    setCompanionPin(cfg.companionPin ?? "");
    if (cfg.companionHost) setCompanionHost(cfg.companionHost);
    if (cfg.companionName) setCompanionName(cfg.companionName);
    if (cfg.lastDeviceSerial) setSelected(cfg.lastDeviceSerial);
    if (cfg.knownWirelessEndpoints[0]) {
      setConnectHost(cfg.knownWirelessEndpoints[0]);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const res = await api.listDevices();
    if (!res.ok) {
      setError(res.error ?? null);
      setDevices([]);
      return;
    }
    setError(null);
    setDevices(res.data ?? []);
    const list = res.data ?? [];
    setSelected((prev) => {
      if (prev && list.some((d) => d.serial === prev)) return prev;
      const last = config?.lastDeviceSerial;
      if (last && list.some((d) => d.serial === last)) return last;
      const ready = list.find((d) => d.state === "device");
      return (ready ?? list[0])?.serial ?? null;
    });
    const m = await api.listMirrors();
    setMirrors(m);
  }, [config?.lastDeviceSerial]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (config?.firstRunCompleted) {
      void refreshDevices();
      const id = window.setInterval(() => void refreshDevices(), 4000);
      return () => window.clearInterval(id);
    }
  }, [config?.firstRunCompleted, refreshDevices]);

  useEffect(() => {
    let unlistenMirror: (() => void) | undefined;
    let unlistenCall: (() => void) | undefined;
    let unlistenClip: (() => void) | undefined;
    void listen("tray://mirror-last", () => {
      void onMirror();
    }).then((fn) => {
      unlistenMirror = fn;
    });
    void listen<string>("aspera://call", (ev) => {
      setCallNumber(ev.payload);
      setView("home");
      void (async () => {
        const res = await api.placeCall({
          number: ev.payload,
          serial: selected,
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
                code: "call",
                title: "No number in clipboard",
                message: "Copy a phone number first, then use Call from clipboard.",
                hint: null,
              },
            );
            return;
          }
          setCallNumber(parsed.data);
          setView("home");
          const res = await api.placeCall({
            number: parsed.data,
            serial: selected,
            direct: true,
          });
          if (!res.ok) setError(res.error ?? null);
          else setStatusMsg(res.data ?? `Calling ${parsed.data}`);
        } catch {
          setError({
            code: "clipboard",
            title: "Clipboard read failed",
            message: "Allow clipboard access or paste the number into Call on Home.",
            hint: null,
          });
        }
      })();
    }).then((fn) => {
      unlistenClip = fn;
    });
    void api.takePendingCall().then((n) => {
      if (n) {
        setCallNumber(n);
        setView("home");
      }
    });
    return () => {
      unlistenMirror?.();
      unlistenCall?.();
      unlistenClip?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, config]);

  useEffect(() => {
    if (!config?.firstRunCompleted) return;
    void api.listNotifications().then(setNotifications);
    let unlisten: (() => void) | undefined;
    void listen<PhoneNotification>("notifications://new", (ev) => {
      setNotifications((prev) => [ev.payload, ...prev.filter((n) => n.id !== ev.payload.id)]);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [config?.firstRunCompleted]);

  useEffect(() => {
    if (view === "settings") {
      void api.getSetupReport().then(setSetupReport);
    }
    if (view === "notifications" || view === "sms" || view === "kde") {
      void api.kdeStatus().then(setKde);
    }
  }, [view]);

  const handleFileDrop = useCallback(
    async (paths: string[]) => {
      if (!selected || !paths.length) return;
      setBusy(true);
      setStatusMsg(null);
      const apks = paths.filter((p) => p.toLowerCase().endsWith(".apk"));
      const files = paths.filter((p) => !p.toLowerCase().endsWith(".apk"));
      for (const apk of apks) {
        const res = await api.installApk(selected, apk);
        if (!res.ok) {
          setError(res.error ?? null);
          setBusy(false);
          return;
        }
      }
      if (files.length) {
        const res = await api.pushFiles(selected, files);
        if (!res.ok) {
          setError(res.error ?? null);
          setBusy(false);
          return;
        }
      }
      setBusy(false);
      setError(null);
      setStatusMsg(
        apks.length && files.length
          ? `Installed ${apks.length} APK(s) and pushed ${files.length} file(s).`
          : apks.length
            ? `Installed ${apks.length} APK(s).`
            : `Pushed ${files.length} file(s) to phone.`,
      );
    },
    [selected],
  );

  useTauriFileDrop((paths) => void handleFileDrop(paths), !!selected && !!config?.firstRunCompleted);

  async function onMirror(profileOverride?: MirrorProfileId) {
    if (!selected || !config) return;
    setBusy(true);
    setStatusMsg(null);
    const profileId = profileOverride ?? config.preferredProfile;
    const turnScreenOff =
      profileId === "meetings" ? true : config.turnScreenOff;
    const res = await api.startMirror({
      serial: selected,
      profileId,
      turnScreenOff,
      stayAwake: config.stayAwake,
      showTouches: config.showTouches,
      fullscreen: false,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setError(null);
    if (profileOverride === "meetings") {
      await persistConfig({
        ...config,
        preferredProfile: "meetings",
        turnScreenOff: true,
      });
    }
    const audioNote = config.forwardAudio !== false ? " Phone audio plays on PC." : "";
    const recNote = config.recordMirror ? " Recording to Videos/aspera-connect-recordings." : "";
    const meetingsNote =
      profileId === "meetings" ? " Meetings mode: screen off + audio on PC." : "";
    setStatusMsg(`Mirror started — use the scrcpy window.${meetingsNote}${audioNote}${recNote}`);
    await refreshDevices();
  }

  async function onOpenApp(packageName: string) {
    if (!selected) return;
    setBusy(true);
    setStatusMsg(null);
    const res = await api.startAppWindow(selected, packageName, true);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setError(null);
    setStatusMsg(`App window started for ${packageName} (virtual display).`);
    await refreshDevices();
  }

  async function loadPhoneApps() {
    if (!selected) return;
    setBusy(true);
    const res = await api.listPhoneApps(selected);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setPhoneApps(res.data ?? []);
  }

  async function onStopAll() {
    setBusy(true);
    await api.stopAllMirrors();
    setBusy(false);
    setStatusMsg("All mirrors stopped.");
    await refreshDevices();
  }

  async function persistConfig(next: AppConfig) {
    setConfig(next);
    await api.saveConfig(next);
  }

  if (!config) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%" }} className="brand">
        Loading Aspera Connect…
      </div>
    );
  }

  if (!config.firstRunCompleted) {
    return (
      <FirstRunWizard
        tools={tools}
        onContinue={async () => {
          const next = await api.completeFirstRun();
          setConfig(next);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
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
          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Linux ↔ Android</div>
        </div>
        <Nav icon={<Home size={18} />} label={t(locale, "home")} active={view === "home"} onClick={() => setView("home")} />
        <Nav icon={<LayoutGrid size={18} />} label="Apps" active={view === "apps"} onClick={() => { setView("apps"); void loadPhoneApps(); }} />
        <Nav icon={<Bell size={18} />} label="Notifications" active={view === "notifications"} onClick={() => { setView("notifications"); void api.listNotifications().then(setNotifications); }} />
        <Nav icon={<Wifi size={18} />} label={t(locale, "wireless")} active={view === "wireless"} onClick={() => setView("wireless")} />
        <Nav icon={<FolderUp size={18} />} label={t(locale, "files")} active={view === "files"} onClick={() => setView("files")} />
        <Nav icon={<Image size={18} />} label={t(locale, "photos")} active={view === "photos"} onClick={() => setView("photos")} />
        <Nav icon={<Share2 size={18} />} label={t(locale, "share")} active={view === "share"} onClick={() => setView("share")} />
        <Nav icon={<MessageSquare size={18} />} label={t(locale, "sms")} active={view === "sms"} onClick={() => { setView("sms"); void api.kdeStatus().then(setKde); }} />
        <Nav icon={<Smartphone size={18} />} label={t(locale, "companion")} active={view === "companion"} onClick={() => setView("companion")} />
        <Nav icon={<Radio size={18} />} label={t(locale, "kde")} active={view === "kde"} onClick={() => { setView("kde"); void api.kdeStatus().then(setKde); }} />
        <Nav icon={<Settings size={18} />} label={t(locale, "settings")} active={view === "settings"} onClick={() => setView("settings")} />
        <Nav icon={<HelpCircle size={18} />} label={t(locale, "help")} active={view === "help"} onClick={() => setView("help")} />
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.8rem" }}>
          Free forever · Apache-2.0
        </div>
      </aside>

      <main style={{ padding: "1.25rem 1.5rem", overflow: "auto", minWidth: 0 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <div className="brand" style={{ fontSize: "1.8rem" }}>
              {headingFor(view, locale)}
            </div>
            <div style={{ color: "var(--muted)" }}>{t(locale, "tagline")}</div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => void refreshDevices()} disabled={busy}>
              {t(locale, "refresh")}
            </button>
            <button className="btn btn-primary" onClick={() => void onMirror()} disabled={busy || !selected}>
              {t(locale, "startMirror")}
            </button>
          </div>
        </header>

        {error ? <div style={{ marginBottom: "1rem" }}><ErrorBanner error={error} onDismiss={() => setError(null)} /></div> : null}
        {statusMsg ? (
          <div className="panel fade-in" style={{ padding: "0.85rem 1rem", marginBottom: "1rem", color: "var(--accent)" }}>
            {statusMsg}
          </div>
        ) : null}

        {view === "notifications" && (
          <NotificationsPanel
            notifications={notifications}
            onRefresh={() => void api.listNotifications().then(setNotifications)}
            onClear={() => void api.clearNotifications().then(() => setNotifications([]))}
            onMarkRead={(id) => {
              void api.markNotificationRead(id);
              setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
              );
            }}
            onPullKde={
              kde?.available && kde.devices[0]
                ? () => {
                    const id = kde.devices.find((d) => d.reachable)?.id ?? kde.devices[0].id;
                    void api.kdePullNotifications(id).then((res) => {
                      if (!res.ok) return setError(res.error ?? null);
                      void api.listNotifications().then(setNotifications);
                      setStatusMsg(`Pulled ${res.data?.length ?? 0} KDE notification(s).`);
                    });
                  }
                : undefined
            }
          />
        )}

        {view === "apps" && !selected && (
          <div className="panel fade-in" style={{ padding: "1.25rem", color: "var(--muted)" }}>
            Connect a phone (USB or wireless) to open apps in their own windows.
          </div>
        )}

        {view === "apps" && selected && (
          <AppsView
            apps={phoneApps}
            search={appSearch}
            setSearch={setAppSearch}
            favorites={config.favoriteApps ?? []}
            busy={busy}
            onReload={() => void loadPhoneApps()}
            onOpen={(pkg) => void onOpenApp(pkg)}
            onToggleFavorite={async (pkg) => {
              const favs = new Set(config.favoriteApps ?? []);
              if (favs.has(pkg)) favs.delete(pkg);
              else favs.add(pkg);
              const next = await api.setFavoriteApps([...favs]);
              setConfig(next);
            }}
          />
        )}

        {view === "home" && (
          <HomeView
            devices={devices}
            selected={selected}
            setSelected={setSelected}
            selectedDevice={selectedDevice}
            mirrors={mirrors}
            tools={tools}
            config={config}
            onMirror={() => void onMirror()}
            onMeetings={() => void onMirror("meetings")}
            onOpenApps={() => {
              setView("apps");
              void loadPhoneApps();
            }}
            onSms={() => {
              setView("sms");
              void api.kdeStatus().then(setKde);
            }}
            onStopAll={() => void onStopAll()}
            onNickname={async (serial, nickname) => {
              const next = await api.setDeviceNickname(serial, nickname);
              setConfig(next);
            }}
            onPushClipboard={async () => {
              if (!selected) return;
              const res = await api.getDeviceClipboard(selected);
              if (res.ok && res.data) {
                await navigator.clipboard.writeText(res.data);
                setStatusMsg("Phone clipboard copied to PC.");
              }
            }}
            onOpenFavorite={(pkg) => void onOpenApp(pkg)}
            callNumber={callNumber}
            setCallNumber={setCallNumber}
            callDirect={callDirect}
            setCallDirect={setCallDirect}
            onCall={async () => {
              if (!callNumber.trim()) return;
              setBusy(true);
              const res = await api.placeCall({
                number: callNumber,
                serial: selected,
                direct: callDirect,
              });
              setBusy(false);
              if (!res.ok) return setError(res.error ?? null);
              setStatusMsg(res.data ?? "Calling…");
            }}
            onCallClipboard={async () => {
              try {
                const text = await navigator.clipboard.readText();
                const parsed = await api.parseCallUri(text.trim());
                if (!parsed.ok || !parsed.data) {
                  return setError(parsed.error ?? null);
                }
                setCallNumber(parsed.data);
                setBusy(true);
                const res = await api.placeCall({
                  number: parsed.data,
                  serial: selected,
                  direct: callDirect,
                });
                setBusy(false);
                if (!res.ok) return setError(res.error ?? null);
                setStatusMsg(res.data ?? `Calling ${parsed.data}`);
              } catch {
                setError({
                  code: "clipboard",
                  title: "Clipboard read failed",
                  message: "Paste the number into the Call field instead.",
                  hint: null,
                });
              }
            }}
            onOpenPhone={async () => {
              const res = await api.openPhoneApp(selected);
              if (!res.ok) return setError(res.error ?? null);
              setStatusMsg(res.data ?? "Phone app opened");
            }}
            onRegisterTel={async () => {
              const res = await api.registerTelHandler();
              if (!res.ok) return setError(res.error ?? null);
              setStatusMsg(res.data ?? "tel: handler registered");
            }}
            busy={busy}
            locale={locale}
          />
        )}

        {view === "wireless" && (
          <WirelessView
            pairHost={pairHost}
            setPairHost={setPairHost}
            pairCode={pairCode}
            setPairCode={setPairCode}
            connectHost={connectHost}
            setConnectHost={setConnectHost}
            qrPayload={qrPayload}
            known={config.knownWirelessEndpoints}
            onPair={async () => {
              setBusy(true);
              const res = await api.pairWireless(pairHost, pairCode);
              setBusy(false);
              if (!res.ok) return setError(res.error ?? null);
              setStatusMsg(res.data?.message ?? "Paired");
              const [host, portStr] = pairHost.split(":");
              if (host && portStr) {
                const payload = await api.buildWirelessQr(host, Number(portStr), pairCode);
                setQrPayload(payload);
              }
            }}
            onConnect={async () => {
              setBusy(true);
              const res = await api.connectWireless(connectHost);
              setBusy(false);
              if (!res.ok) return setError(res.error ?? null);
              setStatusMsg(res.data?.message ?? "Connected");
              await refreshDevices();
            }}
          />
        )}

        {view === "files" && selected && (
          <FilesView
            serial={selected}
            onError={setError}
            onStatus={setStatusMsg}
          />
        )}

        {view === "photos" && selected && (
          <PhotosView
            serial={selected}
            onError={setError}
            onStatus={setStatusMsg}
          />
        )}

        {view === "share" && selected && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              On OnePlus and many phones, ADB cannot read/write the clipboard.
              Prefer <strong style={{ color: "var(--ink)" }}>Start mirror</strong> with clipboard sync on:
              copy on the phone → paste on the PC (<kbd>Ctrl+V</kbd>), and the other way around in the scrcpy window.
            </p>
            <label>
              Share text to phone
              <textarea className="field" rows={4} value={shareText} onChange={(e) => setShareText(e.target.value)} style={{ marginTop: 6 }} />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const res = await api.shareTextToPhone(selected, shareText);
                  if (!res.ok) return setError(res.error ?? null);
                  setStatusMsg("Share sheet opened on phone");
                }}
              >
                Open share sheet
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const res = await api.setDeviceClipboard(selected, shareText);
                  if (!res.ok) return setError(res.error ?? null);
                  setStatusMsg("Clipboard send attempted");
                }}
              >
                Send to clipboard
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const res = await api.getDeviceClipboard(selected);
                  if (!res.ok) return setError(res.error ?? null);
                  setShareText(res.data ?? "");
                  setStatusMsg("Pulled clipboard");
                }}
              >
                Pull clipboard
              </button>
            </div>
          </div>
        )}

        {view === "sms" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem", maxWidth: 560 }}>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Sends via KDE Connect when paired; otherwise opens the SMS composer on the phone (ADB).
            </p>
            {kde?.available ? (
              <div style={{ color: "var(--accent)", fontSize: "0.9rem" }}>
                KDE Connect ready
                {kde.devices.find((d) => d.reachable)
                  ? ` — ${kde.devices.find((d) => d.reachable)!.name}`
                  : " — no reachable device (will use phone composer)"}
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                {kde?.hint ?? "Install kdeconnect for direct SMS send from the PC."}
              </div>
            )}
            <input className="field" placeholder="Phone number" value={smsNumber} onChange={(e) => setSmsNumber(e.target.value)} />
            <textarea className="field" rows={4} placeholder="Message" value={smsBody} onChange={(e) => setSmsBody(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={!smsNumber.trim() || !smsBody.trim()}
              onClick={async () => {
                const kdeId = kde?.devices.find((d) => d.reachable)?.id ?? null;
                const res = await api.sendSmsSmart({
                  number: smsNumber,
                  body: smsBody,
                  serial: selected,
                  kdeDeviceId: kdeId,
                });
                if (!res.ok) return setError(res.error ?? null);
                setStatusMsg(res.data ?? "SMS sent");
              }}
            >
              Send SMS
            </button>
            {selected ? (
              <button
                className="btn"
                onClick={async () => {
                  const res = await api.composeSms(selected, smsNumber, smsBody);
                  if (!res.ok) return setError(res.error ?? null);
                  setStatusMsg("SMS composer opened on phone");
                }}
              >
                Open composer on phone only
              </button>
            ) : null}
          </div>
        )}

        {view === "companion" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.85rem", maxWidth: 640 }}>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Easy mode — no Developer Options. Install the companion APK (
              <code>apps/android</code>), tap <strong>Listen for PC</strong>, then connect here on the same Wi‑Fi.
              Hub / Zoho <code>tel:</code> calls use this path when USB debugging is off.
            </p>
            <input className="field" value={companionName} onChange={(e) => setCompanionName(e.target.value)} placeholder="Phone name" />
            <input className="field" value={companionHost} onChange={(e) => setCompanionHost(e.target.value)} placeholder="Phone IP" />
            <input className="field" value={companionPin} onChange={(e) => setCompanionPin(e.target.value)} placeholder="Optional PIN" />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
                      ? `Found ${res.data.length} device(s) via mDNS.`
                      : "No devices found — open Aspera Connect on your phone → Listen for PC.",
                  );
                }}
              >
                Scan LAN (mDNS)
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const next = await api.setCompanionPin(companionPin);
                  setConfig(next);
                  setStatusMsg("Companion PIN saved");
                }}
              >
                Save PIN
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const res = await api.companionHello(companionHost, companionName, companionPin || undefined);
                  if (!res.ok) return setError(res.error ?? null);
                  setCompanion(res.data ?? null);
                  setConfig(await api.getConfig());
                  setStatusMsg("Easy mode linked — Hub click-to-call can use this phone");
                }}
              >
                Connect Easy mode
              </button>
              <button
                className="btn"
                onClick={async () => setCompanion(await api.getCompanionState())}
              >
                Refresh state
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="field"
                style={{ flex: 1, minWidth: 160 }}
                value={callNumber}
                onChange={(e) => setCallNumber(e.target.value)}
                placeholder="Test number"
              />
              <button
                className="btn btn-primary"
                disabled={busy || !callNumber.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await api.companionPlaceCall({
                    number: callNumber,
                    host: companionHost,
                    direct: callDirect,
                  });
                  setBusy(false);
                  if (!res.ok) return setError(res.error ?? null);
                  setStatusMsg(res.data ?? "Call sent via companion");
                }}
              >
                Test call via companion
              </button>
            </div>
            {discoveredCompanions.length ? (
              <div style={{ display: "grid", gap: 6 }}>
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
                    {d.name} — {d.host}:{d.port}
                  </button>
                ))}
              </div>
            ) : null}
            {companion ? (
              <pre style={{ background: "rgba(0,0,0,0.25)", padding: "0.85rem", borderRadius: 12, overflow: "auto" }}>
                {JSON.stringify(companion, null, 2)}
              </pre>
            ) : null}
          </div>
        )}

        {view === "kde" && (
          <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
            {!kde?.available ? (
              <p style={{ color: "var(--accent-2)" }}>{kde?.hint ?? "KDE Connect CLI not found"}</p>
            ) : (
              <>
                <label>
                  Share text to phone
                  <textarea
                    className="field"
                    rows={2}
                    style={{ marginTop: 6 }}
                    value={kdeShareText}
                    onChange={(e) => setKdeShareText(e.target.value)}
                    placeholder="Paste a link or note…"
                  />
                </label>
                {(kde.devices ?? []).map((d) => (
                  <div key={d.id} style={{ display: "grid", gap: 8, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                    <div>
                      <strong>{d.name}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {d.id}
                        {d.reachable ? " · reachable" : " · unreachable"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => void api.kdePing(d.id).then((r) => !r.ok && setError(r.error ?? null))}>Ping</button>
                      <button className="btn" onClick={() => void api.kdeRing(d.id).then((r) => !r.ok && setError(r.error ?? null))}>Ring</button>
                      <button
                        className="btn"
                        onClick={async () => {
                          const file = await open({ multiple: false });
                          if (!file || Array.isArray(file)) return;
                          const res = await api.kdeShare(d.id, file);
                          if (!res.ok) return setError(res.error ?? null);
                          setStatusMsg("File shared via KDE Connect");
                        }}
                      >
                        Share file
                      </button>
                      <button
                        className="btn"
                        disabled={!kdeShareText.trim()}
                        onClick={async () => {
                          const res = await api.kdeShareText(d.id, kdeShareText);
                          if (!res.ok) return setError(res.error ?? null);
                          setStatusMsg("Text shared via KDE Connect");
                        }}
                      >
                        Send text
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          const res = await api.kdePullNotifications(d.id);
                          if (!res.ok) return setError(res.error ?? null);
                          void api.listNotifications().then(setNotifications);
                          setStatusMsg(`Pulled ${res.data?.length ?? 0} notification(s)`);
                        }}
                      >
                        Pull notifications
                      </button>
                    </div>
                  </div>
                ))}
                {!kde.devices.length ? <p style={{ color: "var(--muted)" }}>No paired KDE Connect devices.</p> : null}
              </>
            )}
          </div>
        )}

        {view === "settings" && (
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
            <SettingsView
              config={config}
              profiles={profiles}
              onChange={(next) => void persistConfig(next)}
              onKillServer={async () => {
                await api.adbKillServer();
                await api.adbStartServer();
                setStatusMsg("ADB server restarted");
                await refreshDevices();
                void api.getSetupReport().then(setSetupReport);
              }}
            />
            <SetupDoctorPanel report={setupReport} />
          </div>
        )}

        {view === "help" && <HelpView />}
      </main>
    </div>
  );
}

function Nav({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className="nav-item" data-active={active} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function headingFor(view: AppView, locale: string) {
  switch (view) {
    case "home":
      return t(locale, "home");
    case "apps":
      return "Apps";
    case "notifications":
      return "Notifications";
    case "wireless":
      return t(locale, "wireless");
    case "files":
      return t(locale, "files");
    case "photos":
      return t(locale, "photos");
    case "share":
      return t(locale, "share");
    case "sms":
      return t(locale, "sms");
    case "companion":
      return t(locale, "companion");
    case "kde":
      return t(locale, "kde");
    case "settings":
      return t(locale, "settings");
    case "help":
      return t(locale, "help");
  }
}

function HomeView(props: {
  devices: Device[];
  selected: string | null;
  setSelected: (s: string) => void;
  selectedDevice: Device | null;
  mirrors: MirrorHandle[];
  tools: ToolsReport | null;
  config: AppConfig;
  onMirror: () => void;
  onMeetings: () => void;
  onOpenApps: () => void;
  onSms: () => void;
  onStopAll: () => void;
  onNickname: (serial: string, nickname: string) => void;
  onPushClipboard: () => void;
  onOpenFavorite: (pkg: string) => void;
  callNumber: string;
  setCallNumber: (v: string) => void;
  callDirect: boolean;
  setCallDirect: (v: boolean) => void;
  onCall: () => void;
  onCallClipboard: () => void;
  onOpenPhone: () => void;
  onRegisterTel: () => void;
  busy: boolean;
  locale: string;
}) {
  const {
    devices,
    selected,
    setSelected,
    selectedDevice,
    mirrors,
    tools,
    config,
    onMirror,
    onMeetings,
    onOpenApps,
    onSms,
    onStopAll,
    onNickname,
    onPushClipboard,
    onOpenFavorite,
    callNumber,
    setCallNumber,
    callDirect,
    setCallDirect,
    onCall,
    onCallClipboard,
    onOpenPhone,
    onRegisterTel,
    busy,
    locale,
  } = props;
  const mirroringSelected = !!selectedDevice && mirrors.some((m) => m.serial === selectedDevice.serial && m.running);
  const identity = resolveSkinIdentity(selectedDevice);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const favorites = (config.favoriteApps ?? []).slice(0, 6);

  useEffect(() => {
    if (selected) {
      setNicknameDraft(config.deviceNicknames?.[selected] ?? "");
    }
  }, [selected, config.deviceNicknames]);

  return (
    <div className="fade-in" style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1.05fr 0.95fr" }}>
      <section className="panel" style={{ padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
          <div className="pulse-dot" />
          <strong>Devices</strong>
        </div>
        <DropZone
          label="Drop files or APKs anywhere on the window to send to the selected phone"
          disabled={!selectedDevice || selectedDevice.state !== "device"}
          onDropPaths={() => {}}
        />
        {!devices.length ? (
          <div style={{ color: "var(--muted)" }}>
            <Cable style={{ marginBottom: 8 }} />
            <div>{t(locale, "noDevice")}</div>
            <div>{t(locale, "plugIn")}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {devices.map((d) => {
              const id = resolveSkinIdentity(d);
              return (
              <button
                key={d.serial}
                className="btn"
                data-active={selected === d.serial}
                onClick={() => setSelected(d.serial)}
                style={{
                  textAlign: "left",
                  borderColor: selected === d.serial ? "var(--accent)" : undefined,
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {config.deviceNicknames?.[d.serial] ?? id.marketName}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                  {d.serial} · {d.state} · {d.connection}
                  {d.battery != null ? ` · ${d.battery}%` : ""}
                  {d.androidVersion ? ` · Android ${d.androidVersion}` : ""}
                  {` · skin ${id.skinId}`}
                </div>
              </button>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: "1rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={busy || !selectedDevice || selectedDevice.state !== "device"} onClick={onMirror}>
            Mirror
          </button>
          <button className="btn" disabled={busy || !selectedDevice || selectedDevice.state !== "device"} onClick={onMeetings}>
            Meetings
          </button>
          <button className="btn" disabled={!selectedDevice || selectedDevice.state !== "device"} onClick={onOpenApps}>
            Open app…
          </button>
          <button className="btn" disabled={!selectedDevice} onClick={onSms}>
            SMS
          </button>
          <button className="btn" disabled={!mirrors.length} onClick={onStopAll}>
            Stop ({mirrors.length})
          </button>
          <button className="btn" disabled={!selectedDevice} onClick={onPushClipboard}>
            Copy clipboard
          </button>
        </div>

        <div
          className="panel"
          style={{
            marginTop: "1rem",
            padding: "0.85rem",
            display: "grid",
            gap: 8,
            background: "rgba(0,0,0,0.18)",
          }}
        >
          <strong>Call via phone</strong>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>
            Paste a CRM number, or register <code>tel:</code> so Zoho/browser phone links open here.
            Call audio uses your phone / BT neckband.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="field"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Phone number"
              value={callNumber}
              onChange={(e) => setCallNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCall();
              }}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !callNumber.trim() || !selectedDevice || selectedDevice.state !== "device"}
              onClick={onCall}
            >
              Call
            </button>
            <button
              className="btn"
              disabled={busy || !selectedDevice || selectedDevice.state !== "device"}
              onClick={onCallClipboard}
            >
              Call clipboard
            </button>
            <button
              className="btn"
              disabled={busy || !selectedDevice || selectedDevice.state !== "device"}
              onClick={onOpenPhone}
            >
              Open Phone
            </button>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={callDirect}
              onChange={(e) => setCallDirect(e.target.checked)}
            />
            Direct call (skip dialer confirm when OEM allows)
          </label>
          <button className="btn btn-ghost" style={{ justifySelf: "start" }} onClick={onRegisterTel}>
            Make Aspera handle tel: links (Zoho / browser)
          </button>
        </div>

        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>
          Clipboard sync while mirroring:{" "}
          <strong style={{ color: "var(--ink)" }}>
            {config.clipboardSync !== false ? "on" : "off"}
          </strong>
        </p>
        {favorites.length && selectedDevice?.state === "device" ? (
          <div style={{ marginTop: "0.85rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {favorites.map((pkg) => (
              <button
                key={pkg}
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => onOpenFavorite(pkg)}
                title={pkg}
              >
                {pkg.split(".").pop()}
              </button>
            ))}
          </div>
        ) : null}
        {selectedDevice ? (
          <div style={{ marginTop: "0.75rem", display: "flex", gap: 8 }}>
            <input
              className="field"
              placeholder="Device nickname"
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => selected && onNickname(selected, nicknameDraft)}
            >
              Save name
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem", alignContent: "start", justifyItems: "center" }}>
        <PhoneBezel
          identity={identity}
          battery={selectedDevice?.battery}
          androidVersion={selectedDevice?.androidVersion}
          connected={selectedDevice?.state === "device"}
          mirroring={mirroringSelected}
        />
        <div style={{ width: "100%", display: "grid", gap: "0.85rem" }}>
          <strong>Pro mode status</strong>
          <StatusLine ok={!!tools?.adb.found} label="adb" detail={tools?.adb.version ?? tools?.adb.installHint} />
          <StatusLine ok={!!tools?.scrcpy.found} label="scrcpy" detail={tools?.scrcpy.version ?? tools?.scrcpy.installHint} />
          <StatusLine ok={!!tools?.kdeconnect.found} label="kdeconnect-cli" detail={tools?.kdeconnect.found ? "share / SMS send" : "optional"} />
          <p style={{ color: "var(--muted)", marginBottom: 0 }}>
            Profile: <strong style={{ color: "var(--ink)" }}>{config.preferredProfile}</strong>
            {config.forwardAudio !== false ? " · audio on" : " · audio off"}
            {config.clipboardSync !== false ? " · clipboard on" : " · clipboard off"}
            {config.recordMirror ? " · recording" : ""}
          </p>
        </div>
      </section>
    </div>
  );
}

function AppsView({
  apps,
  search,
  setSearch,
  favorites,
  busy,
  onReload,
  onOpen,
  onToggleFavorite,
}: {
  apps: PhoneApp[];
  search: string;
  setSearch: (s: string) => void;
  favorites: string[];
  busy: boolean;
  onReload: () => void;
  onOpen: (pkg: string) => void;
  onToggleFavorite: (pkg: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = apps.filter(
    (a) =>
      !q ||
      a.label.toLowerCase().includes(q) ||
      a.package.toLowerCase().includes(q),
  );
  const favSet = new Set(favorites);
  const favApps = apps.filter((a) => favSet.has(a.package));

  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.85rem" }}>
      <p style={{ color: "var(--muted)", margin: 0 }}>
        Open a phone app in its own PC window (scrcpy virtual display — needs scrcpy 3.3+).
        Your phone screen stays free for calls and other apps.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="field"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Search apps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={onReload} disabled={busy}>
          Reload list
        </button>
      </div>
      {favApps.length ? (
        <div>
          <strong style={{ display: "block", marginBottom: 8 }}>Favorites</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {favApps.map((a) => (
              <button key={a.package} className="btn btn-primary" disabled={busy} onClick={() => onOpen(a.package)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!apps.length ? (
        <div style={{ color: "var(--muted)" }}>Load apps from the connected phone to pick one.</div>
      ) : (
        <div style={{ display: "grid", gap: 6, maxHeight: 420, overflow: "auto" }}>
          {filtered.map((a) => (
            <div key={a.package} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="btn"
                style={{ flex: 1, textAlign: "left" }}
                disabled={busy}
                onClick={() => onOpen(a.package)}
              >
                <div style={{ fontWeight: 700 }}>{a.label}</div>
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{a.package}</div>
              </button>
              <button className="btn" onClick={() => onToggleFavorite(a.package)} title="Toggle favorite">
                {favSet.has(a.package) ? "★" : "☆"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span>{label}</span>
      <span style={{ color: ok ? "var(--accent)" : "var(--danger)", textAlign: "right", maxWidth: "60%" }}>
        {ok ? "Ready" : "Missing"}
        {detail ? <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{detail}</div> : null}
      </span>
    </div>
  );
}

function WirelessView(props: {
  pairHost: string;
  setPairHost: (v: string) => void;
  pairCode: string;
  setPairCode: (v: string) => void;
  connectHost: string;
  setConnectHost: (v: string) => void;
  qrPayload: string;
  known: string[];
  onPair: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="fade-in" style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 280px" }}>
      <div className="panel" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>1. Pair (Android 11+ Wireless debugging)</h3>
        <input className="field" placeholder="IP:pairing_port" value={props.pairHost} onChange={(e) => props.setPairHost(e.target.value)} />
        <input className="field" placeholder="6-digit pairing code" value={props.pairCode} onChange={(e) => props.setPairCode(e.target.value)} />
        <button className="btn btn-primary" onClick={props.onPair}>Pair</button>

        <h3 style={{ margin: "0.5rem 0 0" }}>2. Connect</h3>
        <input className="field" placeholder="IP:connection_port" value={props.connectHost} onChange={(e) => props.setConnectHost(e.target.value)} />
        <button className="btn btn-primary" onClick={props.onConnect}>Connect</button>

        {props.known.length ? (
          <div>
            <div style={{ color: "var(--muted)", marginBottom: 6 }}>Recent</div>
            {props.known.map((k) => (
              <button key={k} className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left" }} onClick={() => props.setConnectHost(k)}>
                {k}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="panel" style={{ padding: "1.25rem", display: "grid", placeItems: "center", gap: 12 }}>
        {props.qrPayload ? (
          <>
            <QRCodeSVG value={props.qrPayload} size={180} bgColor="#0c1210" fgColor="#e8f0eb" />
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "center" }}>Pairing payload QR</div>
          </>
        ) : (
          <div style={{ color: "var(--muted)", textAlign: "center" }}>
            Pair once to generate a QR payload for your notes / companion flow.
          </div>
        )}
      </div>
    </div>
  );
}

function FilesView({
  serial,
  onError,
  onStatus,
}: {
  serial: string;
  onError: (e: UserFacingError | null) => void;
  onStatus: (s: string) => void;
}) {
  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>Push files to <code>/sdcard/Download</code> on the phone.</p>
      <DropZone
        label="Drop files or APKs here (or on the app window)"
        onDropPaths={async (paths) => {
          const apks = paths.filter((p) => p.toLowerCase().endsWith(".apk"));
          const files = paths.filter((p) => !p.toLowerCase().endsWith(".apk"));
          for (const apk of apks) {
            const res = await api.installApk(serial, apk);
            if (!res.ok) return onError(res.error ?? null);
          }
          if (files.length) {
            const res = await api.pushFiles(serial, files);
            if (!res.ok) return onError(res.error ?? null);
          }
          onStatus(`Sent ${paths.length} item(s) to phone.`);
        }}
      />
      <button
        className="btn btn-primary"
        onClick={async () => {
          const file = await open({ multiple: false });
          if (!file || Array.isArray(file)) return;
          const res = await api.pushFile(serial, file);
          if (!res.ok) return onError(res.error ?? null);
          onStatus(res.data ?? "Pushed");
        }}
      >
        Choose file to push
      </button>
    </div>
  );
}

function PhotosView({
  serial,
  onError,
  onStatus,
}: {
  serial: string;
  onError: (e: UserFacingError | null) => void;
  onStatus: (s: string) => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "camera" | "screenshots" | "other">("all");

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const res = await api.listPhotos(serial);
    setLoadingList(false);
    if (!res.ok) {
      onError(res.error ?? null);
      setPaths([]);
      return;
    }
    onError(null);
    setPaths(res.data ?? []);
    setPreviews({});
  }, [serial, onError]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Lazy-load previews for visible list (first 24)
  useEffect(() => {
    let cancelled = false;
    const toLoad = paths.slice(0, 24).filter((p) => !previews[p]);
    void (async () => {
      for (const remote of toLoad) {
        if (cancelled) return;
        const res = await api.readPhoto(serial, remote);
        if (cancelled) return;
        if (res.ok && res.data) {
          const url = `data:${res.data.mime};base64,${res.data.base64}`;
          setPreviews((prev) => ({ ...prev, [remote]: url }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, serial]);

  const filtered = paths.filter((p) => {
    if (filter === "all") return true;
    if (filter === "camera") return p.includes("/DCIM/Camera") || (p.includes("/DCIM/") && !p.includes("Screenshot"));
    if (filter === "screenshots") return p.toLowerCase().includes("screenshot");
    return !p.includes("/DCIM/Camera") && !p.toLowerCase().includes("screenshot");
  });

  async function ensurePreview(remote: string): Promise<string | null> {
    if (previews[remote]) return previews[remote];
    const res = await api.readPhoto(serial, remote);
    if (!res.ok || !res.data) {
      onError(res.error ?? null);
      return null;
    }
    const url = `data:${res.data.mime};base64,${res.data.base64}`;
    setPreviews((prev) => ({ ...prev, [remote]: url }));
    return url;
  }

  async function onCopy(remote: string) {
    setBusyPath(remote);
    const res = await api.copyPhotoToClipboard(serial, remote);
    setBusyPath(null);
    if (!res.ok) return onError(res.error ?? null);
    onStatus(res.data ?? "Copied to clipboard — paste with Ctrl+V");
  }

  async function onSave(remote: string) {
    const dest = await open({ directory: true, multiple: false });
    if (!dest || Array.isArray(dest)) return;
    const name = remote.split("/").pop() ?? "photo.jpg";
    setBusyPath(remote);
    const res = await api.pullFile(serial, remote, `${dest}/${name}`);
    setBusyPath(null);
    if (!res.ok) return onError(res.error ?? null);
    onStatus(`Saved ${name}`);
  }

  const selectedPreview = selectedPath ? previews[selectedPath] : null;

  return (
    <div className="fade-in" style={{ display: "grid", gap: "1rem" }}>
      <div className="panel" style={{ padding: "1.25rem", display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <strong>Photos</strong>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}>
              Preview → <strong style={{ color: "var(--ink)" }}>Copy</strong> pastes into any PC app (like text).
              Mirror clipboard is text-only; use this for pictures.
            </div>
          </div>
          <button className="btn" onClick={() => void loadList()} disabled={loadingList}>
            {loadingList ? "Loading…" : "Reload"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["all", "camera", "screenshots", "other"] as const).map((f) => (
            <button
              key={f}
              className="btn"
              data-active={filter === f}
              onClick={() => setFilter(f)}
              style={{ borderColor: filter === f ? "var(--accent)" : undefined }}
            >
              {f === "all" ? "All" : f === "camera" ? "Camera" : f === "screenshots" ? "Screenshots" : "Other"}
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <div className="panel" style={{ padding: "1.25rem", color: "var(--muted)" }}>
          No images found. Unlock the phone and tap Reload.
        </div>
      ) : (
        <div className="photo-grid">
          {filtered.map((p) => {
            const name = p.split("/").pop() ?? p;
            const thumb = previews[p];
            const busy = busyPath === p;
            return (
              <div key={p} className="photo-card">
                <button
                  type="button"
                  className="photo-thumb"
                  onClick={() => {
                    setSelectedPath(p);
                    void ensurePreview(p);
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt={name} />
                  ) : (
                    <span className="photo-thumb-placeholder">Loading…</span>
                  )}
                </button>
                <div className="photo-meta">{name}</div>
                <div className="photo-actions">
                  <button className="btn btn-primary" disabled={busy} onClick={() => void onCopy(p)}>
                    Copy
                  </button>
                  <button className="btn" disabled={busy} onClick={() => void onSave(p)}>
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPath ? (
        <div
          className="photo-lightbox"
          role="dialog"
          onClick={() => setSelectedPath(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelectedPath(null)}
        >
          <div className="photo-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {selectedPreview ? (
              <img src={selectedPreview} alt="" />
            ) : (
              <div style={{ color: "var(--muted)", padding: "2rem" }}>Loading preview…</div>
            )}
            <div className="photo-lightbox-bar">
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {selectedPath.split("/").pop()}
              </span>
              <button className="btn btn-primary" onClick={() => void onCopy(selectedPath)}>
                Copy to clipboard
              </button>
              <button className="btn" onClick={() => void onSave(selectedPath)}>
                Save
              </button>
              <button className="btn" onClick={() => setSelectedPath(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsView({
  config,
  profiles,
  onChange,
  onKillServer,
}: {
  config: AppConfig;
  profiles: MirrorProfile[];
  onChange: (c: AppConfig) => void;
  onKillServer: () => void;
}) {
  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", display: "grid", gap: "0.9rem", maxWidth: 640 }}>
      <label>
        Mirror profile
        <select
          className="field"
          style={{ marginTop: 6 }}
          value={config.preferredProfile}
          onChange={(e) =>
            onChange({ ...config, preferredProfile: e.target.value as AppConfig["preferredProfile"] })
          }
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.turnScreenOff}
          onChange={(e) => onChange({ ...config, turnScreenOff: e.target.checked })}
        />
        Turn phone screen off while mirroring
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.stayAwake}
          onChange={(e) => onChange({ ...config, stayAwake: e.target.checked })}
        />
        Keep phone awake
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.showTouches}
          onChange={(e) => onChange({ ...config, showTouches: e.target.checked })}
        />
        Show touches
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.forwardAudio !== false}
          onChange={(e) => onChange({ ...config, forwardAudio: e.target.checked })}
        />
        Forward phone audio to PC (Android 11+, scrcpy 2+)
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={!!config.recordMirror}
          onChange={(e) => onChange({ ...config, recordMirror: e.target.checked })}
        />
        Record mirror sessions (MP4 in Videos/aspera-connect-recordings)
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.clipboardSync !== false}
          onChange={(e) => onChange({ ...config, clipboardSync: e.target.checked })}
        />
        Enable clipboard sync while mirroring (scrcpy)
      </label>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={config.kdeconnectEnabled !== false}
          onChange={(e) => onChange({ ...config, kdeconnectEnabled: e.target.checked })}
        />
        KDE Connect bridge enabled
      </label>
      <label>
        Language
        <select
          className="field"
          style={{ marginTop: 6 }}
          value={config.locale}
          onChange={(e) => onChange({ ...config, locale: e.target.value })}
        >
          {locales.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={onKillServer}>Restart ADB server</button>
    </div>
  );
}

function HelpView() {
  return (
    <div className="panel fade-in" style={{ padding: "1.25rem", lineHeight: 1.55, maxWidth: 720 }}>
      <h3 style={{ marginTop: 0 }}>Quick fix guide</h3>
      <ul>
        <li><strong>Click-to-call</strong> — Home → register tel: handler, then phone links in Zoho/browser dial via your USB phone. Or copy a number → Call clipboard / tray.</li>
        <li><strong>App windows</strong> — Apps tab opens a package with scrcpy <code>--new-display</code> (needs scrcpy 3.3+ / Snap). Phone screen stays free.</li>
        <li><strong>Meetings</strong> — Home → Meetings: audio on PC, phone screen off.</li>
        <li><strong>SMS</strong> — prefers KDE Connect send when paired; otherwise opens the phone composer.</li>
        <li><strong>unauthorized</strong> — unlock phone, tap Allow on the debugging dialog.</li>
        <li><strong>no devices</strong> — try another cable, enable USB debugging, or finish wireless connect.</li>
        <li><strong>scrcpy missing / clicks fail</strong> — use Snap scrcpy 3.x (<code>/snap/bin/scrcpy</code>), not apt 1.25. On OnePlus/Xiaomi enable <em>USB debugging (Security settings)</em> and reboot.</li>
        <li><strong>HID mouse stuck</strong> — press <kbd>Left Alt</kbd> to release the mouse back to Linux.</li>
        <li><strong>Xiaomi / Samsung quirks</strong> — disable “USB debugging (Security settings)” blocks; allow install via USB if prompted.</li>
        <li><strong>Keyboard while mirroring</strong> — type in the scrcpy window; use on-screen nav for Home/Recent.</li>
      </ul>
      <p>
        Aspera Connect is free and open source. Pro mode uses system <code>adb</code> + <code>scrcpy</code> (GPL).
        Easy mode uses the companion APK under Apache-2.0.
      </p>
    </div>
  );
}
