let activeAudio = null
let currentSrc = ""
let activeObjectUrl = ""

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_PLAY_AUDIO") {
    playAudio(message.payload)
      .then(result => {
        sendResponse(result)
      })
      .catch(error => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error || ""),
        })
      })
    return true
  }

  if (message?.type === "OFFSCREEN_STOP_AUDIO") {
    stopAudio()
    sendResponse({ ok: true })
  }
})

function stopAudio() {
  if (!activeAudio) {
    revokeObjectUrl()
    currentSrc = ""
    return
  }

  try {
    activeAudio.pause()
    activeAudio.currentTime = 0
    activeAudio.src = ""
  } catch (error) {
  }

  activeAudio.onended = null
  activeAudio.onerror = null
  activeAudio = null
  revokeObjectUrl()
  currentSrc = ""
}

function revokeObjectUrl() {
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl)
    } catch (error) {
    }
    activeObjectUrl = ""
  }
}

async function loadAudio(src) {
  stopAudio()
  currentSrc = src
  const response = await fetch(src, {
    credentials: "omit",
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`)
  }

  const blob = await response.blob()
  activeObjectUrl = URL.createObjectURL(blob)
  activeAudio = new Audio(activeObjectUrl)
  activeAudio.preload = "auto"
  return activeAudio
}

async function playAudio(src) {
  if (!src) {
    stopAudio()
    return { ok: true }
  }

  if (src === currentSrc) {
    stopAudio()
    return { ok: true }
  }

  let audio
  try {
    audio = await loadAudio(src)
  } catch (error) {
    stopAudio()
    return { ok: false, error: "AUDIO_PLAYBACK_FAILED" }
  }

  const waitForEnd = new Promise(resolve => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      resolve(true)
    }, 20000)

    function cleanup() {
      window.clearTimeout(timeoutId)
      audio.onended = null
      audio.onerror = null
    }

    audio.onended = () => {
      cleanup()
      resolve(true)
    }

    audio.onerror = () => {
      cleanup()
      resolve(false)
    }
  })

  try {
    await audio.play()
  } catch (error) {
    stopAudio()
    return { ok: false, error: "AUDIO_PLAYBACK_FAILED" }
  }

  const played = await waitForEnd
  if (!played) {
    stopAudio()
    return { ok: false, error: "AUDIO_PLAYBACK_FAILED" }
  }

  currentSrc = ""
  return { ok: true }
}
