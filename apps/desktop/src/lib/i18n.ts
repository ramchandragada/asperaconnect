export type Locale = "en" | "es" | "de" | "fr" | "hi";

const en = {
  brand: "Aspera Connect",
  tagline: "Click-to-call from Linux — free forever",
  connect: "Connect",
  mirror: "Mirror",
  refresh: "Refresh",
  wireless: "Wireless",
  files: "Files",
  photos: "Photos",
  share: "Share",
  sms: "SMS",
  companion: "Easy mode",
  kde: "KDE Connect",
  settings: "Settings",
  help: "Help",
  home: "Home",
  noDevice: "No phone yet",
  plugIn: "Plug in USB with debugging on, or pair wirelessly.",
  startMirror: "Start mirror",
  stopMirror: "Stop mirror",
  firstRunTitle: "Welcome to Aspera Connect",
  firstRunBody:
    "Mirror and control your Android phone from Ubuntu, Mint, Zorin, and friends. Free, local, no account.",
  continue: "Continue",
  installTools: "Install tools",
  ready: "Ready",
  missing: "Missing",
} as const;

type Dict = { [K in keyof typeof en]: string };

const es: Dict = {
  ...en,
  brand: "Aspera Connect",
  tagline: "Android en tu escritorio Linux — gratis para siempre",
  connect: "Conectar",
  mirror: "Espejo",
  wireless: "Inalámbrico",
  settings: "Ajustes",
  help: "Ayuda",
  home: "Inicio",
  startMirror: "Iniciar espejo",
  firstRunTitle: "Bienvenido a Aspera Connect",
};

const de: Dict = {
  ...en,
  tagline: "Android auf Ihrem Linux-Desktop — für immer kostenlos",
  connect: "Verbinden",
  mirror: "Spiegeln",
  wireless: "Kabellos",
  settings: "Einstellungen",
  help: "Hilfe",
  home: "Start",
  startMirror: "Spiegelung starten",
  firstRunTitle: "Willkommen bei Aspera Connect",
};

const fr: Dict = {
  ...en,
  tagline: "Android sur votre bureau Linux — gratuit pour toujours",
  connect: "Connecter",
  mirror: "Miroir",
  wireless: "Sans fil",
  settings: "Réglages",
  help: "Aide",
  home: "Accueil",
  startMirror: "Démarrer le miroir",
  firstRunTitle: "Bienvenue sur Aspera Connect",
};

const hi: Dict = {
  ...en,
  tagline: "आपके Linux डेस्कटॉप पर Android — हमेशा मुफ़्त",
  connect: "कनेक्ट",
  mirror: "मिरर",
  wireless: "वायरलेस",
  settings: "सेटिंग्स",
  help: "मदद",
  home: "होम",
  startMirror: "मिरर शुरू करें",
  firstRunTitle: "Aspera Connect में आपका स्वागत है",
};

const catalogs: Record<Locale, Dict> = { en, es, de, fr, hi };

export function t(locale: string, key: keyof typeof en): string {
  const loc = (locale in catalogs ? locale : "en") as Locale;
  return catalogs[loc][key] ?? en[key];
}

export const locales: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "hi", label: "हिन्दी" },
];
