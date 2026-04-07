const input = document.querySelector("#sentence-input")
const results = document.querySelector("#results")
const statusLine = document.querySelector("#status-line")
const subtitle = document.querySelector("#window-subtitle")
const hintText = document.querySelector("#hint-text")
const translateBtn = document.querySelector("#translate-btn")
const wordwebBtn = document.querySelector("#wordweb-btn")
const pinBtn = document.querySelector("#pin-btn")
const expandAllBtn = document.querySelector("#expand-all-btn")
const collapseAllBtn = document.querySelector("#collapse-all-btn")
const settingsBtn = document.querySelector(".settings-btn")
const closeBtn = document.querySelector(".close-btn")
const {
  openOptionsPage,
  openUrl,
  queryTabs,
  executeScript,
  sendMessageToTab,
  sendRuntimeMessage,
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
const expandedBingSenseExampleKeys = new Set()
let lastSettledResults = []
let currentViewMode = "idle"
let lastRenderedText = ""
let isPinnedState = false
let isDraggingPanel = false
let hasRestoredSnapshotResults = false
let restoredSnapshotText = ""
let restoredSnapshotMode = "auto"
let activeAudioTrigger = null
let activeAudioPlayer = null
let activeAudioObjectUrl = ""
let temporaryEnabledTranslationSourceIds = new Set()
let activeTranslationEntriesSnapshot = []
let activeTranslationResultsBySourceId = new Map()
const collinsEntrySelections = new Map()

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

function getVisibleCardSourceIds(mode, translationEntries = null) {
  if (mode === "translate") {
    const entries =
      Array.isArray(translationEntries) && translationEntries.length > 0
        ? translationEntries
        : getTranslationSourceEntries()

    return entries
      .filter(entry => entry?.enabled && entry?.source?.id)
      .map(entry => entry.source.id)
  }

  if (mode === "lookup") {
    return getActiveConfigsForMode(mode).map(source => source.id)
  }

  return []
}

function syncBatchToggleButtonState(button, enabled, title) {
  if (!button) {
    return
  }

  button.disabled = !enabled
  button.setAttribute("aria-disabled", button.disabled ? "true" : "false")
  button.title = title
}

function syncCollapseButtonsState(translationEntries = null) {
  const visibleSourceIds = getVisibleCardSourceIds(
    currentViewMode,
    translationEntries
  )
  const canExpandAll = visibleSourceIds.some(sourceId =>
    collapsedSourceIds.has(sourceId)
  )
  const canCollapseAll = visibleSourceIds.some(
    sourceId => !collapsedSourceIds.has(sourceId)
  )

  syncBatchToggleButtonState(
    expandAllBtn,
    canExpandAll,
    canExpandAll ? "展开当前所有结果" : "当前没有可展开的结果"
  )
  syncBatchToggleButtonState(
    collapseAllBtn,
    canCollapseAll,
    canCollapseAll ? "收起当前所有结果" : "当前没有可收起的结果"
  )
}

function collapseAllVisibleCards() {
  const visibleSourceIds = getVisibleCardSourceIds(
    currentViewMode,
    activeTranslationEntriesSnapshot
  )

  if (visibleSourceIds.length <= 0) {
    syncCollapseButtonsState(activeTranslationEntriesSnapshot)
    return
  }

  let changed = false
  for (const sourceId of visibleSourceIds) {
    if (!collapsedSourceIds.has(sourceId)) {
      collapsedSourceIds.add(sourceId)
      changed = true
    }
  }

  syncCollapseButtonsState(activeTranslationEntriesSnapshot)

  if (!changed || !lastRenderedText) {
    return
  }

  renderCards(
    lastRenderedText,
    currentViewMode,
    lastSettledResults,
    activeTranslationEntriesSnapshot
  )
}

function expandAllVisibleCards() {
  const visibleSourceIds = getVisibleCardSourceIds(
    currentViewMode,
    activeTranslationEntriesSnapshot
  )

  if (visibleSourceIds.length <= 0) {
    syncCollapseButtonsState(activeTranslationEntriesSnapshot)
    return
  }

  let changed = false
  for (const sourceId of visibleSourceIds) {
    if (collapsedSourceIds.has(sourceId)) {
      collapsedSourceIds.delete(sourceId)
      changed = true
    }
  }

  syncCollapseButtonsState(activeTranslationEntriesSnapshot)

  if (!changed || !lastRenderedText) {
    return
  }

  renderCards(
    lastRenderedText,
    currentViewMode,
    lastSettledResults,
    activeTranslationEntriesSnapshot
  )
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
    id: "collins_youdao",
    label: "有道词典",
    href: text =>
      `https://dict.youdao.com/w/${encodeURIComponent(
        String(text || "").replace(/\s+/g, " ").trim()
      )}`,
    lookup: lookupWithYoudaoCollins,
  },
  {
    id: "bing",
    label: "必应词典",
    href: text =>
      `https://cn.bing.com/dict/search?q=${encodeURIComponent(
        String(text || "").replace(/\s+/g, " ").trim()
      )}`,
    lookup: lookupWithBing,
  },
  {
    id: "cambridge",
    label: "剑桥词典",
    href: text => getCambridgeSrcPage(text),
    lookup: lookupWithCambridge,
  },
  {
    id: "longman",
    label: "朗文词典",
    href: text => getLongmanSrcPage(text),
    lookup: lookupWithLongman,
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
  stopAudioPlayback()
  if (isEmbeddedPanel) {
    postToParent({
      type: "SALADICT_PANEL_CLOSE",
    })
    return
  }

  window.close()
})

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") {
    return
  }

  event.preventDefault()
  stopAudioPlayback()

  if (isEmbeddedPanel) {
    postToParent({
      type: "SALADICT_PANEL_CLOSE",
    })
    return
  }

  window.close()
})

results?.addEventListener("click", event => {
  const cambridgeToggle = event.target.closest?.(".js-accord, .daccord_h")
  if (cambridgeToggle && cambridgeToggle.closest?.(".dictCambridge-Entry")) {
    event.preventDefault()
    if (cambridgeToggle.classList.contains("js-accord")) {
      cambridgeToggle.classList.toggle("open")
    }

    if (cambridgeToggle.classList.contains("daccord_h")) {
      cambridgeToggle.parentElement?.classList.toggle("open")
    }
    return
  }

  const bingSenseToggle = event.target.closest?.(
    "[data-action='toggle-bing-sense-examples']"
  )
  if (bingSenseToggle) {
    const senseKey = bingSenseToggle.getAttribute("data-bing-sense-key")
    if (!senseKey) {
      return
    }

    if (expandedBingSenseExampleKeys.has(senseKey)) {
      expandedBingSenseExampleKeys.delete(senseKey)
    } else {
      expandedBingSenseExampleKeys.add(senseKey)
    }

    renderCards(lastRenderedText, currentViewMode, lastSettledResults)
    return
  }

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

  const tempEnableBtn = event.target.closest?.(
    "[data-action='temporary-enable-source']"
  )
  if (tempEnableBtn) {
    const sourceId = tempEnableBtn.getAttribute("data-source-id")
    if (!sourceId) {
      return
    }

    enableTranslationSourceTemporarily(sourceId).catch(() => {})
    return
  }

  const speakerBtn = event.target.closest?.(".saladict-Speaker")
  if (speakerBtn) {
    const url =
      speakerBtn.getAttribute("data-audio-url") ||
      normalizeSpeakerHref(speakerBtn.getAttribute("href"))
    if (!url) {
      return
    }

    event.preventDefault()
    playAudioUrl(url, speakerBtn)
    return
  }

  const playBtn = event.target.closest?.("[data-action='play-audio']")
  if (playBtn) {
    const url = playBtn.getAttribute("data-audio-url")
    if (!url) {
      return
    }

    event.preventDefault()
    playAudioUrl(url, playBtn)
    return
  }

  const openBtn = event.target.closest?.("[data-open-url]")
  if (!openBtn) {
    const contentLink = event.target.closest?.(".result-body a[href]")
    if (!contentLink || contentLink.classList.contains("saladict-Speaker")) {
      return
    }

    const contentUrl = contentLink.getAttribute("href")
    if (!contentUrl || contentUrl === "#") {
      return
    }

    event.preventDefault()
    openUrl(contentUrl, false)
    return
  }

  const url = openBtn.getAttribute("data-open-url")
  if (!url) {
    return
  }

  event.preventDefault()
  openUrl(url, false)
})

results?.addEventListener("change", event => {
  const entrySelect = event.target.closest?.(
    "[data-action='select-collins-entry']"
  )
  if (!entrySelect) {
    return
  }

  const sourceId = entrySelect.getAttribute("data-source-id")
  if (!sourceId) {
    return
  }

  const nextIndex = Number(entrySelect.value) || 0
  setCollinsEntrySelection(sourceId, nextIndex)
  renderCards(lastRenderedText, currentViewMode, lastSettledResults)
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
  runSearch(input.value.trim(), "auto")
})

translateBtn?.addEventListener("click", () => {
  runSearch(input.value.trim(), "translate")
})

wordwebBtn?.addEventListener("click", () => {
  runSearch(input.value.trim(), "lookup")
})

expandAllBtn?.addEventListener("click", () => {
  expandAllVisibleCards()
})

collapseAllBtn?.addEventListener("click", () => {
  collapseAllVisibleCards()
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

    if (!isEmbeddedPanel) {
      requestAnimationFrame(() => {
        if (input instanceof HTMLInputElement) {
          input.focus({ preventScroll: true })
        }
      })
    }
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
  activeTranslationEntriesSnapshot = getTranslationSourceEntries().map(
    entry => ({
      source: entry.source,
      enabled: entry.enabled,
    })
  )
  activeTranslationResultsBySourceId = new Map()
  const enabledTranslationEntries = activeTranslationEntriesSnapshot.filter(
    entry => entry.enabled
  )
  activeTranslationSourceConfigs = enabledTranslationEntries.map(
    entry => entry.source
  )

  if (!text) {
    currentViewMode = "idle"
    lastRenderedText = ""
    activeTranslationEntriesSnapshot = []
    activeTranslationResultsBySourceId = new Map()
    setNodeText(statusLine, "请先输入要翻译的句子。")
    renderCards("", "idle")
    return
  }

  const targetMode = decideTargetMode(text)
  lastTargetMode = targetMode

  if (enabledTranslationEntries.length === 0) {
    setNodeText(
      statusLine,
      "当前没有启用的翻译源，可以先临时启用一个源。"
    )
    renderCards(
      text,
      "translate",
      getTranslationSettledResults(activeTranslationEntriesSnapshot),
      activeTranslationEntriesSnapshot
    )
    return
  }

  setNodeText(
    statusLine,
    `正在请求 ${enabledTranslationEntries.length} 个翻译源，目标语言：${targetMode === "en" ? "英语" : "中文"}...`
  )
  const states = new Map()
  enabledTranslationEntries.forEach(entry => {
    const source = entry.source
    const loadingResult = {
      state: "loading",
      text: "请求中...",
      meta: "",
    }
    states.set(source.id, loadingResult)
    activeTranslationResultsBySourceId.set(source.id, loadingResult)
  })
  renderCards(
    text,
    "translate",
    getTranslationSettledResults(activeTranslationEntriesSnapshot),
    activeTranslationEntriesSnapshot
  )

  let finishedCount = 0
  const totalCount = enabledTranslationEntries.length

  await Promise.all(
    enabledTranslationEntries.map(async entry => {
      const source = entry.source
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
      activeTranslationResultsBySourceId.set(source.id, result)
      finishedCount += 1
      setNodeText(
        statusLine,
        `已完成 ${finishedCount}/${totalCount} 个翻译源，目标语言：${targetMode === "en" ? "英语" : "中文"}。`
      )
      renderCards(
        text,
        "translate",
        getTranslationSettledResults(activeTranslationEntriesSnapshot),
        activeTranslationEntriesSnapshot
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

function normalizeSearchMode(mode) {
  return mode === "lookup" || mode === "translate" ? mode : "auto"
}

function decideActionMode(text, requestedMode = "auto") {
  const nextRequestedMode = normalizeSearchMode(requestedMode)
  if (nextRequestedMode !== "auto") {
    return nextRequestedMode
  }

  return decideViewMode(text)
}

function runSearch(text, requestedMode = "auto") {
  const nextMode = decideActionMode(text, requestedMode)
  if (nextMode === "lookup") {
    runDictionaryLookup(text)
    return
  }

  runTranslations(text)
}

function renderCards(
  text,
  mode = currentViewMode,
  settled = [],
  translationEntries = null
) {
  if (!results) {
    return
  }

  currentViewMode = mode
  lastRenderedText = text
  lastSettledResults = settled

  if (mode === "idle") {
    results.innerHTML = ""
    syncCollapseButtonsState([])
    return
  }

  const activeConfigs = getActiveConfigsForMode(mode)
  const states = new Map(settled.map(item => [item.source.id, item.result]))

  if (mode === "translate") {
    const visibleTranslationEntries =
      Array.isArray(translationEntries) && translationEntries.length > 0
        ? translationEntries
        : getTranslationSourceEntries()

    results.innerHTML = visibleTranslationEntries
      .map(entry => {
        const source = entry.source
        const isEnabled = entry.enabled
        const result = isEnabled
          ? states.get(source.id) || {
              state: "idle",
              text: "",
              meta: "",
            }
          : {
              state: "unavailable",
              text: "当前未启用此翻译源。",
              meta: "",
            }
        const isCollapsed = isEnabled && collapsedSourceIds.has(source.id)
        const bodyMarkup = isCollapsed ? "" : renderResultBody(source, result)
        const metaMarkup = isCollapsed || !result.meta
          ? ""
          : `<div class="result-meta">${escapeHtml(result.meta)}</div>`
        const hasContent = Boolean(bodyMarkup) || Boolean(result.meta)

        const klass =
          result.state === "loading"
            ? "result-card is-loading"
            : result.state === "unavailable"
            ? isEnabled
              ? "result-card is-unavailable"
              : "result-card is-unavailable is-temporary-source"
            : result.state === "error"
            ? "result-card is-error"
            : "result-card"
        const cardClass = isCollapsed ? `${klass} is-collapsed` : klass
        const collapseLabel = isCollapsed ? "展开" : "收起"
        const showCollapseButton = isEnabled && (isCollapsed || hasContent)
        const isEmptyExpanded = !isCollapsed && !bodyMarkup && !result.meta
        const cardClassWithEmpty = isEmptyExpanded
          ? `${cardClass} is-empty`
          : cardClass
        const audioActions = isEnabled
          ? buildAudioActions(result.audio, result)
          : ""
        const tempEnableAction = isEnabled
          ? ""
          : `<button class="result-link result-link--primary" type="button" data-action="temporary-enable-source" data-source-id="${escapeAttr(source.id)}">临时启用此源</button>`

        return `
          <article class="${cardClassWithEmpty}" data-source-id="${escapeAttr(source.id)}">
            <div class="result-head">
              <div class="result-title">${escapeHtml(source.label)}</div>
              <div class="result-actions">
                ${audioActions}
                ${tempEnableAction}
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
      })
      .join("")
    syncCollapseButtonsState(visibleTranslationEntries)
    return
  }

  results.innerHTML = activeConfigs
    .map(source => {
      const result = states.get(source.id) || {
        state: "idle",
        text: "",
        meta: "",
      }
      const isCollapsed = collapsedSourceIds.has(source.id)
      const bodyMarkup = isCollapsed ? "" : renderResultBody(source, result)
      const metaMarkup = isCollapsed || !result.meta
        ? ""
        : `<div class="result-meta">${escapeHtml(result.meta)}</div>`
      const hasContent = Boolean(bodyMarkup) || Boolean(result.meta)

      const klass =
        result.state === "loading"
          ? "result-card is-loading"
          : result.state === "unavailable"
          ? "result-card is-unavailable"
          : result.state === "error"
          ? "result-card is-error"
          : "result-card"
      const cardClass = isCollapsed ? `${klass} is-collapsed` : klass
      const collapseLabel = isCollapsed ? "展开" : "收起"
      const showCollapseButton = isCollapsed || hasContent
      const isEmptyExpanded = !isCollapsed && !bodyMarkup && !result.meta
      const cardClassWithEmpty = isEmptyExpanded
        ? `${cardClass} is-empty`
        : cardClass
      const audioActions = buildAudioActions(result.audio, result)

      return `
        <article class="${cardClassWithEmpty}" data-source-id="${escapeAttr(source.id)}">
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
    })
    .join("")
  syncCollapseButtonsState()
}

function renderResultBody(source, result) {
  if (!result || typeof result !== "object") {
    return ""
  }

  if (result.kind === "youdao-collins" && result.data) {
    return `
      <div class="result-body result-body-rich">
        ${renderYoudaoDictionaryBody(source.id, result.data)}
      </div>
    `
  }

  if (result.kind === "youdao-related" && result.data?.html) {
    return `
      <div class="result-body result-body-rich">
        <div class="dictYoudao-Related">${result.data.html}</div>
      </div>
    `
  }

  if (result.kind === "cambridge" && result.data?.entries) {
    return `
      <div class="result-body result-body-rich">
        ${renderCambridgeDictionaryBody(result.data)}
      </div>
    `
  }

  if (result.kind === "longman" && result.data) {
    return `
      <div class="result-body result-body-rich">
        ${renderLongmanDictionaryBody(result.data)}
      </div>
    `
  }

  if (result.kind === "bing" && result.data) {
    return `
      <div class="result-body result-body-rich">
        ${renderBingDictionaryBody(result.data)}
      </div>
    `
  }

  if (!result.text) {
    return ""
  }

  return `<div class="result-body">${escapeHtml(result.text)}</div>`
}

function renderYoudaoDictionaryBody(sourceId, data) {
  const titleMarkup = data.title
    ? `
      <div class="dictYoudao-HeaderContainer">
        <h1 class="dictYoudao-Title">${escapeHtml(data.title)}</h1>
        ${data.pattern
          ? `<span class="dictYoudao-Pattern">${escapeHtml(data.pattern)}</span>`
          : ""}
      </div>
    `
    : ""

  const headerBits = []
  if (Number(data.stars) > 0) {
    headerBits.push(renderStarRateMarkup(data.stars, "dictYoudao-Stars", "1.1em"))
  }

  const prons = Array.isArray(data.prons) ? data.prons : []
  prons.forEach(pron => {
    if (!pron?.url) {
      return
    }

    headerBits.push(`
      <span class="dictYoudao-PronItem">
        ${escapeHtml(pron.phsym || "")}
        ${renderSpeakerMarkup(pron.url)}
      </span>
    `)
  })

  if (data.rank) {
    headerBits.push(`<span class="dictYoudao-Rank">${escapeHtml(data.rank)}</span>`)
  }

  const headerMetaMarkup = headerBits.length
    ? `<div class="dictYoudao-HeaderContainer">${headerBits.join("")}</div>`
    : ""

  const collinsEntries = Array.isArray(data.collins)
    ? data.collins.filter(entry => entry && entry.content)
    : []
  const selectedEntryIndex = getSelectedCollinsEntryIndex(
    sourceId,
    collinsEntries.length,
    data.activeCollinsEntry
  )
  const selectedCollinsEntry = collinsEntries[selectedEntryIndex] || null
  const collinsSelectMarkup = collinsEntries.length > 1
    ? `
      <div class="dictYoudao-EntrySelectWrap">
        <select
          class="dictYoudao-EntrySelect"
          data-action="select-collins-entry"
          data-source-id="${escapeAttr(sourceId)}"
        >
          ${collinsEntries
            .map((entry, index) => `
              <option value="${index}"${index === selectedEntryIndex ? " selected" : ""}>
                ${escapeHtml(entry.title || `义项 ${index + 1}`)}
              </option>
            `)
            .join("")}
        </select>
      </div>
    `
    : ""

  const collinsMarkup = selectedCollinsEntry
    ? renderEntryBox(
        "柯林斯英汉双解",
        `
          ${collinsSelectMarkup}
          <div class="dictYoudao-Collins">${selectedCollinsEntry.content}</div>
        `
      )
    : ""

  const basicMarkup = data.basic
    ? `<div class="dictYoudao-Basic">${data.basic}</div>`
    : ""
  const discriminationMarkup = data.discrimination
    ? `
      <div class="dictYoudao-Discrimination">
        <h1 class="dictYoudao-Discrimination_Title">词义辨析</h1>
        ${data.discrimination}
      </div>
    `
    : ""
  const sentenceMarkup = data.sentence
    ? renderEntryBox(
        "权威例句",
        `<ol class="dictYoudao-Sentence">${data.sentence}</ol>`
      )
    : ""
  const translationMarkup = data.translation
    ? renderEntryBox(
        "机器翻译",
        `<div class="dictYoudao-Translation">${data.translation}</div>`
      )
    : ""

  return [
    titleMarkup,
    headerMetaMarkup,
    basicMarkup,
    collinsMarkup,
    discriminationMarkup,
    sentenceMarkup,
    translationMarkup,
  ].join("")
}

function renderCambridgeDictionaryBody(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : []
  return entries
    .map((entry, index) => {
      const entryId = escapeAttr(entry.id || `d-cambridge-entry${index}`)
      const extraClass = entry.isRelated ? " dictCambridge-Entry--related" : ""
      return `
        <section class="dictCambridge-Entry${extraClass}" id="${entryId}">
          ${entry.html || ""}
        </section>
      `
    })
    .join("")
}

function renderBingDictionaryBody(data) {
  if (!data || typeof data !== "object") {
    return ""
  }

  const senseGroups = Array.isArray(data.senses) ? data.senses : []
  if (data.type === "machine" && data.mt) {
    return `<p>${escapeHtml(data.mt)}</p>`
  }

  if (data.type === "related") {
    const defs = Array.isArray(data.defs) ? data.defs : []
    return `
      <h1 class="dictBing-Related_Title">${escapeHtml(data.title || "")}</h1>
      ${defs
        .map(def => `
          <h2 class="dictBing-Related_Title">${escapeHtml(def.title || "")}</h2>
          <ul>
            ${(Array.isArray(def.meanings) ? def.meanings : [])
              .map(meaning => `
                <li class="dictBing-Related_Meaning">
                  <a
                    class="dictBing-Related_Meaning_Word"
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    href="${escapeAttr(meaning.href || "#")}"
                  >${escapeHtml(meaning.word || "")}</a>
                  <span class="dictBing-Related_Meaning_Def">${escapeHtml(meaning.def || "")}</span>
                </li>
              `)
              .join("")}
          </ul>
        `)
        .join("")}
    `
  }

  if (data.type !== "lex") {
    return ""
  }

  const phsym = Array.isArray(data.phsym) ? data.phsym : []
  const cdef = senseGroups.length > 0 ? [] : Array.isArray(data.cdef) ? data.cdef : []
  const infs = Array.isArray(data.infs) ? data.infs : []
  const sentences = Array.isArray(data.sentences) ? data.sentences : []

  return `
    <h1 class="dictBing-Title">${escapeHtml(data.title || "")}</h1>

    ${phsym.length > 0
      ? `
      <ul class="dictBing-Phsym">
        ${phsym
          .map(item => `
            <li class="dictBing-PhsymItem">
              ${escapeHtml(item.lang || "")}
              ${renderSpeakerMarkup(item.pron || "")}
            </li>
          `)
          .join("")}
      </ul>
    `
      : ""}

    ${cdef.length > 0
      ? `
      <ul class="dictBing-Cdef">
        ${cdef
          .map(item => `
            <li class="dictBing-CdefItem">
              <span class="dictBing-CdefItem_Pos">${escapeHtml(item.pos || "")}</span>
              <span class="dictBing-CdefItem_Def">${escapeHtml(item.def || "")}</span>
            </li>
          `)
          .join("")}
      </ul>
    `
      : ""}

    ${senseGroups.length > 0
      ? `
      <div class="dictBing-SenseBlock">
        <h2 class="dictBing-Related_Title">权威英汉双解</h2>
        ${senseGroups
          .map((group, groupIndex) => {
            const groupPos = String(group.pos || "").trim()
            const senses = Array.isArray(group.senses) ? group.senses : []
            return `
              <div class="dictBing-SenseGroup">
                ${groupPos
                  ? `<div class="dictBing-SensePos">${escapeHtml(groupPos)}</div>`
                  : ""}
                <ol class="dictBing-SenseList">
                  ${senses
                    .map((item, senseIndex) => {
                      const senseKey = getBingSenseExampleKey(
                        data.title || "",
                        groupPos,
                        groupIndex,
                        senseIndex,
                        item
                      )
                      const hasExamples =
                        Array.isArray(item.examples) && item.examples.length > 0
                      const examplesOpen =
                        expandedBingSenseExampleKeys.has(senseKey)
                      return `
                        <li class="dictBing-SenseItem${examplesOpen ? " is-open" : ""}" data-bing-sense-key="${escapeAttr(senseKey)}">
                          <div class="dictBing-SenseNum">${escapeHtml(item.num || "")}</div>
                          <div class="dictBing-SenseBody">
                            <div class="dictBing-SenseHeadLine">
                              ${item.titleCn
                                ? `<span class="dictBing-SenseHeadCn">${escapeHtml(item.titleCn)}</span>`
                                : ""}
                              ${item.titleEn
                                ? `<span class="dictBing-SenseHeadEn">${escapeHtml(item.titleEn)}</span>`
                                : ""}
                            </div>
                            <div class="dictBing-SenseDefLine">
                              ${item.defGra
                                ? `<span class="dictBing-SenseGra">${escapeHtml(item.defGra)}</span>`
                                : ""}
                              ${item.defCn
                                ? `<span class="dictBing-SenseDefCn">${escapeHtml(item.defCn)}</span>`
                                : ""}
                              ${item.defEn
                                ? `<span class="dictBing-SenseDefEn">${escapeHtml(item.defEn)}</span>`
                                : ""}
                            </div>
                            ${hasExamples
                              ? `
                              <button
                                class="dictBing-SenseToggle result-link"
                                type="button"
                                data-action="toggle-bing-sense-examples"
                                data-bing-sense-key="${escapeAttr(senseKey)}"
                              >${examplesOpen ? "收起例句" : "展开例句"}</button>
                            `
                              : ""}
                            ${hasExamples
                              ? `
                              <div class="dictBing-SenseExamples${examplesOpen ? " is-open" : ""}">
                                ${item.examples
                                  .map(example => `
                                    <div class="dictBing-SenseExample">
                                      ${example.en
                                        ? `<div class="dictBing-SenseExampleEn">${escapeHtml(example.en)}</div>`
                                        : ""}
                                      ${example.cn
                                        ? `<div class="dictBing-SenseExampleCn">${escapeHtml(example.cn)}</div>`
                                        : ""}
                                    </div>
                                  `)
                                  .join("")}
                              </div>
                            `
                              : ""}
                          </div>
                        </li>
                      `
                    })
                    .join("")}
                </ol>
              </div>
            `
          })
          .join("")}
      </div>
    `
      : ""}

    ${infs.length > 0
      ? `
      <ul class="dictBing-Inf">
        <li>词形：</li>
        ${infs
          .map(item => `<li class="dictBing-InfItem">${escapeHtml(item)}</li>`)
          .join("")}
      </ul>
    `
      : ""}

    ${sentences.length > 0
      ? `
      <ol class="dictBing-SentenceList">
        ${sentences
          .map(item => `
            <li class="dictBing-SentenceItem">
              ${item.en
                ? `
                <p>
                  <span>${item.en}</span>
                  ${renderSpeakerMarkup(item.mp3 || "")}
                </p>
              `
                : ""}
              ${item.chs ? `<p>${item.chs}</p>` : ""}
              ${item.source ? `<footer class="dictBing-SentenceSource">${escapeHtml(item.source)}</footer>` : ""}
            </li>
          `)
          .join("")}
      </ol>
    `
      : ""}
  `
}

function renderLongmanDictionaryBody(data) {
  if (!data || typeof data !== "object") {
    return ""
  }

  if (data.type === "related") {
    return `
      <p>Did you mean:</p>
      <ul class="dictLongman-Related">${data.list}</ul>
    `
  }

  if (data.type !== "lex") {
    return ""
  }

  const dicts = data.bussinessFirst
    ? ["bussiness", "contemporary"]
    : ["contemporary", "bussiness"]

  return `
    ${data.wordfams
      ? `<div class="dictLongman-Wordfams">${data.wordfams}</div>`
      : ""}

    ${dicts
      .map(dict =>
        Array.isArray(data[dict]) && data[dict].length > 0
          ? `
            <div class="dictLongman-Dict">
              ${data[dict]
                .map(entry => renderLongmanEntry(entry))
                .join("")}
            </div>
          `
          : ""
      )
      .join("")}
  `
}

function renderLongmanEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return ""
  }

  const prons = Array.isArray(entry.prons) ? entry.prons : []
  const senses = Array.isArray(entry.senses) ? entry.senses : []
  const examples = Array.isArray(entry.examples) ? entry.examples : []

  return `
    <section class="dictLongman-Entry">
      <header>
        <div class="dictLongman-HeaderContainer">
          <h1 class="dictLongman-Title">
            <span class="dictLongman-Title_HWD">${escapeHtml(entry.title?.HWD || "")}</span>
            <span class="dictLongman-Title_HYPHENATION">${escapeHtml(entry.title?.HYPHENATION || "")}</span>
            <span class="dictLongman-Title_HOMNUM">${escapeHtml(entry.title?.HOMNUM || "")}</span>
          </h1>
          ${entry.level
            ? `<span title="${escapeAttr(entry.level.title || "")}" class="dictLongman-Level">${renderStarRateMarkup(entry.level.rate, "dictLongman-Level_Rate", "1em", "span", 3)}</span>`
            : ""}
          ${Array.isArray(entry.freq)
            ? entry.freq
                .map(freq => `
                  <span
                    class="dictLongman-FREQ"
                    title="${escapeAttr(freq.title || "")}"
                  >${escapeHtml(freq.rank || "")}</span>
                `)
                .join("")
            : ""}
        </div>
        <div class="dictLongman-HeaderContainer">
          ${entry.pos ? `<span class="dictLongman-Pos">${escapeHtml(entry.pos)}</span>` : ""}
          ${entry.phsym ? `<span class="dictLongman-Phsym">${escapeHtml(entry.phsym)}</span>` : ""}
          ${prons
            .map(pron => `
              <span class="dictLongman-Pron">
                ${escapeHtml(String(pron.lang || "").toUpperCase())}:
                ${renderSpeakerMarkup(pron.pron || "")}
              </span>
            `)
            .join("")}
          ${entry.topic
            ? `
              <span class="dictLongman-Topic">
                Topic:
                <a href="${escapeAttr(entry.topic.href || "#")}" rel="nofollow noopener noreferrer">${escapeHtml(entry.topic.title || "")}</a>
              </span>
            `
            : ""}
        </div>
      </header>

      ${senses
        .map(sen => `<div class="dictLongman-Sense">${sen}</div>`)
        .join("")}

      ${entry.collocations
        ? `<div class="dictLongman-Box">${entry.collocations}</div>`
        : ""}

      ${entry.grammar
        ? `<div class="dictLongman-Box">${entry.grammar}</div>`
        : ""}

      ${entry.thesaurus
        ? `<div class="dictLongman-Box">${entry.thesaurus}</div>`
        : ""}

      ${examples.length > 0
        ? `
          <h2 class="dictLongman-Examples_Title">Examples from the Corpus</h2>
          ${examples
            .map(exa => `<div class="dictLongman-Examples">${exa}</div>`)
            .join("")}
        `
        : ""}
    </section>
  `
}

function renderEntryBox(title, content, className = "") {
  if (!content) {
    return ""
  }

  const wrapClass = className ? `entryBox-Wrap ${className}` : "entryBox-Wrap"
  return `
    <div class="${wrapClass}">
      <section class="entryBox">
        <h1 class="entryBox-Title">${escapeHtml(title)}</h1>
        <div>${content}</div>
      </section>
    </div>
  `
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
    return TRANSLATION_SOURCE_CONFIGS
  }

  if (mode === "lookup") {
    return DICTIONARY_SOURCE_CONFIGS
  }

  return []
}

function getTranslationSourceEntries() {
  const enabledIds = new Set([
    ...activeSettings.enabledSourceIds,
    ...temporaryEnabledTranslationSourceIds,
  ])

  return TRANSLATION_SOURCE_CONFIGS.map(source => ({
    source,
    enabled: enabledIds.has(source.id),
  })).sort((left, right) => {
    if (left.enabled === right.enabled) {
      return 0
    }

    return left.enabled ? -1 : 1
  })
}

function getEnabledTranslationSourceConfigs() {
  return getTranslationSourceEntries()
    .filter(entry => entry.enabled)
    .map(entry => entry.source)
}

function getTranslationSettledResults(entries) {
  return entries
    .map(entry => {
      const result = activeTranslationResultsBySourceId.get(entry.source.id)
      if (!result) {
        return null
      }

      return {
        source: entry.source,
        result,
      }
    })
    .filter(Boolean)
}

async function enableTranslationSourceTemporarily(sourceId) {
  if (!sourceId) {
    return
  }

  temporaryEnabledTranslationSourceIds.add(sourceId)
  const snapshotEntry = activeTranslationEntriesSnapshot.find(
    entry => entry.source.id === sourceId
  )
  if (snapshotEntry) {
    snapshotEntry.enabled = true
  }
  activeTranslationSourceConfigs = getEnabledTranslationSourceConfigs()

  if (currentViewMode !== "translate" || !lastRenderedText) {
    return
  }

  const sessionText = lastRenderedText
  const sessionRunId = currentRunId
  if (activeTranslationResultsBySourceId.has(sourceId)) {
    renderCards(
      lastRenderedText,
      "translate",
      getTranslationSettledResults(activeTranslationEntriesSnapshot),
      activeTranslationEntriesSnapshot
    )
    return
  }

  const source = TRANSLATION_SOURCE_CONFIGS.find(item => item.id === sourceId)
  if (!source) {
    renderCards(
      lastRenderedText,
      "translate",
      getTranslationSettledResults(activeTranslationEntriesSnapshot),
      activeTranslationEntriesSnapshot
    )
    return
  }

  const targetMode = lastTargetMode || decideTargetMode(lastRenderedText)
  const loadingResult = {
    state: "loading",
    text: "请求中...",
    meta: "",
  }
  activeTranslationResultsBySourceId.set(sourceId, loadingResult)
  renderCards(
    lastRenderedText,
    "translate",
    getTranslationSettledResults(activeTranslationEntriesSnapshot),
    activeTranslationEntriesSnapshot
  )

  let result
  try {
    result = await source.translate(lastRenderedText, targetMode)
  } catch (error) {
    result = {
      state: "error",
      text: error instanceof Error ? error.message : String(error),
      meta: "请求失败",
    }
  }

  if (
    currentViewMode !== "translate" ||
    !lastRenderedText ||
    currentRunId !== sessionRunId ||
    lastRenderedText !== sessionText
  ) {
    activeTranslationResultsBySourceId.set(sourceId, result)
    return
  }

  activeTranslationResultsBySourceId.set(sourceId, result)
  renderCards(
    lastRenderedText,
    "translate",
    getTranslationSettledResults(activeTranslationEntriesSnapshot),
    activeTranslationEntriesSnapshot
  )
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
  applyTheme(settings.theme)
  activeTranslationSourceConfigs = getEnabledTranslationSourceConfigs()

  const translationLabels = activeTranslationSourceConfigs.map(source => source.label)
  setNodeText(
    hintText,
    translationLabels.length > 0
      ? isPinnedState
        ? "当前为锁定面板，可保持打开"
        : "回车可自动翻译或查词；如需指定，请点击按钮。"
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
  syncCollapseButtonsState(activeTranslationEntriesSnapshot)
}

function applyTheme(theme) {
  const nextTheme =
    theme === "mojavv" || theme === "flatwhite" ? theme : "viista"
  document.body.dataset.theme = nextTheme
  applyThemeControlOverrides(nextTheme)
}

function applyThemeControlOverrides(theme) {
  const controls = [
    input,
    translateBtn,
    wordwebBtn,
    pinBtn,
    settingsBtn,
    closeBtn,
  ].filter(Boolean)

  for (const control of controls) {
    if (!(control instanceof HTMLElement)) {
      continue
    }

    if (theme === "mojavv" || theme === "flatwhite") {
      if (theme === "mojavv" && control === closeBtn) {
        control.style.setProperty("border-color", "rgba(208, 72, 63, 0.24)", "important")
        control.style.setProperty("background", "linear-gradient(180deg, #ff7673 0%, #ff605c 100%)", "important")
        control.style.setProperty("background-color", "#ff605c", "important")
        control.style.setProperty("background-image", "none", "important")
        control.style.setProperty("box-shadow", "none", "important")
        control.style.setProperty("-webkit-box-shadow", "none", "important")
        control.style.setProperty("appearance", "none", "important")
        control.style.setProperty("-webkit-appearance", "none", "important")
        control.style.setProperty("color", "#ffffff", "important")
        control.style.setProperty("text-shadow", "0 -1px 0 rgba(153, 39, 34, 0.45)", "important")
      } else {
        control.style.setProperty("border-color", "rgba(31, 35, 40, 0.08)", "important")
        control.style.setProperty("background", "#ffffff", "important")
        control.style.setProperty("background-color", "#ffffff", "important")
        control.style.setProperty("background-image", "none", "important")
        control.style.setProperty("box-shadow", "none", "important")
        control.style.setProperty("-webkit-box-shadow", "none", "important")
        control.style.setProperty("appearance", "none", "important")
        control.style.setProperty("-webkit-appearance", "none", "important")
        control.style.setProperty("color", "#1f2328", "important")
        control.style.setProperty("text-shadow", "none", "important")
      }
    } else {
      control.style.removeProperty("border-color")
      control.style.removeProperty("background")
      control.style.removeProperty("background-color")
      control.style.removeProperty("background-image")
      control.style.removeProperty("box-shadow")
      control.style.removeProperty("-webkit-box-shadow")
      control.style.removeProperty("appearance")
      control.style.removeProperty("-webkit-appearance")
      control.style.removeProperty("color")
      control.style.removeProperty("text-shadow")
    }
  }

  if (input instanceof HTMLElement) {
    if (theme === "mojavv" || theme === "flatwhite") {
      input.style.setProperty("background", "#ffffff", "important")
      input.style.setProperty("background-color", "#ffffff", "important")
      input.style.setProperty("background-image", "none", "important")
      input.style.setProperty("box-shadow", "none", "important")
      input.style.setProperty("-webkit-box-shadow", "none", "important")
    } else {
      input.style.removeProperty("border-color")
      input.style.removeProperty("background")
      input.style.removeProperty("background-color")
      input.style.removeProperty("background-image")
      input.style.removeProperty("box-shadow")
      input.style.removeProperty("-webkit-box-shadow")
    }
  }

  if (theme === "mojavv" || theme === "flatwhite") {
    if (pinBtn instanceof HTMLElement && pinBtn.classList.contains("is-active")) {
      pinBtn.style.setProperty("background", "#f4f4f4", "important")
      pinBtn.style.setProperty("background-color", "#f4f4f4", "important")
      pinBtn.style.setProperty("background-image", "none", "important")
      pinBtn.style.setProperty("box-shadow", "none", "important")
      pinBtn.style.setProperty("-webkit-box-shadow", "none", "important")
    }
  } else if (pinBtn instanceof HTMLElement) {
    pinBtn.style.removeProperty("background")
    pinBtn.style.removeProperty("background-color")
    pinBtn.style.removeProperty("background-image")
    pinBtn.style.removeProperty("box-shadow")
    pinBtn.style.removeProperty("-webkit-box-shadow")
  }
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
    const requestedMode = normalizeSearchMode(event.data.payload?.mode)
    if (
      hasRestoredSnapshotResults &&
      text &&
      text === restoredSnapshotText &&
      requestedMode === restoredSnapshotMode
    ) {
      return
    }

    hasRestoredSnapshotResults = false
    restoredSnapshotText = ""
    restoredSnapshotMode = "auto"
    if (input) {
      input.value = text
    }
    if (text) {
      runSearch(text, event.data.payload?.mode)
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
          kind: typeof result.kind === "string" ? result.kind : "",
          data: cloneSerializable(result.data),
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
              kind:
                typeof item.result.kind === "string" ? item.result.kind : "",
              data: cloneSerializable(item.result.data),
              audio: normalizeAudioMap(item.result.audio),
            },
          }
        })
        .filter(Boolean)
    : []

  restoredSnapshotText = text
  restoredSnapshotMode = currentViewMode === "lookup" ? "lookup" : "translate"
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

async function lookupWithYoudaoCollins(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim()
  const doc = await requestDirtyDocument(
    "https://dict.youdao.com/w/" + encodeURIComponent(normalizedText)
  )

  return parseYoudaoCollinsDocument(doc, normalizedText)
}

const BING_HOST = "https://cn.bing.com"
const BING_DICT_LINK =
  `${BING_HOST}/dict/clientsearch?mkt=zh-CN&setLang=zh&form=BDVEHC&ClientVer=BDDTV3.5.1.4320&q=`
const BING_SENTENCE_LIMIT = 4

async function lookupWithBing(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  const doc = await requestDirtyDocument(
    BING_DICT_LINK + encodeURIComponent(normalizedText)
  )
  return parseBingDocument(doc, normalizedText)
}

const CAMBRIDGE_HOST = "https://dictionary.cambridge.org"

function getCambridgeSrcPage(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  if (!normalizedText) {
    return `${CAMBRIDGE_HOST}/`
  }

  if (/[\p{Script=Han}]/u.test(normalizedText)) {
    const locale = String(navigator.language || "").toLowerCase()
    const preferTraditional = locale.includes("zh-tw") || locale.includes("zh-hk")
    const path = preferTraditional
      ? "zht/%E6%90%9C%E7%B4%A2/direct/?datasetsearch=english-chinese-traditional&q="
      : "zhs/%E6%90%9C%E7%B4%A2/direct/?datasetsearch=english-chinese-simplified&q="
    return (
      `${CAMBRIDGE_HOST}/${path}` +
      encodeURIComponent(normalizedText)
    )
  }

  return (
    `${CAMBRIDGE_HOST}/search/direct/?datasetsearch=english&q=` +
    encodeURIComponent(normalizedText.split(/\s+/).join("-"))
  )
}

async function lookupWithCambridge(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  const doc = await requestDirtyDocument(getCambridgeSrcPage(normalizedText))
  return parseCambridgeDocument(doc, normalizedText)
}

const LONGMAN_HOST = "https://www.ldoceonline.com"

function getLongmanSrcPage(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  if (!normalizedText) {
    return `${LONGMAN_HOST}/`
  }

  const slug = normalizedText
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${LONGMAN_HOST}/dictionary/${slug || encodeURIComponent(normalizedText)}`
}

async function lookupWithLongman(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  const doc = await requestDirtyDocument(getLongmanSrcPage(normalizedText))
  return parseLongmanDocument(doc, normalizedText)
}

function unavailableResult(text) {
  return Promise.resolve({
    state: "unavailable",
    text,
    meta: "",
  })
}

function parseLongmanDocument(doc, fallbackTitle) {
  if (doc.querySelector(".dictentry")) {
    const lexResult = parseLongmanLexDocument(doc)
    if (lexResult) {
      return {
        state: "ok",
        kind: "longman",
        data: lexResult.data,
        text: "",
        meta: "",
        audio: normalizeAudioMap(lexResult.audio),
      }
    }
  }

  const relatedNode = doc.querySelector(".didyoumean")
  if (relatedNode) {
    const relatedResult = parseLongmanRelatedDocument(relatedNode)
    if (relatedResult) {
      return {
        state: "ok",
        kind: "longman",
        data: relatedResult,
        text: "",
        meta: "",
      }
    }
  }

  return unavailableResult(`朗文词典没有找到 “${fallbackTitle}” 的结果。`)
}

function parseLongmanLexDocument(doc) {
  const audio = {}
  const result = {
    type: "lex",
    bussinessFirst: true,
    contemporary: [],
    bussiness: [],
  }

  const wordfamsNode = doc.querySelector(".wordfams")
  if (wordfamsNode) {
    const wordfams = getLongmanSanitizedInnerHtml(wordfamsNode)
    if (wordfams) {
      result.wordfams = wordfams
    }
  }

  const dictentries = Array.from(doc.querySelectorAll(".dictentry"))
  let currentDict = ""

  dictentries.forEach($entry => {
    const $intro = $entry.querySelector(".dictionary_intro")
    if ($intro) {
      const dict = String($intro.textContent || "")
      if (dict.includes("Contemporary")) {
        currentDict = "contemporary"
      } else if (dict.includes("Business")) {
        currentDict = "bussiness"
      } else {
        currentDict = ""
      }
    }

    if (!currentDict) {
      return
    }

    const entry = parseLongmanEntry($entry, audio)
    if (entry) {
      result[currentDict].push(entry)
    }
  })

  if (result.contemporary.length <= 0 && result.bussiness.length <= 0) {
    return null
  }

  return {
    data: result,
    audio,
  }
}

function parseLongmanEntry($entry, audio) {
  const $head = $entry.querySelector(".Head")
  if (!$head) {
    return null
  }

  const entry = {
    title: {
      HWD: "",
      HYPHENATION: "",
      HOMNUM: "",
    },
    senses: [],
    prons: [],
  }

  const $topic = $entry.querySelector("a.topic")
  if ($topic) {
    const href = absolutizeUrl($topic.getAttribute("href"), LONGMAN_HOST)
    if (href) {
      entry.topic = {
        title: getNodeText($topic),
        href,
      }
    }
  }

  entry.title.HWD = getNodeText($head.querySelector(".HWD"))
  entry.title.HYPHENATION = getNodeText($head.querySelector(".HYPHENATION"))
  entry.title.HOMNUM = getNodeText($head.querySelector(".HOMNUM"))
  entry.phsym = getNodeText($head.querySelector(".PronCodes"))

  const $level = $head.querySelector(".LEVEL")
  if ($level) {
    entry.level = {
      rate: ($level.textContent?.match(/●/g) || []).length,
      title: $level.getAttribute("title") || "",
    }
  }

  entry.freq = Array.from($head.querySelectorAll(".FREQ"))
    .map($el => ({
      title: $el.getAttribute("title") || "",
      rank: getNodeText($el),
    }))
    .filter(item => item.rank)

  entry.pos = getNodeText($head.querySelector(".POS"))

  $head.querySelectorAll(".speaker").forEach($speaker => {
    const pron = extractLongmanAudioUrl($speaker)
    if (!pron) {
      return
    }

    const title = String($speaker.getAttribute("title") || "")
    let lang = "us"
    if (/british|brefile|uk/i.test(title) || $speaker.classList.contains("brefile")) {
      lang = "uk"
    } else if (/american|amefile|us/i.test(title) || $speaker.classList.contains("amefile")) {
      lang = "us"
    }

    audio[lang] = pron
    entry.prons.push({ lang, pron })
  })

  entry.senses = Array.from($entry.querySelectorAll(".Sense"))
    .map($sense => getLongmanSanitizedInnerHtml($sense))
    .filter(Boolean)

  entry.collocations = getLongmanSanitizedInnerHtml($entry.querySelector(".ColloBox"))
  entry.grammar = getLongmanSanitizedInnerHtml($entry.querySelector(".GramBox"))
  entry.thesaurus = getLongmanSanitizedInnerHtml($entry.querySelector(".ThesBox"))
  entry.examples = Array.from($entry.querySelectorAll(".exaGroup"))
    .map($exa => getLongmanSanitizedInnerHtml($exa))
    .filter(Boolean)

  if (
    !entry.title.HWD &&
    !entry.title.HYPHENATION &&
    !entry.title.HOMNUM &&
    entry.senses.length <= 0 &&
    !entry.collocations &&
    !entry.grammar &&
    !entry.thesaurus &&
    entry.examples.length <= 0
  ) {
    return null
  }

  return entry
}

function parseLongmanRelatedDocument(root) {
  const list = getLongmanSanitizedInnerHtml(root)
  if (!list) {
    return null
  }

  return {
    type: "related",
    list,
  }
}

function getLongmanSanitizedInnerHtml(node) {
  if (!node) {
    return ""
  }

  const clone = node.cloneNode(true)
  replaceLongmanSpeakerNodes(clone)
  sanitizeRichContentNode(clone, LONGMAN_HOST)
  return String(clone.innerHTML || "").trim()
}

function replaceLongmanSpeakerNodes(root) {
  if (!root) {
    return
  }

  root.querySelectorAll(".speaker.exafile").forEach(speaker => {
    const audioUrl = extractLongmanAudioUrl(speaker)
    if (!audioUrl) {
      speaker.remove()
      return
    }

    const parent = speaker.parentElement
    speaker.replaceWith(createSpeakerElement(audioUrl))
    if (parent?.classList.contains("EXAMPLE")) {
      parent.classList.add("withSpeaker")
    }
  })
}

function extractLongmanAudioUrl(node) {
  if (!node) {
    return ""
  }

  const candidates = [
    node.getAttribute("data-src-mp3"),
    node.getAttribute("data-mp3"),
    node.getAttribute("data-src"),
    node.getAttribute("data-url"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const normalized = absolutizeUrl(candidate, LONGMAN_HOST)
    if (normalized) {
      return normalized
    }
  }

  const onclick = String(node.getAttribute("onclick") || "")
  const absoluteMp3 = onclick.match(/https?:\/\/[^"')\s]+\.mp3(?:\?[^"')\s]*)?/i)
  if (absoluteMp3?.[0]) {
    return absoluteMp3[0]
  }

  const relativeMp3 = onclick.match(/\/[^"')\s]+\.mp3(?:\?[^"')\s]*)?/i)
  if (relativeMp3?.[0]) {
    return absolutizeUrl(relativeMp3[0], LONGMAN_HOST)
  }

  return ""
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

function buildAudioActions(audio, result) {
  if (result?.kind === "youdao-collins" || result?.kind === "youdao-related") {
    return ""
  }

  if (result?.kind === "longman") {
    return ""
  }

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

function renderSpeakerMarkup(url) {
  if (!url) {
    return ""
  }

  return `
    <a
      href="${escapeAttr(url)}"
      target="_blank"
      rel="noopener noreferrer"
      class="saladict-Speaker"
      data-audio-url="${escapeAttr(url)}"
      title="播放发音"
      aria-label="播放发音"
    ></a>
  `
}

function normalizeSpeakerHref(href) {
  const normalized = String(href || "").trim()
  if (!normalized || normalized === "#") {
    return ""
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return ""
  }

  return normalized
}

function renderStarRateMarkup(
  rate,
  className = "",
  size = "1em",
  tagName = "span",
  max = 5
) {
  const safeMax = Math.max(1, Number(max) || 5)
  const safeRate = Math.max(0, Math.min(safeMax, Number(rate) || 0))
  if (!safeRate) {
    return ""
  }

  const classAttr = className ? ` class="${className}"` : ""
  return `
    <${tagName}${classAttr}>
      ${Array.from({ length: safeMax }, (_, index) => `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 426.67 426.67"
          width="${size}"
          height="${size}"
          style="${index === 4 ? "" : "margin-right:1px"}"
        >
          <path
            fill="${index < safeRate ? "#FAC917" : "#d1d8de"}"
            d="M213.33 10.44l65.92 133.58 147.42 21.42L320 269.4l25.17 146.83-131.84-69.32-131.85 69.34 25.2-146.82L0 165.45l147.4-21.42"
          />
        </svg>
      `).join("")}
    </${tagName}>
  `
}

function getSelectedCollinsEntryIndex(sourceId, entryCount, fallbackIndex = 0) {
  if (entryCount <= 0) {
    return 0
  }

  const rawIndex = collinsEntrySelections.has(sourceId)
    ? collinsEntrySelections.get(sourceId)
    : fallbackIndex
  const nextIndex = Math.max(
    0,
    Math.min(entryCount - 1, Number(rawIndex) || 0)
  )
  collinsEntrySelections.set(sourceId, nextIndex)
  return nextIndex
}

function setCollinsEntrySelection(sourceId, index) {
  const nextIndex = Math.max(0, Number(index) || 0)
  collinsEntrySelections.set(sourceId, nextIndex)

  const settledItem = lastSettledResults.find(item => item?.source?.id === sourceId)
  if (
    settledItem?.result?.kind === "youdao-collins" &&
    settledItem.result.data &&
    typeof settledItem.result.data === "object"
  ) {
    settledItem.result.data.activeCollinsEntry = nextIndex
  }
}

async function playAudioUrl(url, triggerNode) {
  clearActiveAudioTrigger()

  if (triggerNode?.classList) {
    triggerNode.classList.add("isActive")
    triggerNode.classList.add("is-active")
    activeAudioTrigger = triggerNode
  }

  try {
    let played = await playAudioDirectly(url)

    if (!played) {
      played = await playAudioLocally(url)
    }

    if (!played) {
      try {
        const response = await sendRuntimeMessage({
          type: "PLAY_AUDIO",
          payload: url,
        })
        played = !!response?.ok
      } catch (error) {
      }
    }

    if (!played) {
      throw new Error("AUDIO_PLAYBACK_FAILED")
    }
  } catch (error) {
    setNodeText(statusLine, "发音播放失败，请稍后重试。")
  } finally {
    clearActiveAudioTrigger()
  }
}

function clearActiveAudioTrigger() {
  if (!activeAudioTrigger?.classList) {
    activeAudioTrigger = null
    return
  }

  activeAudioTrigger.classList.remove("isActive")
  activeAudioTrigger.classList.remove("is-active")
  activeAudioTrigger = null
}

function stopAudioPlayback() {
  clearActiveAudioTrigger()
  stopLocalAudioPlayback()
  sendRuntimeMessage({
    type: "STOP_AUDIO",
  }).catch(() => {})
}

async function playAudioLocally(url) {
  stopLocalAudioPlayback()

  try {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
    })

    if (!response.ok) {
      return false
    }

    const blob = await response.blob()
    activeAudioObjectUrl = URL.createObjectURL(blob)
    return playAudioFromSource(activeAudioObjectUrl)
  } catch (error) {
    return false
  }
}

function playAudioDirectly(url) {
  stopLocalAudioPlayback()
  return playAudioFromSource(url)
}

function playAudioFromSource(src) {
  return new Promise(resolve => {
    const audio = new Audio(src)
    activeAudioPlayer = audio
    audio.preload = "auto"

    const timeoutId = window.setTimeout(() => {
      cleanup()
      resolve(true)
    }, 20000)

    function cleanup() {
      window.clearTimeout(timeoutId)
      audio.onended = null
      audio.onerror = null
      if (activeAudioPlayer === audio) {
        activeAudioPlayer = null
      }
      if (src === activeAudioObjectUrl) {
        revokeLocalAudioObjectUrl()
      }
    }

    audio.onended = () => {
      cleanup()
      resolve(true)
    }

    audio.onerror = () => {
      cleanup()
      resolve(false)
    }

    audio.play().catch(() => {
      cleanup()
      resolve(false)
    })
  })
}

function stopLocalAudioPlayback() {
  if (activeAudioPlayer) {
    try {
      activeAudioPlayer.pause()
      activeAudioPlayer.currentTime = 0
      activeAudioPlayer.src = ""
    } catch (error) {
    }
    activeAudioPlayer.onended = null
    activeAudioPlayer.onerror = null
    activeAudioPlayer = null
  }

  revokeLocalAudioObjectUrl()
}

function revokeLocalAudioObjectUrl() {
  if (!activeAudioObjectUrl) {
    return
  }

  try {
    URL.revokeObjectURL(activeAudioObjectUrl)
  } catch (error) {
  }
  activeAudioObjectUrl = ""
}

function parseYoudaoCollinsDocument(doc, fallbackTitle) {
  const typo = doc.querySelector(".error-typo")
  if (typo) {
    const relatedHtml = getSanitizedInnerHtml(typo)
    if (relatedHtml) {
      return {
        state: "ok",
        kind: "youdao-related",
        data: {
          html: relatedHtml,
        },
        text: "",
        meta: "",
      }
    }

    return {
      state: "unavailable",
      text: `柯林斯英汉双解没有找到 “${fallbackTitle}” 的结果。`,
      meta: "",
    }
  }

  const audio = {}
  doc.querySelectorAll(".baav .pronounce").forEach(item => {
    const phsym = getNodeText(item)
    const voice = item.querySelector(".dictvoice")
    const rel = String(voice?.getAttribute("data-rel") || "")
    if (!rel) {
      return
    }

    const url = `https://dict.youdao.com/dictvoice?audio=${rel}`
    if (phsym.includes("英")) {
      audio.uk = url
    } else if (phsym.includes("美")) {
      audio.us = url
    }
  })

  const containers = Array.from(doc.querySelectorAll("#collinsResult .wt-container"))
    .map(container => {
      const clone = container.cloneNode(true)
      const titleNode = clone.querySelector(":scope > .title.trans-tip")
      let title = ""
      if (titleNode) {
        titleNode.querySelector(".do-detail")?.remove()
        title = getNodeText(titleNode)
        titleNode.remove()
      }

      const starNode = clone.querySelector(".star")
      if (starNode) {
        const match = String(starNode.className || "").match(/star(\d+)/)
        if (match) {
          starNode.outerHTML = renderStarRateMarkup(Number(match[1]))
        }
      }

      const content = getSanitizedInnerHtml(clone)
      if (!content) {
        return null
      }

      return {
        title,
        content,
      }
    })
    .filter(Boolean)

  const result = {
    title: getNodeText(doc.querySelector(".keyword")),
    stars: 0,
    rank: getNodeText(doc.querySelector(".rank")),
    pattern: getNodeText(doc.querySelector(".pattern")),
    prons: [],
    basic: getSanitizedInnerHtml(doc, "#phrsListTab .trans-container"),
    collins: containers,
    discrimination: getSanitizedInnerHtml(doc, "#discriminate"),
    sentence: getSanitizedInnerHtml(doc, "#authority .ol"),
    translation: getSanitizedInnerHtml(doc, "#fanyiToggle .trans-container"),
    activeCollinsEntry: 0,
  }

  const starNode = doc.querySelector(".star")
  if (starNode) {
    const match = String(starNode.className || "").match(/star(\d+)/)
    if (match) {
      result.stars = Number(match[1])
    }
  }

  doc.querySelectorAll(".baav .pronounce").forEach(item => {
    const phsym = getNodeText(item)
    const voice = item.querySelector(".dictvoice")
    const rel = String(voice?.getAttribute("data-rel") || "")
    if (!rel) {
      return
    }

    result.prons.push({
      phsym,
      url: `https://dict.youdao.com/dictvoice?audio=${rel}`,
    })
  })

  if (
    !result.title &&
    !result.basic &&
    result.collins.length === 0 &&
    !result.discrimination &&
    !result.sentence &&
    !result.translation
  ) {
    return {
      state: "unavailable",
      // text: "当前有道页里没有返回可用的“柯林斯英汉双解”结果。",
      text: "没有返回可用的“柯林斯英汉双解”结果。",
      meta: "",
    }
  }

  return {
    state: "ok",
    kind: "youdao-collins",
    data: result,
    text: "",
    meta: "",
    audio: normalizeAudioMap(audio),
  }
}

function parseBingDocument(doc, fallbackTitle) {
  if (doc.querySelector(".client_def_hd_hd")) {
    const lexResult = parseBingLexResult(doc)
    if (lexResult) {
      return {
        state: "ok",
        kind: "bing",
        data: lexResult.data,
        text: "",
        meta: "",
        audio: normalizeAudioMap(lexResult.audio),
      }
    }
  }

  if (doc.querySelector(".client_trans_head")) {
    const machineResult = parseBingMachineResult(doc)
    if (machineResult) {
      return {
        state: "ok",
        kind: "bing",
        data: machineResult,
        text: "",
        meta: "",
      }
    }
  }

  if (doc.querySelector(".client_do_you_mean_title_bar")) {
    const relatedResult = parseBingRelatedResult(doc)
    if (relatedResult) {
      return {
        state: "ok",
        kind: "bing",
        data: relatedResult,
        text: "",
        meta: "",
      }
    }
  }

  return unavailableResult(`必应词典没有找到 “${fallbackTitle}” 的结果。`)
}

function parseBingLexResult(doc) {
  const title = getNodeText(doc.querySelector(".client_def_hd_hd"))
  const data = {
    type: "lex",
    title,
  }
  const audio = {}

  const phsym = Array.from(doc.querySelectorAll(".client_def_hd_pn_list"))
    .map(node => {
      const lang = getNodeText(node.querySelector(".client_def_hd_pn"))
      const pron = extractBingAudioUrl(node)
      if (!lang && !pron) {
        return null
      }
      if (!audio.us && /us|美/i.test(lang)) {
        audio.us = pron
      } else if (!audio.uk && /uk|英/i.test(lang)) {
        audio.uk = pron
      }
      return { lang, pron }
    })
    .filter(Boolean)
  if (phsym.length > 0) {
    data.phsym = phsym
  }

  const defs = Array.from(
    doc.querySelectorAll(".client_def_container .client_def_bar")
  )
    .map(node => {
      const pos = getNodeText(node.querySelector(".client_def_title_bar"))
      const def = getNodeText(node.querySelector(".client_def_list"))
      if (!pos && !def) {
        return null
      }
      return { pos, def }
    })
    .filter(Boolean)
  if (defs.length > 0) {
    data.cdef = defs
  }

  const detailedSenseGroups = parseBingDetailedSenseGroups(doc)
  if (detailedSenseGroups.length > 0) {
    data.senses = detailedSenseGroups
  }

  const infs = Array.from(doc.querySelectorAll(".client_word_change_word"))
    .map(node => getNodeText(node))
    .filter(Boolean)
  if (infs.length > 0) {
    data.infs = infs
  }

  const sentenceNodes = Array.from(doc.querySelectorAll(".client_sentence_list")).slice(
    0,
    BING_SENTENCE_LIMIT
  )
  const sentences = sentenceNodes
    .map(node => parseBingSentenceNode(node))
    .filter(Boolean)
  if (sentences.length > 0) {
    data.sentences = sentences
  }

  if (!data.phsym && !data.cdef && !data.senses && !data.infs && !data.sentences) {
    return null
  }

  return { data, audio }
}

function parseBingDetailedSenseGroups(doc) {
  const groupNodes = Array.from(doc.querySelectorAll("#clientnlid .defeachseg"))

  return groupNodes
    .map(groupNode => {
      const pos = getNodeText(groupNode.querySelector(".defpos"))
      const senseNodes = Array.from(
        groupNode.querySelectorAll(".defsegcon > .deflistseg > .deflistitem")
      )

      const senses = senseNodes
        .map(item => {
          const num = getNodeText(item.querySelector(".defitemtitlebar .defnum"))
          const titleCn = getNodeText(
            item.querySelector(".defitemtitlebar .itemname")
          )
          const titleEn = getNodeText(
            item.querySelector(".defitemtitlebar .itmeval")
          )
          const defGra = getNodeText(item.querySelector(".defitembar .defgra"))
          const defCn = getNodeText(item.querySelector(".defitembar .itemname"))
          const defEn = getNodeText(item.querySelector(".defitembar .itmeval"))
          const exampleItems = Array.from(item.querySelectorAll(".exambar .examlistitem"))
            .map(example => ({
              en: getNodeText(example.querySelector(".examitmeval")),
              cn: getNodeText(example.querySelector(".examitemname")),
            }))
            .filter(example => example.en || example.cn)

          if (
            !num &&
            !titleCn &&
            !titleEn &&
            !defGra &&
            !defCn &&
            !defEn &&
            exampleItems.length <= 0
          ) {
            return null
          }

          return {
            num,
            titleCn,
            titleEn,
            defGra,
            defCn,
            defEn,
            examples: exampleItems,
          }
        })
        .filter(Boolean)

      if (!pos && senses.length <= 0) {
        return null
      }

      return {
        pos,
        senses,
      }
    })
    .filter(Boolean)
}

function parseBingSentenceNode(node) {
  const cloned = node.cloneNode(true)
  cloned.querySelectorAll(".client_sen_en_word").forEach(word => {
    word.replaceWith(document.createTextNode(getNodeText(word)))
  })
  cloned.querySelectorAll(".client_sen_cn_word").forEach(word => {
    word.replaceWith(document.createTextNode(getNodeText(word)))
  })
  cloned.querySelectorAll(".client_sentence_search").forEach(word => {
    const span = document.createElement("span")
    span.className = "dictBing-SentenceItem_HL"
    span.textContent = getNodeText(word)
    word.replaceWith(span)
  })

  const enHtml = getSanitizedInnerHtmlWithHost(
    cloned.querySelector(".client_sen_en"),
    BING_HOST
  )
  const chsHtml = getSanitizedInnerHtmlWithHost(
    cloned.querySelector(".client_sen_cn"),
    BING_HOST
  )
  const source = getNodeText(cloned.querySelector(".client_sentence_list_link"))
  const mp3 = extractBingAudioUrl(cloned)

  if (!enHtml && !chsHtml && !source && !mp3) {
    return null
  }

  return {
    en: enHtml,
    chs: chsHtml,
    source,
    mp3,
  }
}

function parseBingMachineResult(doc) {
  const mt = getNodeText(doc.querySelector(".client_sen_cn"))
  if (!mt) {
    return null
  }

  return {
    type: "machine",
    mt,
  }
}

function parseBingRelatedResult(doc) {
  const defs = []

  doc.querySelectorAll(".client_do_you_mean_area").forEach(area => {
    const listNodes = area.querySelectorAll(".client_do_you_mean_list")
    if (listNodes.length <= 0) {
      return
    }

    defs.push({
      title: getNodeText(area.querySelector(".client_do_you_mean_title")),
      meanings: Array.from(listNodes)
        .map(listNode => {
          const word = getNodeText(
            listNode.querySelector(".client_do_you_mean_list_word")
          )
          if (!word) {
            return null
          }

          return {
            href: `${BING_HOST}/dict/search?q=${encodeURIComponent(word)}`,
            word,
            def: getNodeText(
              listNode.querySelector(".client_do_you_mean_list_def")
            ),
          }
        })
        .filter(Boolean),
    })
  })

  if (defs.length <= 0) {
    return null
  }

  return {
    type: "related",
    title: getNodeText(doc.querySelector(".client_do_you_mean_title_bar")),
    defs,
  }
}

function getBingSenseExampleKey(title, pos, groupIndex, senseIndex, item) {
  return [
    "bing",
    String(lastRenderedText || title || "").trim().toLowerCase(),
    String(pos || "").trim().toLowerCase(),
    String(groupIndex),
    String(senseIndex),
    String(item?.num || ""),
    String(item?.titleCn || "").trim(),
  ].join("::")
}

function extractBingAudioUrl(root) {
  if (!root) {
    return ""
  }

  const audioNode =
    root.matches?.(".client_aud_o") ? root : root.querySelector(".client_aud_o")
  if (!audioNode) {
    return ""
  }

  const candidates = [
    audioNode.getAttribute("data-pronunciation"),
    audioNode.getAttribute("data-mp3link"),
    audioNode.getAttribute("data-src"),
    audioNode.getAttribute("data-url"),
  ].filter(Boolean)

  for (const url of candidates) {
    const normalized = absolutizeUrl(url, BING_HOST)
    if (normalized) {
      return normalized
    }
  }

  const onclick = String(audioNode.getAttribute("onclick") || "")
  const absoluteMp3 = onclick.match(/https?:\/\/[^"')\s]+\.mp3(?:\?[^"')\s]*)?/i)
  if (absoluteMp3?.[0]) {
    return absoluteMp3[0]
  }
  const relativeMp3 = onclick.match(/\/dict\/mediamp3\?[^"')\s]+/i)
  if (relativeMp3?.[0]) {
    return absolutizeUrl(relativeMp3[0], BING_HOST)
  }

  return ""
}

function parseCambridgeDocument(doc, fallbackTitle) {
  const audio = {}
  const entries = []
  const catalog = []

  doc.querySelectorAll(".entry-body__el").forEach(($entry, index) => {
    if (!getNodeText($entry.querySelector(".headword"))) {
      return
    }

    const clonedEntry = $entry.cloneNode(true)
    const $posHeader = clonedEntry.querySelector(".pos-header")
    if ($posHeader) {
      collectCambridgePronunciation($posHeader, audio)
      removeFirstMatchedNode($posHeader, ".share")
    }

    sanitizeCambridgeEntryNode(clonedEntry)
    const html = getSanitizedInnerHtmlWithHost(clonedEntry, CAMBRIDGE_HOST)
    if (!html) {
      return
    }

    const entryId = `d-cambridge-entry${index}`
    entries.push({
      id: entryId,
      html,
    })

    const catalogLabel =
      "#" +
      getNodeText(clonedEntry.querySelector(".di-title")) +
      " " +
      getNodeText(clonedEntry.querySelector(".posgram"))
    catalog.push({
      key: `#${index}`,
      value: entryId,
      label: catalogLabel.trim(),
    })
  })

  if (entries.length <= 0) {
    const $idiom = doc.querySelector(".idiom-block")
    if ($idiom) {
      const clonedIdiom = $idiom.cloneNode(true)
      removeFirstMatchedNode(clonedIdiom, ".bb.hax")
      sanitizeCambridgeEntryNode(clonedIdiom)

      const html = getSanitizedInnerHtmlWithHost(clonedIdiom, CAMBRIDGE_HOST)
      if (html) {
        entries.push({
          id: "d-cambridge-entry-idiom",
          html,
        })
      }
    }
  }

  if (entries.length <= 0) {
    const canonicalHref = doc
      .querySelector('link[rel="canonical"]')
      ?.getAttribute("href")
    const relatedNode = doc.querySelector(".hfl-s.lt2b.lmt-10.lmb-25.lp-s_r-20")
    if (
      relatedNode &&
      /dictionary\.cambridge\.org\/([^/]+\/)?spellcheck\//.test(
        String(canonicalHref || "")
      )
    ) {
      const clonedRelated = relatedNode.cloneNode(true)
      sanitizeCambridgeRelatedNode(clonedRelated)
      const html = getSanitizedInnerHtmlWithHost(clonedRelated, CAMBRIDGE_HOST)
      if (html) {
        entries.push({
          id: "d-cambridge-entry-related",
          html,
          isRelated: true,
        })
      }
    }
  }

  if (entries.length <= 0) {
    return unavailableResult(`剑桥词典没有找到 “${fallbackTitle}” 的结果。`)
  }

  return {
    state: "ok",
    kind: "cambridge",
    data: {
      entries,
      audio: normalizeAudioMap(audio),
      catalog,
    },
    text: "",
    meta: "",
    audio: normalizeAudioMap(audio),
  }
}

function sanitizeCambridgeEntryNode(root) {
  if (!root) {
    return root
  }

  root.querySelectorAll(".tb.fs10.hvm").forEach(node => {
    const text = getNodeText(node)
    if (!text || /add to word list/i.test(text)) {
      node.remove()
    }
  })

  root.querySelectorAll(".daccord_h").forEach(node => {
    node.parentElement?.classList.add("amp-accordion")
  })

  root.querySelectorAll("amp-img").forEach(ampImg => {
    const img = document.createElement("img")
    const src = ampImg.getAttribute("src")
    const normalizedSrc = absolutizeUrl(src, CAMBRIDGE_HOST)
    img.setAttribute("src", normalizedSrc || "")
    for (const attr of ["width", "height", "title"]) {
      const value = ampImg.getAttribute(attr)
      if (value) {
        img.setAttribute(attr, value)
      }
    }
    ampImg.replaceWith(img)
  })

  root.querySelectorAll("amp-audio").forEach(ampAudio => {
    const source = ampAudio.querySelector("source")
    const src = source?.getAttribute("src")
    const audioUrl = absolutizeUrl(src, CAMBRIDGE_HOST)
    if (audioUrl) {
      const speaker = createSpeakerElement(audioUrl)
      ampAudio.replaceWith(speaker)
      return
    }
    ampAudio.remove()
  })

  root.querySelectorAll("a.had").forEach(anchor => {
    anchor.setAttribute("target", "_blank")
    anchor.setAttribute("rel", "nofollow noopener noreferrer")
  })

  return root
}

function sanitizeCambridgeRelatedNode(root) {
  if (!root) {
    return root
  }

  root.querySelectorAll(".tb.fs10.hvm").forEach(node => {
    const text = getNodeText(node)
    if (!text || /add to word list/i.test(text)) {
      node.remove()
    }
  })

  return root
}

function collectCambridgePronunciation(posHeader, audio) {
  posHeader.querySelectorAll(".dpron-i").forEach(pron => {
    const daud = pron.querySelector(".daud")
    const source = daud?.querySelector('source[type="audio/mpeg"]')
    const src = source?.getAttribute("src")
    const audioUrl = absolutizeUrl(src, CAMBRIDGE_HOST)
    if (!audioUrl) {
      return
    }

    daud?.replaceWith(createSpeakerElement(audioUrl))

    if (!audio.uk && pron.classList.contains("uk")) {
      audio.uk = audioUrl
    }

    if (!audio.us && pron.classList.contains("us")) {
      audio.us = audioUrl
    }
  })
}

function createSpeakerElement(audioUrl) {
  const template = document.createElement("template")
  template.innerHTML = renderSpeakerMarkup(audioUrl).trim()
  return template.content.firstElementChild || document.createElement("span")
}

function removeFirstMatchedNode(parent, selector) {
  parent?.querySelector(selector)?.remove()
}

function getSanitizedInnerHtmlWithHost(node, host) {
  if (!node) {
    return ""
  }

  const clone = node.cloneNode(true)
  sanitizeRichContentNode(clone, host)
  return String(clone.innerHTML || "").trim()
}

function getSanitizedInnerHtml(parent, selector) {
  const sourceNode = selector ? parent.querySelector(selector) : parent
  if (!sourceNode) {
    return ""
  }

  const clone = sourceNode.cloneNode(true)
  sanitizeRichContentNode(clone, "https://www.youdao.com")
  return String(clone.innerHTML || "").trim()
}

function sanitizeRichContentNode(root, host) {
  const elements = []
  if (root?.nodeType === Node.ELEMENT_NODE) {
    elements.push(root)
  }
  elements.push(...root.querySelectorAll("*"))

  root.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach(
    node => node.remove()
  )

  elements.forEach(element => {
    Array.from(element.attributes || []).forEach(attribute => {
      const name = attribute.name.toLowerCase()
      const value = attribute.value

      if (name === "style" || name.startsWith("on")) {
        element.removeAttribute(attribute.name)
        return
      }

      if (name === "href" || name === "src") {
        const normalizedUrl = absolutizeUrl(value, host)
        if (normalizedUrl) {
          element.setAttribute(attribute.name, normalizedUrl)
        } else {
          element.removeAttribute(attribute.name)
        }
        return
      }

      if (name === "srcset") {
        const normalizedSrcset = normalizeSrcset(value, host)
        if (normalizedSrcset) {
          element.setAttribute("srcset", normalizedSrcset)
        } else {
          element.removeAttribute("srcset")
        }
      }
    })

    if (element.tagName === "A") {
      element.setAttribute("target", "_blank")
      element.setAttribute("rel", "noopener noreferrer")
    }
  })
}

function absolutizeUrl(value, host) {
  const raw = String(value || "").trim()
  if (!raw) {
    return ""
  }

  if (/^(javascript|data):/i.test(raw)) {
    return ""
  }

  if (raw === "#") {
    return "#"
  }

  try {
    return new URL(raw, host).href
  } catch (error) {
    return raw
  }
}

function normalizeSrcset(value, host) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [url, descriptor] = item.split(/\s+/, 2)
      const normalizedUrl = absolutizeUrl(url, host)
      return normalizedUrl
        ? [normalizedUrl, descriptor].filter(Boolean).join(" ")
        : ""
    })
    .filter(Boolean)
    .join(", ")
}

function cloneSerializable(value) {
  if (value == null) {
    return value
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return null
  }
}

function requestDirtyDocument(url) {
  return fetch(url, {
    credentials: "omit",
  }).then(async response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    return new DOMParser().parseFromString(html, "text/html")
  })
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
