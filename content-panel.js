if (window.top === window) {
  const PANEL_MESSAGE_SOURCE = "saladict-panel"
  const PANEL_IFRAME_URL = `${window.SaladictBrowserApi.getRuntimeUrl("popup.html")}?embedded=1`
  const PANEL_Z_INDEX = "2147483647"
  const PANEL_WIDTH = 420
  const PANEL_HEIGHT = 560
  const BOWL_SIZE = 32
  const BOWL_OFFSET_X = 12
  const BOWL_OFFSET_Y = 12

  const panelState = {
    host: null,
    iframe: null,
    bowl: null,
    isVisible: false,
    isPinned: false,
    isReady: false,
    pendingSearchText: "",
    pendingSearchMode: "auto",
    pendingSnapshot: null,
    settings: window.SaladictSettings.normalizeSettings(null),
    selection: null,
    drag: {
      active: false,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
    },
  }

  initContentPanel()

  async function initContentPanel() {
    await refreshSettings()

    document.addEventListener("mousedown", handleDocumentMouseDown, true)
    document.addEventListener("mouseup", handleDocumentMouseUp, true)
    document.addEventListener("selectionchange", handleDocumentSelectionChange, true)
    window.addEventListener("mousemove", handleGlobalMouseMove, true)
    window.addEventListener("mouseup", handleGlobalMouseUp, true)
    window.addEventListener("scroll", hideSelectionBowl, true)
    window.addEventListener("resize", hideSelectionBowl, true)
    window.addEventListener("message", handlePanelMessage)
    window.SaladictBrowserApi.browser.runtime.onMessage.addListener(
      handleRuntimeMessage
    )
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== "string") {
      return
    }

    if (message.type === "SALADICT_QUERY_PANEL_STATE") {
      sendResponse({
        available: true,
        isPinned: panelState.isPinned,
        isVisible: panelState.isVisible,
      })
      return
    }

    if (message.type === "SALADICT_OPEN_PANEL") {
      showPanel({
        text: typeof message.payload?.text === "string" ? message.payload.text : "",
        mode: message.payload?.mode,
        snapshot:
          message.payload?.snapshot && typeof message.payload.snapshot === "object"
            ? message.payload.snapshot
            : null,
        pinned:
          typeof message.payload?.pinned === "boolean"
            ? message.payload.pinned
            : panelState.settings.defaultPinned,
        coord:
          message.payload?.coord && typeof message.payload.coord === "object"
            ? message.payload.coord
            : null,
      })
      sendResponse({ ok: true })
      return
    }

    if (message.type === "SALADICT_SET_PIN_STATE") {
      panelState.isPinned = !!message.payload?.pinned
      if (panelState.isVisible) {
        postToPanel({
          type: "SALADICT_PANEL_PIN_STATE",
          payload: { pinned: panelState.isPinned },
        })
      }
      sendResponse({ ok: true, isPinned: panelState.isPinned })
      return
    }
  }

  function handleDocumentMouseDown(event) {
    if (isInsideSelectionBowl(event.target)) {
      return
    }

    hideSelectionBowl()

    if (!panelState.isVisible || panelState.isPinned || !panelState.host) {
      return
    }

    if (panelState.host.contains(event.target)) {
      return
    }

    hidePanel()
  }

  function handleDocumentMouseUp(event) {
    if (event.button !== 0) {
      return
    }

    if (isInsideSelectionBowl(event.target) || isInsidePanelHost(event.target)) {
      return
    }

    window.setTimeout(() => {
      syncSelectionFromPage(event)
    }, 10)
  }

  function handleDocumentSelectionChange() {
    const selection = window.getSelection()
    if (!selection || String(selection).trim()) {
      return
    }

    panelState.selection = null
    hideSelectionBowl()
  }

  async function syncSelectionFromPage(event) {
    await refreshSettings()

    if (isEditableElement(event.target)) {
      panelState.selection = null
      hideSelectionBowl()
      return
    }

    const payload = readSelectionPayload(event)
    if (!payload) {
      panelState.selection = null
      hideSelectionBowl()
      return
    }

    panelState.selection = payload
    showSelectionBowl(payload.iconX, payload.iconY)
  }

  function readSelectionPayload(event) {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount <= 0) {
      return null
    }

    const text = String(selection.toString() || "")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) {
      return null
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const anchorX =
      rect.width > 0 || rect.height > 0 ? rect.right : Number(event.clientX) || 0
    const anchorY =
      rect.width > 0 || rect.height > 0 ? rect.top : Number(event.clientY) || 0

    return {
      text,
      anchorX,
      anchorY,
      iconX: anchorX + BOWL_OFFSET_X,
      iconY: anchorY + BOWL_OFFSET_Y,
    }
  }

  function ensureSelectionBowl() {
    if (panelState.bowl) {
      return
    }

    const bowl = document.createElement("button")
    bowl.type = "button"
    bowl.id = "saladict-mv3-selection-bowl"
    bowl.hidden = true
    bowl.setAttribute("aria-label", "打开 Saladict 查询")
    bowl.style.position = "fixed"
    bowl.style.width = `${BOWL_SIZE}px`
    bowl.style.height = `${BOWL_SIZE}px`
    bowl.style.padding = "0"
    bowl.style.border = "1px solid rgba(77, 119, 164, 0.95)"
    bowl.style.borderRadius = "50%"
    bowl.style.background =
      "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.98) 0%, rgba(230,242,255,0.98) 42%, rgba(124,172,222,0.96) 100%)"
    bowl.style.boxShadow =
      "0 8px 18px rgba(35, 70, 108, 0.24), inset 0 1px 0 rgba(255,255,255,0.92)"
    bowl.style.cursor = "pointer"
    bowl.style.zIndex = PANEL_Z_INDEX
    bowl.style.backdropFilter = "blur(8px)"

    const icon = document.createElement("img")
    icon.src = window.SaladictBrowserApi.getRuntimeUrl("assets/icons/icon-24.png")
    icon.alt = ""
    icon.style.display = "block"
    icon.style.width = "18px"
    icon.style.height = "18px"
    icon.style.margin = "0 auto"
    bowl.appendChild(icon)

    bowl.addEventListener("mousedown", event => {
      event.preventDefault()
      event.stopPropagation()
    })

    bowl.addEventListener("click", async event => {
      event.preventDefault()
      event.stopPropagation()

      const selection = panelState.selection
      if (!selection?.text) {
        hideSelectionBowl()
        return
      }

      await refreshSettings()
      showPanel({
        text: selection.text,
        mode: panelState.settings.selectionSearchMode,
        pinned: panelState.isVisible ? panelState.isPinned : panelState.settings.defaultPinned,
        coord: {
          x: selection.anchorX,
          y: selection.anchorY,
        },
      })
      hideSelectionBowl()
    })

    document.documentElement.appendChild(bowl)
    panelState.bowl = bowl
  }

  function showSelectionBowl(x, y) {
    ensureSelectionBowl()
    if (!panelState.bowl) {
      return
    }

    const maxLeft = Math.max(8, window.innerWidth - BOWL_SIZE - 8)
    const maxTop = Math.max(8, window.innerHeight - BOWL_SIZE - 8)
    const nextLeft = Math.min(Math.max(8, Math.round(x)), maxLeft)
    const nextTop = Math.min(Math.max(8, Math.round(y)), maxTop)

    panelState.bowl.style.left = `${nextLeft}px`
    panelState.bowl.style.top = `${nextTop}px`
    panelState.bowl.hidden = false
  }

  function hideSelectionBowl() {
    if (panelState.bowl) {
      panelState.bowl.hidden = true
    }
  }

  function showPanel({ text, mode, pinned, snapshot, coord }) {
    ensurePanelHost()

    panelState.isPinned = pinned
    panelState.isVisible = true
    panelState.host.hidden = false
    panelState.pendingSearchText = text || ""
    panelState.pendingSearchMode = normalizeSearchMode(mode)
    panelState.pendingSnapshot = snapshot || null

    if (coord) {
      positionPanelNearPoint(coord.x, coord.y)
    }

    postToPanel({
      type: "SALADICT_PANEL_PIN_STATE",
      payload: { pinned: panelState.isPinned },
    })

    flushPendingPanelState()
  }

  function hidePanel() {
    hideSelectionBowl()

    if (panelState.host) {
      panelState.host.remove()
    }

    panelState.host = null
    panelState.iframe = null
    panelState.isVisible = false
    panelState.isPinned = false
    panelState.isReady = false
    panelState.pendingSearchText = ""
    panelState.pendingSearchMode = "auto"
    panelState.pendingSnapshot = null
  }

  function ensurePanelHost() {
    if (panelState.host) {
      return
    }

    const host = document.createElement("div")
    host.id = "saladict-mv3-panel-host"
    host.style.position = "fixed"
    host.style.top = "72px"
    host.style.right = "24px"
    host.style.width = `${PANEL_WIDTH}px`
    host.style.height = `${PANEL_HEIGHT}px`
    host.style.zIndex = PANEL_Z_INDEX
    host.style.boxSizing = "border-box"
    host.style.pointerEvents = "auto"
    host.style.background = "transparent"

    const iframe = document.createElement("iframe")
    iframe.src = PANEL_IFRAME_URL
    iframe.title = "Saladict 沙拉查词面板"
    iframe.style.display = "block"
    iframe.style.width = "100%"
    iframe.style.height = "100%"
    iframe.style.border = "0"
    iframe.style.borderRadius = "12px"
    iframe.style.background = "transparent"
    iframe.style.boxShadow = "0 18px 36px rgba(0, 0, 0, 0.18)"

    host.appendChild(iframe)
    document.documentElement.appendChild(host)

    panelState.host = host
    panelState.iframe = iframe
  }

  function handlePanelMessage(event) {
    if (
      event.source !== panelState.iframe?.contentWindow ||
      event.data?.source !== PANEL_MESSAGE_SOURCE
    ) {
      return
    }

    const { type } = event.data

    if (type === "SALADICT_PANEL_READY") {
      panelState.isReady = true
      postToPanel({
        type: "SALADICT_PANEL_INIT",
        payload: {
          pinned: panelState.isPinned,
        },
      })
      flushPendingPanelState()
      return
    }

    if (type === "SALADICT_PANEL_TOGGLE_PIN") {
      panelState.isPinned = !panelState.isPinned
      postToPanel({
        type: "SALADICT_PANEL_PIN_STATE",
        payload: { pinned: panelState.isPinned },
      })
      return
    }

    if (type === "SALADICT_PANEL_CLOSE") {
      hidePanel()
      return
    }

    if (type === "SALADICT_PANEL_DRAG_START") {
      if (!panelState.host) {
        return
      }

      panelState.iframe.style.pointerEvents = "none"
      panelState.host.style.cursor = "move"
      document.documentElement.style.userSelect = "none"
      panelState.drag.active = true
      panelState.drag.pointerOffsetX = Number(event.data.payload?.clientX) || 0
      panelState.drag.pointerOffsetY = Number(event.data.payload?.clientY) || 0
      return
    }

    if (type === "SALADICT_PANEL_DRAG_MOVE") {
      if (!panelState.drag.active || !panelState.host) {
        return
      }

      const rect = panelState.host.getBoundingClientRect()
      movePanelTo(
        rect.left + (Number(event.data.payload?.clientX) || 0) - panelState.drag.pointerOffsetX,
        rect.top + (Number(event.data.payload?.clientY) || 0) - panelState.drag.pointerOffsetY
      )
      return
    }

    if (type === "SALADICT_PANEL_DRAG_END") {
      finishDrag()
    }
  }

  function postToPanel(message) {
    if (!panelState.isReady || !panelState.iframe?.contentWindow) {
      return
    }

    panelState.iframe.contentWindow.postMessage(
      {
        source: PANEL_MESSAGE_SOURCE,
        ...message,
      },
      "*"
    )
  }

  function flushPendingPanelState() {
    if (!panelState.isReady) {
      return
    }

    if (panelState.pendingSnapshot) {
      postToPanel({
        type: "SALADICT_PANEL_RESTORE_SNAPSHOT",
        payload: panelState.pendingSnapshot,
      })
      panelState.pendingSnapshot = null
      panelState.pendingSearchText = ""
      panelState.pendingSearchMode = "auto"
      return
    }

    if (panelState.pendingSearchText) {
      postToPanel({
        type: "SALADICT_PANEL_SEARCH",
        payload: {
          text: panelState.pendingSearchText,
          mode: panelState.pendingSearchMode,
        },
      })
      panelState.pendingSearchText = ""
      panelState.pendingSearchMode = "auto"
    }
  }

  function positionPanelNearPoint(x, y) {
    if (!panelState.host) {
      return
    }

    const preferredLeft = Math.round(x + 16)
    const preferredTop = Math.round(y + 16)

    movePanelTo(preferredLeft, preferredTop)

    const rect = panelState.host.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      movePanelTo(Math.round(x - panelState.host.offsetWidth - 16), preferredTop)
    }
    if (rect.bottom > window.innerHeight - 8) {
      movePanelTo(panelState.host.offsetLeft, Math.round(y - panelState.host.offsetHeight - 16))
    }
  }

  function movePanelTo(left, top) {
    if (!panelState.host) {
      return
    }

    const maxLeft = Math.max(0, window.innerWidth - panelState.host.offsetWidth)
    const maxTop = Math.max(0, window.innerHeight - panelState.host.offsetHeight)
    const nextLeft = Math.min(Math.max(0, left), maxLeft)
    const nextTop = Math.min(Math.max(0, top), maxTop)

    panelState.host.style.left = `${nextLeft}px`
    panelState.host.style.top = `${nextTop}px`
    panelState.host.style.right = "auto"
  }

  function handleGlobalMouseMove(event) {
    if (!panelState.drag.active || !panelState.host) {
      return
    }

    movePanelTo(
      event.clientX - panelState.drag.pointerOffsetX,
      event.clientY - panelState.drag.pointerOffsetY
    )
  }

  function handleGlobalMouseUp() {
    finishDrag()
  }

  function finishDrag() {
    if (!panelState.drag.active) {
      return
    }

    panelState.drag.active = false
    if (panelState.iframe) {
      panelState.iframe.style.pointerEvents = "auto"
    }
    if (panelState.host) {
      panelState.host.style.cursor = "default"
    }
    document.documentElement.style.userSelect = ""
  }

  function isInsidePanelHost(target) {
    return !!(panelState.host && target instanceof Node && panelState.host.contains(target))
  }

  function isInsideSelectionBowl(target) {
    return !!(panelState.bowl && target instanceof Node && panelState.bowl.contains(target))
  }

  function isEditableElement(target) {
    if (!(target instanceof Element)) {
      return false
    }

    return Boolean(
      target.closest(
        "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']"
      )
    )
  }

  function normalizeSearchMode(mode) {
    return mode === "lookup" || mode === "translate" ? mode : "auto"
  }

  async function refreshSettings() {
    try {
      panelState.settings = await window.SaladictSettings.loadSettings()
    } catch (error) {
      panelState.settings = window.SaladictSettings.DEFAULT_SETTINGS
    }

    if (!panelState.isVisible) {
      panelState.isPinned = panelState.settings.defaultPinned
    }
  }
}
