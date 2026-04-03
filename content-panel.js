if (window.top === window) {
  const PANEL_MESSAGE_SOURCE = "saladict-panel"
  const PANEL_IFRAME_URL = `${window.SaladictBrowserApi.getRuntimeUrl("popup.html")}?embedded=1`
  const PANEL_Z_INDEX = "2147483647"
  const PANEL_WIDTH = "420px"
  const PANEL_HEIGHT = "560px"
  const panelState = {
    host: null,
    iframe: null,
    isVisible: false,
    isPinned: false,
    isReady: false,
    pendingSearchText: "",
    pendingSnapshot: null,
    settings: window.SaladictSettings.normalizeSettings(null),
    drag: {
      active: false,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
    },
  }

  initContentPanel()

  async function initContentPanel() {
    try {
      panelState.settings = await window.SaladictSettings.loadSettings()
      panelState.isPinned = panelState.settings.defaultPinned
    } catch (error) {
      panelState.settings = window.SaladictSettings.DEFAULT_SETTINGS
      panelState.isPinned = panelState.settings.defaultPinned
    }

    document.addEventListener("mousedown", handleDocumentMouseDown, true)
    window.addEventListener("mousemove", handleGlobalMouseMove, true)
    window.addEventListener("mouseup", handleGlobalMouseUp, true)
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
        snapshot:
          message.payload?.snapshot && typeof message.payload.snapshot === "object"
            ? message.payload.snapshot
            : null,
        pinned:
          typeof message.payload?.pinned === "boolean"
            ? message.payload.pinned
            : panelState.settings.defaultPinned,
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
    if (!panelState.isVisible || panelState.isPinned || !panelState.host) {
      return
    }

    if (panelState.host.contains(event.target)) {
      return
    }

    hidePanel()
  }

  function showPanel({ text, pinned, snapshot }) {
    ensurePanelHost()

    panelState.isPinned = pinned
    panelState.isVisible = true
    panelState.host.hidden = false
    panelState.pendingSearchText = text || panelState.pendingSearchText
    if (snapshot) {
      panelState.pendingSnapshot = snapshot
    }

    postToPanel({
      type: "SALADICT_PANEL_PIN_STATE",
      payload: { pinned: panelState.isPinned },
    })

    flushPendingPanelState()
  }

  function hidePanel() {
    if (panelState.host) {
      panelState.host.remove()
    }

    panelState.host = null
    panelState.iframe = null
    panelState.isVisible = false
    panelState.isPinned = false
    panelState.isReady = false
    panelState.pendingSearchText = ""
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
    host.style.width = PANEL_WIDTH
    host.style.height = PANEL_HEIGHT
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

    const snapshot = panelState.pendingSnapshot

    if (snapshot) {
      postToPanel({
        type: "SALADICT_PANEL_RESTORE_SNAPSHOT",
        payload: snapshot,
      })
      return
    }

    if (panelState.pendingSearchText) {
      postToPanel({
        type: "SALADICT_PANEL_SEARCH",
        payload: { text: panelState.pendingSearchText },
      })
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
}
