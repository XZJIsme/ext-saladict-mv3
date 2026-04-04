const MENU_ROOT_ID = "saladict-root"
const MENU_LOOKUP_ID = "saladict-lookup"
const MENU_TRANSLATE_ID = "saladict-translate"
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html"
const api = globalThis.browser || globalThis.chrome
let creatingOffscreenDocumentPromise = null
let initContextMenusPromise = null

initContextMenus()

if (api?.runtime?.onInstalled) {
  api.runtime.onInstalled.addListener(initContextMenus)
}

if (api?.runtime?.onMessage) {
  api.runtime.onMessage.addListener(handleRuntimeMessage)
}

if (api?.contextMenus?.onClicked) {
  api.contextMenus.onClicked.addListener(handleContextMenuClick)
}

function handleRuntimeMessage(message, sender, sendResponse) {
  if (message?.type === "PLAY_AUDIO") {
    forwardAudioMessage(message)
      .then(response => sendResponse(response))
      .catch(error => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error || ""),
        })
      })
    return true
  }

  if (message?.type === "STOP_AUDIO") {
    forwardAudioMessage(message)
      .then(response => sendResponse(response))
      .catch(error => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error || ""),
        })
      })
    return true
  }

  return false
}

async function initContextMenus() {
  if (!api?.contextMenus) {
    return
  }

  if (!initContextMenusPromise) {
    initContextMenusPromise = (async () => {
      await removeAllContextMenus()
      createContextMenus()
    })().catch(() => {}).finally(() => {
      initContextMenusPromise = null
    })
  }

  await initContextMenusPromise
}

function removeAllContextMenus() {
  if (!api?.contextMenus?.removeAll) {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    try {
      api.contextMenus.removeAll(() => resolve())
    } catch (error) {
      resolve()
    }
  })
}

function createContextMenus() {
  try {
    api.contextMenus.create({
      id: MENU_ROOT_ID,
      title: "沙拉查词",
      contexts: ["selection"],
    })
    api.contextMenus.create({
      id: MENU_LOOKUP_ID,
      parentId: MENU_ROOT_ID,
      title: "查词",
      contexts: ["selection"],
    })
    api.contextMenus.create({
      id: MENU_TRANSLATE_ID,
      parentId: MENU_ROOT_ID,
      title: "翻译",
      contexts: ["selection"],
    })
  } catch (error) {
  }
}

async function handleContextMenuClick(info, tab) {
  if (!info?.selectionText || !tab?.id) {
    return
  }

  const mode =
    info.menuItemId === MENU_TRANSLATE_ID ? "translate" : "lookup"

  try {
    await sendSelectionToTab(tab.id, info.selectionText, mode)
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error))) {
      throw error
    }
  }
}

async function sendSelectionToTab(tabId, text, mode) {
  try {
    await api.tabs.sendMessage(tabId, {
      type: "SALADICT_OPEN_PANEL",
      payload: {
        text,
        mode,
        pinned: false,
      },
    })
    return
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error))) {
      throw error
    }
  }

  await api.scripting.executeScript({
    target: { tabId },
    files: ["browser-api.js", "settings.js", "content-panel.js"],
  })

  await api.tabs.sendMessage(tabId, {
    type: "SALADICT_OPEN_PANEL",
    payload: {
      text,
      mode,
      pinned: false,
    },
  })
}

async function forwardAudioMessage(message) {
  await ensureOffscreenDocument()
  return api.runtime.sendMessage({
    type:
      message?.type === "STOP_AUDIO"
        ? "OFFSCREEN_STOP_AUDIO"
        : "OFFSCREEN_PLAY_AUDIO",
    payload: message?.payload,
  })
}

async function ensureOffscreenDocument() {
  if (!api?.offscreen?.createDocument || !api?.runtime?.getURL) {
    return
  }

  const offscreenUrl = api.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)

  if (api.runtime.getContexts) {
    const contexts = await api.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    })
    if (Array.isArray(contexts) && contexts.length > 0) {
      return
    }
  }

  if (!creatingOffscreenDocumentPromise) {
    creatingOffscreenDocumentPromise = Promise.resolve(
      api.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play pronunciation audio for dictionary results.",
      })
    ).catch(error => {
      if (!/Only a single offscreen document may be created/i.test(String(error?.message || error))) {
        throw error
      }
    })
  }

  try {
    await creatingOffscreenDocumentPromise
  } finally {
    creatingOffscreenDocumentPromise = null
  }
}
