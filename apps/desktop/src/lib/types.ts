export type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
export type ConnectionKind = "usb" | "wireless" | "unknown";

export interface DeviceIdentity {
  brand?: string | null;
  model?: string | null;
  device?: string | null;
  marketName: string;
  skinId: string;
  aspectW: number;
  aspectH: number;
}

export interface Device {
  serial: string;
  state: DeviceState;
  model?: string | null;
  product?: string | null;
  transportId?: string | null;
  connection: ConnectionKind;
  battery?: number | null;
  androidVersion?: string | null;
  brand?: string | null;
  deviceCodename?: string | null;
  identity: DeviceIdentity;
}

export type MirrorProfileId =
  | "quality"
  | "balanced"
  | "battery"
  | "lowLatency"
  | "meetings";

export interface MirrorProfile {
  id: MirrorProfileId;
  label: string;
  maxSize?: number | null;
  bitRate?: string | null;
  maxFps?: number | null;
}

export interface PhoneApp {
  package: string;
  label: string;
}

export interface ToolInfo {
  name: string;
  found: boolean;
  path?: string | null;
  version?: string | null;
  installHint: string;
}

export interface ToolsReport {
  adb: ToolInfo;
  scrcpy: ToolInfo;
  kdeconnect: ToolInfo;
  readyForProMode: boolean;
}

export interface AppConfig {
  firstRunCompleted: boolean;
  lastDeviceSerial?: string | null;
  preferredProfile: MirrorProfileId;
  turnScreenOff: boolean;
  stayAwake: boolean;
  showTouches: boolean;
  startWithTray: boolean;
  locale: string;
  knownWirelessEndpoints: string[];
  companionPin?: string | null;
  companionHost?: string | null;
  companionName?: string | null;
  kdeconnectEnabled: boolean;
  forwardAudio?: boolean;
  recordMirror?: boolean;
  clipboardSync?: boolean;
  deviceNicknames?: Record<string, string>;
  notificationMutedApps?: string[];
  favoriteApps?: string[];
}

export interface UserFacingError {
  code: string;
  title: string;
  message: string;
  hint?: string | null;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T | null;
  error?: UserFacingError | null;
}

export interface MirrorHandle {
  id: string;
  serial: string;
  running: boolean;
  pid?: number | null;
  recording?: boolean;
  appWindow?: boolean;
  startApp?: string | null;
}

export interface PhoneNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  source: "companion" | "kdeConnect" | "adb";
  receivedAt: string;
  read: boolean;
}

export interface SetupCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fixHint?: string | null;
}

export interface SetupReport {
  readyForProMode: boolean;
  scrcpyVersionOk: boolean;
  checks: SetupCheck[];
}

export interface PairResult {
  paired: boolean;
  message: string;
}

export interface KdeDevice {
  id: string;
  name: string;
  paired: boolean;
  reachable: boolean;
}

export interface KdeStatus {
  available: boolean;
  devices: KdeDevice[];
  hint?: string | null;
}

export interface CompanionDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: number;
  battery?: number | null;
  model?: string | null;
}

export interface CompanionSessionState {
  connected: boolean;
  device?: CompanionDevice | null;
  mirroring: boolean;
  lastError?: string | null;
}

export type AppView = "companion" | "contacts" | "settings" | "help";

export interface PhoneContact {
  id: string;
  name: string;
  phones: string[];
}

export interface ContactsCache {
  syncedAt?: string | null;
  host?: string | null;
  contacts: PhoneContact[];
}

export type CallOutcome = "dialed" | "ended" | "failed";

export interface CallHistoryEntry {
  id: string;
  name: string;
  number: string;
  at: string;
  outcome: CallOutcome;
}

export interface CallHistory {
  entries: CallHistoryEntry[];
}

export interface FavoriteContact {
  id: string;
  name: string;
  number: string;
}

export interface FavoritesStore {
  favorites: FavoriteContact[];
}
