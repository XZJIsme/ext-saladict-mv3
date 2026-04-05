const SETTINGS_STORAGE_KEY = "userSettings"
const CREDENTIALS_STORAGE_KEY = "dictCredentials"
const { storage } = window.SaladictBrowserApi

const AVAILABLE_SOURCES = [
  { id: "google", label: "Google 翻译" },
  { id: "baidu", label: "百度翻译" },
  { id: "caiyun", label: "彩云翻译" },
]

const AVAILABLE_THEMES = [
  { id: "viista", label: "WindovvViista" },
  { id: "mojavv", label: "Mojavv" },
  { id: "flatwhite", label: "Flatwhite" },
]

const DEFAULT_SETTINGS = {
  version: 5,
  enabledSourceIds: AVAILABLE_SOURCES.map(source => source.id),
  defaultPinned: false,
  selectionSearchMode: "auto",
  theme: "viista",
  mode: {
    direct: false,
  },
  pinMode: {
    direct: false,
  },
}

const DEFAULT_CREDENTIALS = {
  baidu: {
    token: "",
  },
  caiyun: {
    token: "",
  },
}

function getValidSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds)) {
    return []
  }

  const availableIds = new Set(AVAILABLE_SOURCES.map(source => source.id))
  return [...new Set(sourceIds)].filter(id => availableIds.has(id))
}

function normalizeSettings(rawSettings) {
  const enabledSourceIds = getValidSourceIds(rawSettings?.enabledSourceIds)
  const selectionSearchMode =
    rawSettings?.selectionSearchMode === "lookup" ||
    rawSettings?.selectionSearchMode === "translate"
      ? rawSettings.selectionSearchMode
      : DEFAULT_SETTINGS.selectionSearchMode
  const theme = AVAILABLE_THEMES.some(item => item.id === rawSettings?.theme)
    ? rawSettings.theme
    : DEFAULT_SETTINGS.theme

  return {
    version: 5,
    enabledSourceIds:
      enabledSourceIds.length > 0
        ? enabledSourceIds
        : [...DEFAULT_SETTINGS.enabledSourceIds],
    defaultPinned:
      typeof rawSettings?.defaultPinned === "boolean"
        ? rawSettings.defaultPinned
        : DEFAULT_SETTINGS.defaultPinned,
    selectionSearchMode,
    theme,
    // Selection auto-popup is intentionally disabled in this fork.
    mode: { direct: false },
    pinMode: { direct: false },
  }
}

function normalizeCredentials(rawCredentials) {
  return {
    baidu: {
      token:
        typeof rawCredentials?.baidu?.token === "string"
          ? rawCredentials.baidu.token.trim()
          : DEFAULT_CREDENTIALS.baidu.token,
    },
    caiyun: {
      token:
        typeof rawCredentials?.caiyun?.token === "string"
          ? rawCredentials.caiyun.token.trim()
          : DEFAULT_CREDENTIALS.caiyun.token,
    },
  }
}

async function loadSettings() {
  const stored = await storage.sync.get(SETTINGS_STORAGE_KEY)
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY])
}

async function saveSettings(nextSettings) {
  const normalizedSettings = normalizeSettings(nextSettings)
  await storage.sync.set({
    [SETTINGS_STORAGE_KEY]: normalizedSettings,
  })
  return normalizedSettings
}

async function loadCredentials() {
  const stored = await storage.local.get(CREDENTIALS_STORAGE_KEY)
  return normalizeCredentials(stored[CREDENTIALS_STORAGE_KEY])
}

async function saveCredentials(nextCredentials) {
  const normalizedCredentials = normalizeCredentials(nextCredentials)
  await storage.local.set({
    [CREDENTIALS_STORAGE_KEY]: normalizedCredentials,
  })
  return normalizedCredentials
}

async function loadOptionsData() {
  const [settings, credentials] = await Promise.all([
    loadSettings(),
    loadCredentials(),
  ])
  return { settings, credentials }
}

async function saveOptionsData(nextData) {
  const [settings, credentials] = await Promise.all([
    saveSettings(nextData.settings),
    saveCredentials(nextData.credentials),
  ])
  return { settings, credentials }
}

function isSettingsEqual(left, right) {
  const normalizedLeft = normalizeSettings(left)
  const normalizedRight = normalizeSettings(right)

  if (
    normalizedLeft.enabledSourceIds.length !==
    normalizedRight.enabledSourceIds.length
  ) {
    return false
  }

  return (
    normalizedLeft.defaultPinned === normalizedRight.defaultPinned &&
    normalizedLeft.selectionSearchMode === normalizedRight.selectionSearchMode &&
    normalizedLeft.theme === normalizedRight.theme &&
    normalizedLeft.mode.direct === normalizedRight.mode.direct &&
    normalizedLeft.pinMode.direct === normalizedRight.pinMode.direct &&
    normalizedLeft.enabledSourceIds.every((id, index) => {
      return id === normalizedRight.enabledSourceIds[index]
    })
  )
}

function isCredentialsEqual(left, right) {
  const normalizedLeft = normalizeCredentials(left)
  const normalizedRight = normalizeCredentials(right)
  return (
    normalizedLeft.baidu.token === normalizedRight.baidu.token &&
    normalizedLeft.caiyun.token === normalizedRight.caiyun.token
  )
}

window.SaladictSettings = {
  AVAILABLE_SOURCES,
  AVAILABLE_THEMES,
  CREDENTIALS_STORAGE_KEY,
  DEFAULT_CREDENTIALS,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  isCredentialsEqual,
  isSettingsEqual,
  loadCredentials,
  loadOptionsData,
  loadSettings,
  normalizeCredentials,
  normalizeSettings,
  saveCredentials,
  saveOptionsData,
  saveSettings,
}
