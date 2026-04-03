const sourceList = document.querySelector("#source-list")
const form = document.querySelector("#settings-form")
const saveButton = document.querySelector("#save-btn")
const formMessage = document.querySelector("#form-message")
const credentialSection = document.querySelector("#credential-section")
const baiduCredentialGroup = document.querySelector("#baidu-credential-group")
const caiyunCredentialGroup = document.querySelector("#caiyun-credential-group")
const baiduTokenInput = document.querySelector("#baidu-token")
const caiyunTokenInput = document.querySelector("#caiyun-token")

let savedOptionsData = null

initOptionsPage()

baiduTokenInput?.addEventListener("input", () => {
  showMessage("", "")
  updateSaveState()
})

caiyunTokenInput?.addEventListener("input", () => {
  showMessage("", "")
  updateSaveState()
})

async function initOptionsPage() {
  savedOptionsData = await window.SaladictSettings.loadOptionsData()
  renderSourceList(savedOptionsData.settings)
  renderCredentials(savedOptionsData.credentials)
  updateSaveState()
}

form?.addEventListener("submit", async event => {
  event.preventDefault()

  const draftOptionsData = getDraftOptionsData()
  const draftSettings = draftOptionsData.settings

  if (draftSettings.enabledSourceIds.length === 0) {
    showMessage("至少保留一个翻译源。", "error")
    updateSaveState()
    return
  }

  savedOptionsData = await window.SaladictSettings.saveOptionsData(
    draftOptionsData
  )
  renderSourceList(savedOptionsData.settings)
  renderCredentials(savedOptionsData.credentials)
  showMessage("设置已保存。", "success")
  updateSaveState()
})

function renderSourceList(settings) {
  sourceList.innerHTML = window.SaladictSettings.AVAILABLE_SOURCES.map(
    source => {
      const checked = settings.enabledSourceIds.includes(source.id)
        ? "checked"
        : ""

      return `
        <div class="source-item">
          <input id="source-${source.id}" type="checkbox" value="${escapeAttr(source.id)}" ${checked}>
          <label for="source-${source.id}">${escapeHtml(source.label)}</label>
        </div>
      `
    }
  ).join("")

  sourceList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener("change", event => {
      const checkedIds = getCheckedIds()

      if (checkedIds.length === 0) {
        event.currentTarget.checked = true
        showMessage("至少保留一个翻译源。", "error")
        updateSaveState()
        return
      }

      syncCredentialSection()
      showMessage("", "")
      updateSaveState()
    })
  })
}

function renderCredentials(credentials) {
  baiduTokenInput.value = credentials.baidu.token
  caiyunTokenInput.value = credentials.caiyun.token
  syncCredentialSection()
  updateSaveState()
}

function getCheckedIds() {
  return [
    ...sourceList.querySelectorAll('input[type="checkbox"]:checked'),
  ].map(input => input.value)
}

function getDraftOptionsData() {
  return {
    settings: window.SaladictSettings.normalizeSettings({
      enabledSourceIds: getCheckedIds(),
    }),
    credentials: window.SaladictSettings.normalizeCredentials({
      baidu: {
        token: baiduTokenInput.value,
      },
      caiyun: {
        token: caiyunTokenInput.value,
      },
    }),
  }
}

function updateSaveState() {
  const draftOptionsData = getDraftOptionsData()
  const hasSettingsChanges = !window.SaladictSettings.isSettingsEqual(
    savedOptionsData.settings,
    draftOptionsData.settings
  )
  const hasCredentialChanges = !window.SaladictSettings.isCredentialsEqual(
    savedOptionsData.credentials,
    draftOptionsData.credentials
  )

  saveButton.disabled = !(hasSettingsChanges || hasCredentialChanges)
}

function syncCredentialSection() {
  const checkedIds = getCheckedIds()
  credentialSection.hidden = !(
    checkedIds.includes("baidu") || checkedIds.includes("caiyun")
  )
  baiduCredentialGroup.hidden = !checkedIds.includes("baidu")
  caiyunCredentialGroup.hidden = !checkedIds.includes("caiyun")
}

function showMessage(text, type) {
  formMessage.textContent = text
  formMessage.className = "form-message"

  if (type) {
    formMessage.classList.add(`is-${type}`)
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
