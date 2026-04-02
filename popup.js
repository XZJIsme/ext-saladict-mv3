const input = document.querySelector("#sentence-input")
const results = document.querySelector("#results")
const statusLine = document.querySelector("#status-line")
const subtitle = document.querySelector("#window-subtitle")
const hintText = document.querySelector("#hint-text")
const translateBtn = document.querySelector("#translate-btn")
const wordwebBtn = document.querySelector("#wordweb-btn")
const pinBtn = document.querySelector("#pin-btn")
const {
  openOptionsPage,
  openUrl,
  queryTabs,
  removeTab,
  executeScript,
  sendMessageToTab,
} = window.SaladictBrowserApi
const { md5 } = window.SaladictHash
const pageParams = new URLSearchParams(window.location.search)
const PANEL_MESSAGE_SOURCE = "saladict-panel"
const isEmbeddedPanel = pageParams.get("embedded") === "1"
let isComposing = false
let lastTargetMode = "zh"
let activeSettings = window.SaladictSettings.DEFAULT_SETTINGS
let activeTranslationSourceConfigs = []
let activeCredentials = window.SaladictSettings.DEFAULT_CREDENTIALS
let currentRunId = 0
const collapsedSourceIds = new Set()
let lastSettledResults = []
let currentViewMode = "idle"
let lastRenderedText = ""
let isPinnedState = false
let isDraggingPanel = false
let hasRestoredSnapshotResults = false
let restoredSnapshotText = ""
let activeAudioPlayer = null

function setNodeText(node, text) {
  if (node) {
    node.textContent = text
  }
}

function syncPinButtonState() {
  if (!pinBtn) {
    return
  }

  pinBtn.classList.toggle("is-active", isPinnedState)
  pinBtn.setAttribute("aria-pressed", isPinnedState ? "true" : "false")
  pinBtn.title = isPinnedState ? "当前已锁定" : "锁定并保持打开"
}

const TRANSLATION_SOURCE_CONFIGS = [
  {
    id: "google",
    label: "Google 翻译",
    href: (text, targetMode) =>
      `https://translate.google.com/?sl=auto&tl=${mapTargetForSource("google", targetMode)}&text=${encodeURIComponent(text)}&op=translate`,
    translate: translateWithGoogle,
  },
  {
    id: "baidu",
    label: "百度翻译",
    href: (text, targetMode) =>
      `https://fanyi.baidu.com/#auto/${mapTargetForSource("baidu", targetMode)}/${encodeURIComponent(text)}`,
    translate: (text, targetMode) => {
      if (!activeCredentials.baidu.token) {
        return unavailableResult("请先在设置页填写百度翻译的 token。")
      }

      const credential = parseBaiduToken(activeCredentials.baidu.token)
      if (!credential) {
        return unavailableResult("百度翻译 token 格式不正确，请使用 appid:key。")
      }

      return translateWithBaidu(text, targetMode, credential)
    },
  },
  {
    id: "caiyun",
    label: "彩云翻译",
    href: () => "https://fanyi.caiyunapp.com/",
    translate: (text, targetMode) => {
      if (!activeCredentials.caiyun.token) {
        return unavailableResult("请先在设置页填写彩云翻译的 token。")
      }

      return translateWithCaiyun(text, targetMode, activeCredentials.caiyun.token)
    },
  },
]

const DICTIONARY_SOURCE_CONFIGS = [
  {
    id: "cobuild",
    label: "柯林斯词典",
    href: text =>
      `https://www.collinsdictionary.com/dictionary/english/${encodeURIComponent(
        String(text || "").replace(/\s+/g, "-").trim()
      )}`,
    lookup: lookupWithCobuild,
  },
  {
    id: "bing",
    label: "Bing 词典",
    href: text =>
      `https://cn.bing.com/dict/search?q=${encodeURIComponent(
        String(text || "").replace(/\s+/g, " ").trim()
      )}`,
    lookup: lookupWithBing,
  },
]

document.querySelector(".settings-btn")?.addEventListener("click", () => {
  openOptionsPage()
})

pinBtn?.addEventListener("click", async () => {
  if (isEmbeddedPanel) {
    postToParent({
      type: "SALADICT_PANEL_TOGGLE_PIN",
    })
    return
  }

  try {
    const tab = await getActiveTab()
    if (!tab?.id) {
      setNodeText(statusLine, "当前标签页不可用，无法切换锁定状态。")
      return
    }

    if (!canInjectPanel(tab.url)) {
      setNodeText(statusLine, "当前页面不支持页内查词面板，例如浏览器内部页面。")
      return
    }

    await ensurePanelAvailable(tab.id)

    if (isPinnedState) {
      const response = await sendMessageToTab(tab.id, {
        type: "SALADICT_SET_PIN_STATE",
        payload: { pinned: false },
      })
      isPinnedState = !!response?.isPinned
      syncPinButtonState()
      applySettings(activeSettings)
      setNodeText(statusLine, "已取消当前页面查词面板的锁定状态。")
      return
    }

    await sendMessageToTab(tab.id, {
      type: "SALADICT_OPEN_PANEL",
      payload: {
        text: input?.value?.trim() || "",
        snapshot: createPanelSnapshot(),
        pinned: true,
      },
    })
    isPinnedState = true
    syncPinButtonState()
    applySettings(activeSettings)
    setNodeText(statusLine, "已在当前页面打开锁定查词面板。")
    window.close()
  } catch (error) {
    setNodeText(
      statusLine,
      error instanceof Error
        ? `当前页面无法打开页内查词面板：${error.message}`
        : "当前页面无法打开页内查词面板。"
    )
  }
})

document.querySelector(".close-btn")?.addEventListener("click", () => {
  if (isEmbeddedPanel) {
    postToParent({
      type: "SALADICT_PANEL_CLOSE",
    })
    return
  }

  window.close()
})

results?.addEventListener("click", event => {
  const collapseBtn = event.target.closest?.("[data-action='toggle-collapse']")
  if (collapseBtn) {
    const sourceId = collapseBtn.getAttribute("data-source-id")
    if (!sourceId) {
      return
    }

    if (collapsedSourceIds.has(sourceId)) {
      collapsedSourceIds.delete(sourceId)
    } else {
      collapsedSourceIds.add(sourceId)
    }

    renderCards(lastRenderedText, currentViewMode, lastSettledResults)
    return
  }

  const playBtn = event.target.closest?.("[data-action='play-audio']")
  if (playBtn) {
    const url = playBtn.getAttribute("data-audio-url")
    if (!url) {
      return
    }

    event.preventDefault()
    playAudioUrl(url)
    return
  }

  const openBtn = event.target.closest?.("[data-open-url]")
  if (!openBtn) {
    return
  }

  const url = openBtn.getAttribute("data-open-url")
  if (!url) {
    return
  }

  event.preventDefault()
  openUrl(url, false)
})

input?.addEventListener("compositionstart", () => {
  isComposing = true
})

input?.addEventListener("compositionend", () => {
  isComposing = false
})

input?.addEventListener("keydown", event => {
  if (event.key !== "Enter") {
    return
  }

  if (isComposing || event.isComposing || event.keyCode === 229) {
    return
  }

  event.preventDefault()
  runPreferredAction(input.value.trim())
})

translateBtn?.addEventListener("click", () => {
  runTranslations(input.value.trim())
})

wordwebBtn?.addEventListener("click", () => {
  runDictionaryLookup(input.value.trim())
})

if (isEmbeddedPanel) {
  window.addEventListener("message", handleEmbeddedMessage)
  window.addEventListener("mouseup", handleEmbeddedDragEnd, true)
}
document.addEventListener("mousedown", handleEmbeddedDragStart, true)

initPopup()

async function initPopup() {
  try {
    const { settings, credentials } =
      await window.SaladictSettings.loadOptionsData()
    activeSettings = settings
    activeCredentials = credentials
    applySettings(settings)

    if (isEmbeddedPanel) {
      syncPinButtonState()
      postToParent({
        type: "SALADICT_PANEL_READY",
      })
    } else {
      await syncPinStateFromActiveTab()
    }

    renderCards("", "idle")
  } catch (error) {
    setNodeText(
      statusLine,
      error instanceof Error ? `加载设置失败：${error.message}` : "加载设置失败。"
    )
    setNodeText(hintText, "请点击右上角“设置”检查翻译源配置。")
    renderCards("", "idle")
  }
}

async function runTranslations(text) {
  const runId = ++currentRunId
  currentViewMode = "translate"
  lastRenderedText = text

  if (activeTranslationSourceConfigs.length === 0) {
    setNodeText(statusLine, "当前没有可用翻译源，请先到设置页启用。")
    renderCards(text, "translate")
    return
  }

  if (!text) {
    currentViewMode = "idle"
    lastRenderedText = ""
    setNodeText(statusLine, "请先输入要翻译的句子。")
    renderCards("", "idle")
    return
  }

  const targetMode = decideTargetMode(text)
  lastTargetMode = targetMode

  setNodeText(
    statusLine,
    `正在请求 ${activeTranslationSourceConfigs.length} 个翻译源，目标语言：${targetMode === "en" ? "英语" : "中文"}...`
  )
  const states = new Map()
  activeTranslationSourceConfigs.forEach(source => {
    states.set(source.id, {
      state: "loading",
      text: "请求中...",
      meta: "",
    })
  })
  renderCards(text, "translate", toSettledResults(states, activeTranslationSourceConfigs))

  let finishedCount = 0
  const totalCount = activeTranslationSourceConfigs.length

  await Promise.all(
    activeTranslationSourceConfigs.map(async source => {
      let result
      try {
        result = await source.translate(text, targetMode)
      } catch (error) {
        result = {
          state: "error",
          text: error instanceof Error ? error.message : String(error),
          meta: "请求失败",
        }
      }

      if (runId !== currentRunId) {
        return
      }

      states.set(source.id, result)
      finishedCount += 1
      setNodeText(
        statusLine,
        `已完成 ${finishedCount}/${totalCount} 个翻译源，目标语言：${targetMode === "en" ? "英语" : "中文"}。`
      )
      renderCards(
        text,
        "translate",
        toSettledResults(states, activeTranslationSourceConfigs)
      )
    })
  )

  if (runId !== currentRunId) {
    return
  }

  setNodeText(
    statusLine,
    `已完成 ${totalCount} 个翻译源，目标语言：${targetMode === "en" ? "英语" : "中文"}。`
  )
}

async function runDictionaryLookup(text) {
  const runId = ++currentRunId
  currentViewMode = "lookup"
  lastRenderedText = text

  if (!text) {
    currentViewMode = "idle"
    lastRenderedText = ""
    setNodeText(statusLine, "请先输入要查的单词或短语。")
    renderCards("", "idle")
    return
  }

  setNodeText(statusLine, `正在查询 ${DICTIONARY_SOURCE_CONFIGS.length} 个词典源...`)
  const states = new Map()
  DICTIONARY_SOURCE_CONFIGS.forEach(source => {
    states.set(source.id, {
      state: "loading",
      text: "请求中...",
      meta: "",
    })
  })
  renderCards(text, "lookup", toSettledResults(states, DICTIONARY_SOURCE_CONFIGS))

  let finishedCount = 0
  const totalCount = DICTIONARY_SOURCE_CONFIGS.length

  await Promise.all(
    DICTIONARY_SOURCE_CONFIGS.map(async source => {
      let result
      try {
        result = await source.lookup(text)
      } catch (error) {
        result = {
          state: "error",
          text: error instanceof Error ? error.message : String(error),
          meta: "请求失败",
        }
      }

      if (runId !== currentRunId) {
        return
      }

      states.set(source.id, result)
      finishedCount += 1
      setNodeText(statusLine, `已完成 ${finishedCount}/${totalCount} 个词典源。`)
      renderCards(
        text,
        "lookup",
        toSettledResults(states, DICTIONARY_SOURCE_CONFIGS)
      )
    })
  )

  if (runId !== currentRunId) {
    return
  }

  setNodeText(statusLine, `已完成 ${totalCount} 个词典源。`)
}

function runPreferredAction(text) {
  const nextMode = decideViewMode(text)
  if (nextMode === "lookup") {
    runDictionaryLookup(text)
    return
  }

  runTranslations(text)
}

function renderCards(text, mode = currentViewMode, settled = []) {
  if (!results) {
    return
  }

  currentViewMode = mode
  lastRenderedText = text
  lastSettledResults = settled

  if (mode === "idle") {
    results.innerHTML = ""
    return
  }

  const activeConfigs = getActiveConfigsForMode(mode)
  const states = new Map(settled.map(item => [item.source.id, item.result]))

  if (mode === "translate" && activeConfigs.length === 0) {
    results.innerHTML = `
      <article class="result-card is-unavailable">
        <div class="result-head">
          <div class="result-title">未启用翻译源</div>
        </div>
        <div class="result-body">请点击右上角“设置”，至少启用一个翻译源。</div>
      </article>
    `
    return
  }

  results.innerHTML = activeConfigs.map(source => {
    const result = states.get(source.id) || {
      state: "idle",
      text: "",
      meta: "",
    }
    const isCollapsed = collapsedSourceIds.has(source.id)

    const klass =
      result.state === "loading"
        ? "result-card is-loading"
        : result.state === "unavailable"
        ? "result-card is-unavailable"
        : result.state === "error"
        ? "result-card is-error"
        : "result-card"
    const cardClass = isCollapsed ? `${klass} is-collapsed` : klass
    const bodyMarkup = isCollapsed
      ? ""
      : `<div class="result-body">${escapeHtml(result.text || "")}</div>`
    const metaMarkup = isCollapsed || !result.meta
      ? ""
      : `<div class="result-meta">${escapeHtml(result.meta)}</div>`
    const hasContent = Boolean(result.text) || Boolean(result.meta)
    const collapseLabel = isCollapsed ? "展开" : "收起"
    const showCollapseButton = isCollapsed || hasContent
    const isEmptyExpanded = !isCollapsed && !result.text && !result.meta
    const cardClassWithEmpty = isEmptyExpanded
      ? `${cardClass} is-empty`
      : cardClass
    const audioActions = buildAudioActions(result.audio)

    return `
      <article class="${cardClassWithEmpty}">
        <div class="result-head">
          <div class="result-title">${escapeHtml(source.label)}</div>
          <div class="result-actions">
            ${audioActions}
            ${showCollapseButton
              ? `<button class="result-link" type="button" data-action="toggle-collapse" data-source-id="${escapeAttr(source.id)}">${collapseLabel}</button>`
              : ""}
            <button class="result-link" type="button" data-open-url="${escapeAttr(source.href(text || "", lastTargetMode))}">打开网站</button>
          </div>
        </div>
        ${bodyMarkup}
        ${metaMarkup}
      </article>
    `
  }).join("")
}

function toSettledResults(states, sourceConfigs) {
  return sourceConfigs
    .map(source => ({
      source,
      result: states.get(source.id),
    }))
    .filter(item => Boolean(item.result))
}

function getActiveConfigsForMode(mode) {
  if (mode === "translate") {
    return activeTranslationSourceConfigs
  }

  if (mode === "lookup") {
    return DICTIONARY_SOURCE_CONFIGS
  }

  return []
}

function decideViewMode(text) {
  const normalized = String(text || "").trim()
  if (!normalized) {
    return "translate"
  }

  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(normalized)) {
    return "translate"
  }

  const compactLength = normalized.replace(/\s+/g, " ").length
  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  const englishLike = /^[\p{L}\p{M}\s'.-]+$/u.test(normalized)

  if (englishLike && compactLength <= 24 && wordCount <= 3) {
    return "lookup"
  }

  return "translate"
}

function applySettings(settings) {
  const enabledIds = new Set(settings.enabledSourceIds)
  activeTranslationSourceConfigs = TRANSLATION_SOURCE_CONFIGS.filter(source =>
    enabledIds.has(source.id)
  )

  const translationLabels = activeTranslationSourceConfigs.map(source => source.label)
  setNodeText(
    hintText,
    translationLabels.length > 0
      ? isPinnedState
        ? "当前为锁定面板，可保持打开"
        : "按回车会自动决定：24 字以内的英文短词/短语查词，其余内容翻译"
      : "请先到设置页启用翻译源。"
  )
  setNodeText(
    statusLine,
    translationLabels.length > 0
      ? currentViewMode === "idle"
        ? ""
        : statusLine?.textContent || ""
      : "当前没有启用的翻译源。"
  )
}

function handleEmbeddedMessage(event) {
  if (event.data?.source !== PANEL_MESSAGE_SOURCE) {
    return
  }

  if (event.data.type === "SALADICT_PANEL_INIT") {
    isPinnedState = !!event.data.payload?.pinned
    syncPinButtonState()
    applySettings(activeSettings)
    return
  }

  if (event.data.type === "SALADICT_PANEL_PIN_STATE") {
    isPinnedState = !!event.data.payload?.pinned
    syncPinButtonState()
    applySettings(activeSettings)
    return
  }

  if (event.data.type === "SALADICT_PANEL_RESTORE_SNAPSHOT") {
    restoreSnapshot(event.data.payload)
    return
  }

  if (event.data.type === "SALADICT_PANEL_SEARCH") {
    const text = String(event.data.payload?.text || "").trim()
    if (
      hasRestoredSnapshotResults &&
      text &&
      text === restoredSnapshotText
    ) {
      return
    }

    hasRestoredSnapshotResults = false
    restoredSnapshotText = ""
    if (input) {
      input.value = text
    }
    if (text) {
      runPreferredAction(text)
    }
  }
}

function createPanelSnapshot() {
  const text = lastRenderedText || input?.value?.trim() || ""
  const settledResults = lastSettledResults
    .map(item => {
      const sourceId = item?.source?.id
      const result = item?.result
      if (!sourceId || !result || typeof result !== "object") {
        return null
      }

      const normalizedState = String(result.state || "idle")
      if (normalizedState === "loading") {
        return null
      }

      return {
        sourceId,
        result: {
          state: normalizedState,
          text: String(result.text || ""),
          meta: String(result.meta || ""),
          audio: normalizeAudioMap(result.audio),
        },
      }
    })
    .filter(Boolean)

  return {
    mode: currentViewMode,
    text,
    targetMode: lastTargetMode,
    statusLine:
      typeof statusLine?.textContent === "string" &&
      (statusLine.textContent.includes("正在请求") ||
        statusLine.textContent.includes("正在查询"))
        ? ""
        : statusLine?.textContent || "",
    settledResults,
  }
}

function restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return
  }

  currentViewMode =
    snapshot.mode === "lookup" || snapshot.mode === "translate"
      ? snapshot.mode
      : "idle"
  const text = String(snapshot.text || "").trim()
  if (input) {
    input.value = text
  }

  if (snapshot.targetMode === "en" || snapshot.targetMode === "zh") {
    lastTargetMode = snapshot.targetMode
  }

  if (typeof snapshot.statusLine === "string") {
    setNodeText(statusLine, snapshot.statusLine)
  }

  const settledList = Array.isArray(snapshot.settledResults)
    ? snapshot.settledResults
        .map(item => {
          const source = getActiveConfigsForMode(currentViewMode).find(
            config => config.id === item?.sourceId
          )
          if (!source || !item?.result || typeof item.result !== "object") {
            return null
          }

          return {
            source,
            result: {
              state: String(item.result.state || "idle"),
              text: String(item.result.text || ""),
              meta: String(item.result.meta || ""),
              audio: normalizeAudioMap(item.result.audio),
            },
          }
        })
        .filter(Boolean)
    : []

  restoredSnapshotText = text
  hasRestoredSnapshotResults = settledList.length > 0
  renderCards(text, currentViewMode, settledList)
}

function handleEmbeddedDragStart(event) {
  if (!isEmbeddedPanel) {
    return
  }

  const inTitlebar = !!event.target.closest(".window-titlebar")
  const inOuterFrame =
    !!event.target.closest(".popup-shell") &&
    !event.target.closest(".window-body")

  if (!inTitlebar && !inOuterFrame) {
    return
  }

  if (
    event.target.closest(
      "button, input, textarea, select, a, label, [data-open-url], [data-action]"
    )
  ) {
    return
  }

  isDraggingPanel = true
  postToParent({
    type: "SALADICT_PANEL_DRAG_START",
    payload: {
      clientX: event.clientX,
      clientY: event.clientY,
    },
  })
  event.preventDefault()
}

function handleEmbeddedDragEnd() {
  if (!isEmbeddedPanel || !isDraggingPanel) {
    return
  }

  isDraggingPanel = false
  postToParent({
    type: "SALADICT_PANEL_DRAG_END",
  })
}

function postToParent(message) {
  if (!isEmbeddedPanel) {
    return
  }

  window.parent.postMessage(
    {
      source: PANEL_MESSAGE_SOURCE,
      ...message,
    },
    "*"
  )
}

async function getActiveTab() {
  const tabs = await queryTabs({
    active: true,
    currentWindow: true,
  })
  return tabs?.[0] || null
}

async function syncPinStateFromActiveTab() {
  isPinnedState = false
  syncPinButtonState()
  applySettings(activeSettings)

  try {
    const tab = await getActiveTab()
    if (!tab?.id) {
      return
    }

    const response = await sendMessageToTab(tab.id, {
      type: "SALADICT_QUERY_PANEL_STATE",
    })
    isPinnedState = !!response?.isPinned
    syncPinButtonState()
    applySettings(activeSettings)
  } catch (error) {
    isPinnedState = false
    syncPinButtonState()
    applySettings(activeSettings)
  }
}

function canInjectPanel(url) {
  if (!url) {
    return false
  }

  return !/^(chrome|edge|brave|opera|about|chrome-extension):/i.test(url)
}

async function ensurePanelAvailable(tabId) {
  try {
    await sendMessageToTab(tabId, {
      type: "SALADICT_QUERY_PANEL_STATE",
    })
    return
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error
    }
  }

  await executeScript({
    target: { tabId },
    files: ["browser-api.js", "settings.js", "content-panel.js"],
  })

  await sendMessageToTab(tabId, {
    type: "SALADICT_QUERY_PANEL_STATE",
  })
}

function isMissingReceiverError(error) {
  return (
    error instanceof Error &&
    /Receiving end does not exist|Could not establish connection/i.test(
      error.message
    )
  )
}

async function translateWithGoogle(text, targetMode) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${mapTargetForSource("google", targetMode)}&dt=t&q=${encodeURIComponent(text)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Google HTTP ${response.status}`)
  }

  const data = await response.json()
  const translated = Array.isArray(data?.[0])
    ? data[0].map(item => item?.[0]).filter(Boolean).join("")
    : ""

  if (!translated) {
    throw new Error("Google returned an empty translation.")
  }

  return {
    state: "ok",
    text: translated,
    meta: `检测语言：${data?.[2] || "auto"}；目标语言：${targetMode === "en" ? "英语" : "中文"}`,
  }
}

async function translateWithCaiyun(text, targetMode, token) {
  const sourceLanguage = decideCaiyunSourceLanguage(text, targetMode)
  const targetLanguage = targetMode === "en" ? "en" : "zh-CN"
  const response = await fetch("https://api.interpreter.caiyunai.com/v1/translator", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-authorization": `token ${token}`,
    },
    body: JSON.stringify({
      source: text.split(/\n+/),
      trans_type: `${mapCaiyunLanguage(sourceLanguage)}2${mapCaiyunLanguage(targetLanguage)}`,
      detect: sourceLanguage === "auto",
    }),
  })

  if (!response.ok) {
    throw new Error(`彩云 HTTP ${response.status}`)
  }

  const data = await response.json()
  const translated = Array.isArray(data?.target)
    ? data.target.join("\n")
    : ""

  if (!translated) {
    throw new Error("彩云返回了空结果。")
  }

  return {
    state: "ok",
    text: translated,
    meta: `源语言：${describeCaiyunLanguage(sourceLanguage)}；目标语言：${targetMode === "en" ? "英语" : "中文"}`,
  }
}

async function translateWithBaidu(text, targetMode, credential) {
  const salt = `${Date.now()}${Math.random().toString(16).slice(2, 10)}`
  const targetLanguage = mapTargetForSource("baidu", targetMode)
  const sign = md5(`${credential.appid}${text}${salt}${credential.key}`)
  const payload = new URLSearchParams({
    q: text,
    from: "auto",
    to: targetLanguage,
    appid: credential.appid,
    salt,
    sign,
  })

  const response = await fetch("https://api.fanyi.baidu.com/api/trans/vip/translate", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`百度 HTTP ${response.status}`)
  }

  if (data?.error_code) {
    throw new Error(describeBaiduError(data.error_code, data.error_msg))
  }

  const translated = Array.isArray(data?.trans_result)
    ? data.trans_result
        .map(item => item?.dst)
        .filter(Boolean)
        .join("\n")
    : ""

  if (!translated) {
    throw new Error("百度翻译返回了空结果。")
  }

  return {
    state: "ok",
    text: translated,
    meta: `源语言：${describeBaiduLanguage(data?.from || "auto")}；目标语言：${describeBaiduLanguage(data?.to || targetLanguage)}`,
  }
}

async function lookupWithBing(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim()
  const encodedText = encodeURIComponent(normalizedText)
  const candidates = [
    "https://cn.bing.com/dict/clientsearch?mkt=zh-CN&setLang=zh&form=BDVEHC&ClientVer=BDDTV3.5.1.4320&q=" +
      encodedText,
    `https://cn.bing.com/dict/search?q=${encodedText}`,
  ]

  for (const url of candidates) {
    const doc = await requestDirtyDocument(url)
    const parsed = parseBingDocument(doc, normalizedText)
    if (parsed) {
      return parsed
    }
  }

  return {
    state: "unavailable",
    text: "Bing 词典没有找到可用结果。",
    meta: "",
  }
}

async function lookupWithCobuild(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim()
  const slug = encodeURIComponent(normalizedText.replace(/\s+/g, "-"))
  const candidates = [
    `https://www.collinsdictionary.com/dictionary/english/${slug}`,
    `https://www.collinsdictionary.com/zh/dictionary/english/${slug}`,
  ]

  let lastFailureText = ""

  for (const url of candidates) {
    let tabId = null
    try {
      const tab = await openUrl(url, false)
      tabId = tab?.id ?? null

      if (!tabId) {
        throw new Error("无法创建临时词典标签页。")
      }

      return await waitForCobuildResult(tabId, normalizedText)
    } catch (error) {
      lastFailureText =
        error instanceof Error ? error.message : "柯林斯词典当前不可用。"
    } finally {
      if (tabId) {
        try {
          await removeTab(tabId)
        } catch (error) {
        }
      }
    }
  }

  return {
    state: "unavailable",
    text: lastFailureText || "柯林斯词典当前不可用。",
    meta: "",
  }
}

function unavailableResult(text) {
  return Promise.resolve({
    state: "unavailable",
    text,
    meta: "",
  })
}

function decideTargetMode(text) {
  const letters = [...text.matchAll(/\p{L}/gu)].length
  const han = [...text.matchAll(/\p{Script=Han}/gu)].length
  const kana = [...text.matchAll(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)].length
  const hangul = [...text.matchAll(/\p{Script=Hangul}/gu)].length

  if (kana > 0 || hangul > 0) {
    return "zh"
  }

  if (letters === 0) {
    return "zh"
  }

  if (han >= 2 && han / letters >= 0.25) {
    return "en"
  }

  return "zh"
}

function decideCaiyunSourceLanguage(text, targetMode) {
  if (targetMode === "en") {
    return "zh-CN"
  }

  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  if (hasKana) {
    return "ja"
  }

  return "auto"
}

function mapCaiyunLanguage(language) {
  const maps = {
    auto: "auto",
    "zh-CN": "zh",
    en: "en",
    ja: "ja",
  }

  return maps[language] || "auto"
}

function describeCaiyunLanguage(language) {
  const descriptions = {
    auto: "自动识别",
    "zh-CN": "中文",
    en: "英语",
    ja: "日语",
  }

  return descriptions[language] || language
}

function parseBaiduToken(token) {
  const raw = String(token || "").trim()
  if (!raw) {
    return null
  }

  const lineParts = raw
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
  if (lineParts.length >= 2) {
    return {
      appid: lineParts[0],
      key: lineParts[1],
    }
  }

  const separatorIndex = raw.indexOf(":")
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null
  }

  return {
    appid: raw.slice(0, separatorIndex).trim(),
    key: raw.slice(separatorIndex + 1).trim(),
  }
}

function describeBaiduLanguage(language) {
  const descriptions = {
    auto: "自动识别",
    zh: "中文",
    cht: "繁体中文",
    en: "英语",
    jp: "日语",
    kor: "韩语",
    fra: "法语",
    de: "德语",
    spa: "西班牙语",
    ru: "俄语",
    nl: "荷兰语",
  }

  return descriptions[language] || language
}

function describeBaiduError(code, message) {
  const known = {
    "52001": "百度翻译请求超时，请稍后再试。",
    "52002": "百度翻译系统错误，请稍后再试。",
    "52003": "百度翻译凭据无效，请检查 appid 或 key。",
    "54000": "百度翻译请求参数错误。",
    "54001": "百度翻译签名错误，请检查 appid:key 是否正确。",
    "54003": "百度翻译调用频率受限，请稍后再试。",
    "54004": "百度翻译账户余额不足。",
    "54005": "百度翻译请求过长，请缩短内容后重试。",
    "58000": "百度翻译客户端 IP 非法。",
    "58001": "百度翻译目标语言不支持。",
    "58002": "百度翻译服务当前已关闭。",
    "90107": "百度翻译认证失败或未生效。",
  }

  return known[String(code)] || message || `百度翻译错误 ${code}`
}

function mapTargetForSource(sourceId, targetMode) {
  const maps = {
    google: { zh: "zh-CN", en: "en" },
    baidu: { zh: "zh", en: "en" },
    caiyun: { zh: "zh", en: "en" },
  }

  return maps[sourceId]?.[targetMode] || "zh-CN"
}

function getNodeText(node) {
  return String(node?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeAudioMap(audio) {
  if (!audio || typeof audio !== "object") {
    return undefined
  }

  const map = {}
  if (typeof audio.us === "string" && audio.us) {
    map.us = audio.us
  }
  if (typeof audio.uk === "string" && audio.uk) {
    map.uk = audio.uk
  }
  if (typeof audio.py === "string" && audio.py) {
    map.py = audio.py
  }

  return Object.keys(map).length > 0 ? map : undefined
}

function buildAudioActions(audio) {
  const normalized = normalizeAudioMap(audio)
  if (!normalized) {
    return ""
  }

  const actions = []
  if (normalized.uk) {
    actions.push(
      `<button class="result-link" type="button" data-action="play-audio" data-audio-url="${escapeAttr(normalized.uk)}">英音</button>`
    )
  }
  if (normalized.us) {
    actions.push(
      `<button class="result-link" type="button" data-action="play-audio" data-audio-url="${escapeAttr(normalized.us)}">美音</button>`
    )
  }
  if (normalized.py) {
    actions.push(
      `<button class="result-link" type="button" data-action="play-audio" data-audio-url="${escapeAttr(normalized.py)}">拼音</button>`
    )
  }

  return actions.join("")
}

function playAudioUrl(url) {
  try {
    if (activeAudioPlayer) {
      activeAudioPlayer.pause()
      activeAudioPlayer.currentTime = 0
    }
  } catch (error) {
  }

  try {
    activeAudioPlayer = new Audio(url)
    activeAudioPlayer.play().catch(() => {
      setNodeText(statusLine, "发音播放失败，请稍后重试。")
    })
  } catch (error) {
    setNodeText(statusLine, "发音播放失败，请稍后重试。")
  }
}

function extractBingMp3FromOnclick(node) {
  const onclick = String(node?.getAttribute?.("onclick") || "")
  const match = onclick.match(/https?:\/\/[^'"\s)]+\.mp3/i)
  return match?.[0] || ""
}

function sleep(ms) {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

async function waitForCobuildResult(tabId, fallbackTitle) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(attempt === 0 ? 1500 : 1000)

    let payload = null
    try {
      const results = await executeScript({
        target: { tabId },
        func: extractCobuildFromPage,
        args: [fallbackTitle],
      })
      payload = results?.[0]?.result || null
    } catch (error) {
      if (attempt === 11) {
        throw error
      }
      continue
    }

    if (!payload) {
      continue
    }

    if (payload.status === "challenge") {
      continue
    }

    if (payload.status === "blocked") {
      return {
        state: "unavailable",
        text: "柯林斯词典当前要求通过站点校验，扩展暂时无法直接抓取。",
        meta: "",
      }
    }

    if (payload.status === "no-result") {
      return {
        state: "unavailable",
        text: `柯林斯词典没有找到 “${fallbackTitle}” 的结果。`,
        meta: "",
      }
    }

    if (payload.status === "ok") {
      return {
        state: "ok",
        text: payload.text || fallbackTitle,
        meta: payload.meta || "柯林斯词典",
        audio: normalizeAudioMap(payload.audio),
      }
    }
  }

  return {
    state: "unavailable",
    text: "柯林斯词典页面校验超时，请稍后再试。",
    meta: "",
  }
}

function extractCobuildFromPage(fallbackTitle) {
  function cleanLineText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .join("\n")
  }

  function absolutize(url) {
    const raw = String(url || "").trim()
    if (!raw) {
      return ""
    }

    try {
      return new URL(raw, window.location.origin).href
    } catch (error) {
      return raw
    }
  }

  function getAudio(section) {
    const button = section.querySelector(".pron .audio_play_button")
    return absolutize(button?.getAttribute("data-src-mp3"))
  }

  const pageTitle = String(document.title || "").trim()
  const bodyText = cleanLineText(document.body?.innerText || "")

  if (
    /Just a moment/i.test(pageTitle) ||
    /Enable JavaScript and cookies to continue/i.test(bodyText)
  ) {
    return { status: "challenge" }
  }

  if (/Attention Required|Cloudflare/i.test(pageTitle)) {
    return { status: "blocked" }
  }

  const sections = Array.from(document.querySelectorAll("[data-type-block]"))
    .filter(section => {
      const type = String(section.getAttribute("data-type-block") || "")
      return (
        type &&
        type !== "Video" &&
        type !== "Trends" &&
        type !== "英语词汇表" &&
        type !== "趋势"
      )
    })
    .map(section => {
      const type = String(section.getAttribute("data-type-block") || "")
      const title = String(section.getAttribute("data-title-block") || "")
      const num = String(section.getAttribute("data-num-block") || "")
      const heading = [type, title, num].filter(Boolean).join(" ")
      const text = cleanLineText(section.innerText || "")
      const audio = getAudio(section)

      return {
        type,
        title,
        num,
        heading,
        text,
        audio,
      }
    })
    .filter(section => section.text)

  if (sections.length === 0) {
    if (/no results|did you mean|not found/i.test(bodyText)) {
      return { status: "no-result" }
    }

    return { status: "blocked" }
  }

  const limitedSections = sections.slice(0, 4)
  const text = limitedSections
    .map(section => {
      if (section.heading && !section.text.startsWith(section.heading)) {
        return `${section.heading}\n${section.text}`
      }
      return section.text
    })
    .join("\n\n")
    .slice(0, 4000)

  const audio = {}
  limitedSections.forEach(section => {
    if (!section.audio) {
      return
    }

    if (section.type === "American") {
      audio.us = section.audio
      return
    }

    if (section.type === "English" || section.type === "Learner") {
      audio.uk = section.audio
    }
  })

  const metaSections = limitedSections
    .map(section => section.heading || section.type)
    .filter(Boolean)

  return {
    status: "ok",
    text: text || fallbackTitle,
    meta:
      metaSections.length > 0
        ? `柯林斯词典：${metaSections.join(" / ")}`
        : "柯林斯词典",
    audio,
  }
}

function normalizeBingMediaUrl(url) {
  const raw = String(url || "").trim()
  if (!raw) {
    return ""
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`
  }

  if (raw.startsWith("/")) {
    return `https://cn.bing.com${raw}`
  }

  return raw
}

function parseBingLexResult(doc) {
  const title = getNodeText(doc.querySelector(".client_def_hd_hd"))
  if (!title) {
    return {
      state: "unavailable",
      text: "Bing 词典没有返回词典释义。",
      meta: "",
    }
  }

  const phsym = Array.from(doc.querySelectorAll(".client_def_hd_pn_list"))
    .map(item => {
      const lang = getNodeText(item.querySelector(".client_def_hd_pn"))
      const pron = extractBingMp3FromOnclick(item.querySelector(".client_aud_o"))
      return { lang, pron }
    })
    .filter(item => item.lang || item.pron)

  const audio = {}
  phsym.forEach(item => {
    if (/us|美/i.test(item.lang) && item.pron) {
      audio.us = item.pron
    } else if (/uk|英/i.test(item.lang) && item.pron) {
      audio.uk = item.pron
    }
  })

  const defs = Array.from(doc.querySelectorAll(".client_def_bar"))
    .map(item => {
      const pos = getNodeText(item.querySelector(".client_def_title_bar"))
      const def = getNodeText(item.querySelector(".client_def_list"))
      if (!pos && !def) {
        return ""
      }
      return pos ? `${pos} ${def}`.trim() : def
    })
    .filter(Boolean)
    .slice(0, 8)

  const inflections = Array.from(doc.querySelectorAll(".client_word_change_word"))
    .map(getNodeText)
    .filter(Boolean)
    .slice(0, 8)

  const sentences = Array.from(doc.querySelectorAll(".client_sentence_list"))
    .map(item => {
      const en = getNodeText(item.querySelector(".client_sen_en"))
      const chs = getNodeText(item.querySelector(".client_sen_cn"))
      const source = getNodeText(item.querySelector(".client_sentence_list_link"))
      if (!en && !chs) {
        return ""
      }
      const line = chs ? `${en}\n${chs}`.trim() : en
      return source ? `${line}\n来源：${source}` : line
    })
    .filter(Boolean)
    .slice(0, 3)

  const sections = [title]
  if (defs.length > 0) {
    sections.push(defs.map(def => `- ${def}`).join("\n"))
  }
  if (inflections.length > 0) {
    sections.push(`词形变化：${inflections.join(" / ")}`)
  }
  if (sentences.length > 0) {
    sections.push(`例句：\n${sentences.join("\n\n")}`)
  }

  const pronunciationText = phsym
    .map(item => item.lang)
    .filter(Boolean)
    .join(" / ")

  return {
    state: "ok",
    text: sections.join("\n\n"),
    meta: pronunciationText ? `音标：${pronunciationText}` : "Bing 词典释义",
    audio: normalizeAudioMap(audio),
  }
}

function parseBingSentenceFallbackResult(doc, fallbackTitle) {
  const sentences = Array.from(doc.querySelectorAll(".client_sentence_list"))
    .map(item => {
      const en = getNodeText(item.querySelector(".client_sen_en"))
      const chs = getNodeText(item.querySelector(".client_sen_cn"))
      const source = getNodeText(item.querySelector(".client_sentence_list_link"))
      const audio = normalizeBingMediaUrl(
        item.querySelector(".client_bdsen_audio")?.getAttribute("data-mp3link")
      )

      if (!en && !chs) {
        return null
      }

      const lines = []
      if (en) {
        lines.push(en)
      }
      if (chs) {
        lines.push(chs)
      }
      if (source) {
        lines.push(`来源：${source}`)
      }

      return {
        text: lines.join("\n"),
        audio,
      }
    })
    .filter(Boolean)
    .slice(0, 5)

  if (sentences.length === 0) {
    return null
  }

  const firstAudio = sentences.find(item => item.audio)?.audio
  const sections = []
  if (fallbackTitle) {
    sections.push(fallbackTitle)
  }
  sections.push(`例句：\n${sentences.map(item => item.text).join("\n\n")}`)

  return {
    state: "ok",
    text: sections.join("\n\n"),
    meta: "Bing 双语例句",
    audio: firstAudio ? normalizeAudioMap({ us: firstAudio }) : undefined,
  }
}

function parseBingDocument(doc, fallbackTitle) {
  if (doc.querySelector(".client_def_hd_hd")) {
    return parseBingLexResult(doc)
  }

  if (doc.querySelector(".client_trans_head")) {
    return parseBingMachineResult(doc)
  }

  if (doc.querySelector(".client_do_you_mean_title_bar")) {
    return parseBingRelatedResult(doc)
  }

  if (doc.querySelector(".client_sentence_list")) {
    return parseBingSentenceFallbackResult(doc, fallbackTitle)
  }

  return null
}

function requestDirtyDocument(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", url, true)
    xhr.responseType = "document"
    xhr.withCredentials = false

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status}`))
        return
      }

      const responseDoc = xhr.responseXML || xhr.response
      if (responseDoc && typeof responseDoc.querySelector === "function") {
        resolve(responseDoc)
        return
      }

      resolve(
        new DOMParser().parseFromString(xhr.responseText || "", "text/html")
      )
    }

    xhr.onerror = () => {
      reject(new Error("NETWORK_ERROR"))
    }

    xhr.send()
  })
}

function parseBingMachineResult(doc) {
  const mt = getNodeText(doc.querySelector(".client_sen_cn"))
  if (!mt) {
    return {
      state: "unavailable",
      text: "Bing 没有返回机器翻译结果。",
      meta: "",
    }
  }

  return {
    state: "ok",
    text: mt,
    meta: "Bing 机器翻译结果",
  }
}

function parseBingRelatedResult(doc) {
  const title = getNodeText(doc.querySelector(".client_do_you_mean_title_bar"))
  const blocks = []

  doc.querySelectorAll(".client_do_you_mean_area").forEach(area => {
    const groupTitle = getNodeText(area.querySelector(".client_do_you_mean_title"))
    const meanings = Array.from(area.querySelectorAll(".client_do_you_mean_list"))
      .map(item => {
        const word = getNodeText(item.querySelector(".client_do_you_mean_list_word"))
        const def = getNodeText(item.querySelector(".client_do_you_mean_list_def"))
        if (!word && !def) {
          return ""
        }
        return def ? `- ${word}：${def}` : `- ${word}`
      })
      .filter(Boolean)

    if (meanings.length > 0) {
      blocks.push(`${groupTitle || "相关词"}\n${meanings.join("\n")}`)
    }
  })

  if (blocks.length === 0) {
    return {
      state: "unavailable",
      text: "Bing 没有返回相关词结果。",
      meta: "",
    }
  }

  return {
    state: "ok",
    text: `${title || "相关词推荐"}\n\n${blocks.join("\n\n")}`,
    meta: "Bing 相关词推荐",
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function escapeAttr(value) {
  return escapeHtml(value)
}
