/* Tabs of "Fahrschule & Einstellungen" (/fahrschule?tab=…). Shared by
   the router (search validation) and the page. */
export const SETTINGS_TABS = [
  "stammdaten",
  "bank",
  "profil",
  "zeiten",
  "standorte",
  "recht",
  "absagen",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  stammdaten: "Stammdaten & Steuer",
  bank: "Bankverbindung",
  profil: "Öffentliches Profil",
  zeiten: "Öffnungszeiten",
  standorte: "Standorte",
  recht: "Rechtliches",
  absagen: "Terminabsagen",
};
