import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  CommandResult,
  CompanionDevice,
  CompanionSessionState,
  Device,
  KdeStatus,
  MirrorHandle,
  MirrorProfile,
  MirrorProfileId,
  PairResult,
  PhoneApp,
  PhoneNotification,
  SetupReport,
  ToolsReport,
} from "./types";

export const api = {
  getTools: () => invoke<ToolsReport>("get_tools"),
  getSetupReport: () => invoke<SetupReport>("get_setup_report"),
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  completeFirstRun: () => invoke<AppConfig>("complete_first_run"),
  listProfiles: () => invoke<MirrorProfile[]>("list_profiles"),
  listDevices: () => invoke<CommandResult<Device[]>>("list_devices"),
  refreshAndSelect: (serial?: string | null) =>
    invoke<CommandResult<Device>>("refresh_and_select", { serial: serial ?? null }),
  startMirror: (args: {
    serial: string;
    profileId: MirrorProfileId;
    turnScreenOff: boolean;
    stayAwake: boolean;
    showTouches: boolean;
    fullscreen: boolean;
  }) =>
    invoke<CommandResult<MirrorHandle>>("start_mirror", {
      serial: args.serial,
      profileId: args.profileId,
      turnScreenOff: args.turnScreenOff,
      stayAwake: args.stayAwake,
      showTouches: args.showTouches,
      fullscreen: args.fullscreen,
    }),
  startAppWindow: (serial: string, packageName: string, flexDisplay = true) =>
    invoke<CommandResult<MirrorHandle>>("start_app_window", {
      serial,
      package: packageName,
      flexDisplay,
    }),
  listPhoneApps: (serial: string) =>
    invoke<CommandResult<PhoneApp[]>>("list_phone_apps", { serial }),
  stopMirror: (id: string) => invoke<CommandResult<void>>("stop_mirror", { id }),
  stopAllMirrors: () => invoke<CommandResult<void>>("stop_all_mirrors"),
  listMirrors: () => invoke<MirrorHandle[]>("list_mirrors"),
  pairWireless: (hostPort: string, pairingCode: string) =>
    invoke<CommandResult<PairResult>>("pair_wireless", { hostPort, pairingCode }),
  connectWireless: (hostPort: string) =>
    invoke<CommandResult<PairResult>>("connect_wireless", { hostPort }),
  buildWirelessQr: (host: string, port: number, pairingCode?: string) =>
    invoke<string>("build_wireless_qr", { host, port, pairingCode: pairingCode ?? null }),
  pushFile: (serial: string, local: string, remote?: string) =>
    invoke<CommandResult<string>>("push_file", {
      serial,
      local,
      remote: remote ?? null,
    }),
  pushFiles: (serial: string, paths: string[]) =>
    invoke<CommandResult<string[]>>("push_files", { serial, paths }),
  installApk: (serial: string, local: string) =>
    invoke<CommandResult<string>>("install_apk", { serial, local }),
  pullFile: (serial: string, remote: string, local: string) =>
    invoke<CommandResult<string>>("pull_file", { serial, remote, local }),
  listPhotos: (serial: string) =>
    invoke<CommandResult<string[]>>("list_photos", { serial }),
  readPhoto: (serial: string, remote: string) =>
    invoke<CommandResult<{ path: string; mime: string; base64: string; size: number }>>(
      "read_photo",
      { serial, remote },
    ),
  copyPhotoToClipboard: (serial: string, remote: string) =>
    invoke<CommandResult<string>>("copy_photo_to_clipboard", { serial, remote }),
  getDeviceClipboard: (serial: string) =>
    invoke<CommandResult<string>>("get_device_clipboard", { serial }),
  setDeviceClipboard: (serial: string, text: string) =>
    invoke<CommandResult<void>>("set_device_clipboard", { serial, text }),
  shareTextToPhone: (serial: string, text: string) =>
    invoke<CommandResult<void>>("share_text_to_phone", { serial, text }),
  composeSms: (serial: string, number: string, body: string) =>
    invoke<CommandResult<void>>("compose_sms", { serial, number, body }),
  placeCall: (args: { number: string; serial?: string | null; direct?: boolean }) =>
    invoke<CommandResult<string>>("place_call", {
      number: args.number,
      serial: args.serial ?? null,
      direct: args.direct ?? true,
    }),
  openPhoneApp: (serial?: string | null) =>
    invoke<CommandResult<string>>("open_phone_app", { serial: serial ?? null }),
  parseCallUri: (uri: string) => invoke<CommandResult<string>>("parse_call_uri", { uri }),
  takePendingCall: () => invoke<string | null>("take_pending_call"),
  registerTelHandler: () => invoke<CommandResult<string>>("register_tel_handler"),
  sendSmsSmart: (args: {
    number: string;
    body: string;
    serial?: string | null;
    kdeDeviceId?: string | null;
  }) =>
    invoke<CommandResult<string>>("send_sms_smart", {
      number: args.number,
      body: args.body,
      serial: args.serial ?? null,
      kdeDeviceId: args.kdeDeviceId ?? null,
    }),
  adbKillServer: () => invoke<CommandResult<void>>("adb_kill_server"),
  adbStartServer: () => invoke<CommandResult<void>>("adb_start_server"),
  kdeStatus: () => invoke<KdeStatus>("kde_status"),
  kdePing: (deviceId: string) => invoke<CommandResult<void>>("kde_ping", { deviceId }),
  kdeRing: (deviceId: string) => invoke<CommandResult<void>>("kde_ring", { deviceId }),
  kdeShare: (deviceId: string, path: string) =>
    invoke<CommandResult<void>>("kde_share", { deviceId, path }),
  kdeShareText: (deviceId: string, text: string) =>
    invoke<CommandResult<void>>("kde_share_text", { deviceId, text }),
  kdeSendSms: (deviceId: string, number: string, body: string) =>
    invoke<CommandResult<void>>("kde_send_sms", { deviceId, number, body }),
  kdePullNotifications: (deviceId: string) =>
    invoke<CommandResult<PhoneNotification[]>>("kde_pull_notifications", { deviceId }),
  getCompanionState: () => invoke<CompanionSessionState>("get_companion_state"),
  setCompanionPin: (pin: string) => invoke<AppConfig>("set_companion_pin", { pin }),
  discoverCompanions: () => invoke<CommandResult<CompanionDevice[]>>("discover_companion_devices"),
  companionHello: (host: string, name: string, pin?: string) =>
    invoke<CommandResult<CompanionSessionState>>("companion_hello", {
      host,
      name,
      pin: pin || null,
    }),
  listNotifications: () => invoke<PhoneNotification[]>("list_notifications"),
  markNotificationRead: (id: string) => invoke<void>("mark_notification_read", { id }),
  clearNotifications: () => invoke<void>("clear_notifications"),
  setDeviceNickname: (serial: string, nickname: string) =>
    invoke<AppConfig>("set_device_nickname", { serial, nickname }),
  setFavoriteApps: (packages: string[]) =>
    invoke<AppConfig>("set_favorite_apps", { packages }),
};
