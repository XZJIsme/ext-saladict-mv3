const sourceList = document.querySelector("#source-list")
const form = document.querySelector("#settings-form")
const saveButton = document.querySelector("#save-btn")
const formMessage = document.querySelector("#form-message")
const themeInputs = Array.from(document.querySelectorAll('input[name="theme"]'))
const selectionModeInputs = Array.from(
  document.querySelectorAll('input[name="selection-search-mode"]')
)

let savedOptionsData = null

initOptionsPage()

form?.addEventListener("input", event => {
  const target = event.target
  if (
    target instanceof HTMLInputElement &&
    (target.id === "baidu-token" || target.id === "caiyun-token")
  ) {
    showMessage("", "")
    updateSaveState()
  }
})

form?.addEventListener("change", event => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  if (target.type === "checkbox" && target.closest("#source-list")) {
    const checkedIds = getCheckedIds()
    if (checkedIds.length === 0) {
      target.checked = true
      showMessage("至少保留一个翻译源。", "error")
      updateSaveState()
      return
    }

    showMessage("", "")
    updateSaveState()
    return
  }

  if (
    target.name === "selection-search-mode" ||
    target.name === "theme"
  ) {
    if (target.name === "theme") {
      applyTheme(target.value)
    }
    showMessage("", "")
    updateSaveState()
  }
})

async function initOptionsPage() {
  savedOptionsData = await window.SaladictSettings.loadOptionsData()
  applyTheme(savedOptionsData.settings.theme)
  renderTheme(savedOptionsData.settings)
  renderSourceList(savedOptionsData.settings, savedOptionsData.credentials)
  renderSelectionMode(savedOptionsData.settings)
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
  applyTheme(savedOptionsData.settings.theme)
  renderTheme(savedOptionsData.settings)
  renderSourceList(savedOptionsData.settings, savedOptionsData.credentials)
  renderSelectionMode(savedOptionsData.settings)
  showMessage("设置已保存。", "success")
  updateSaveState()
})

function renderSourceList(settings, credentials) {
  sourceList.innerHTML = window.SaladictSettings.AVAILABLE_SOURCES.map(
    source => {
      const checked = settings.enabledSourceIds.includes(source.id)
        ? "checked"
        : ""
      const hint = getSourceHint(source.id)
      const tokenMarkup = renderSourceTokenField(source.id, credentials)

      return `
        <div class="source-item" data-source-id="${escapeAttr(source.id)}">
          <div class="source-main">
            <input id="source-${source.id}" type="checkbox" value="${escapeAttr(source.id)}" ${checked}>
            <label for="source-${source.id}">
              <strong>${escapeHtml(source.label)}</strong>
              <span class="source-hint">${escapeHtml(hint)}</span>
            </label>
          </div>
          ${tokenMarkup}
        </div>
      `
    }
  ).join("")
}

function getSourceHint(sourceId) {
  if (sourceId === "baidu") {
    return "未启用时也可先填写对应 token。可前往 https://fanyi-api.baidu.com/ 获取百度翻译 token（有免费额度，实际以百度翻译平台的说明为准），输入格式为 appid:密钥，获取路径：百度翻译开放平台 → 管理控制台 → 开发者中心 → 开发者信息 → 申请信息；此步骤仅供参考，具体以百度翻译平台的实际流程为准。"
  }

  if (sourceId === "caiyun") {
    return "未启用时也可先填写对应 token。彩云翻译同样提供免费额度（实际以彩云翻译平台的说明为准），可前往 https://platform.caiyunapp.com/regist 注册开通。"
  }

  return "未启用时也可先填写对应 token。"
}

function renderTheme(settings) {
  const activeValue = settings.theme || "viista"
  themeInputs.forEach(input => {
    input.checked = input.value === activeValue
  })
}

function renderSelectionMode(settings) {
  const activeValue = settings.selectionSearchMode || "auto"
  selectionModeInputs.forEach(input => {
    input.checked = input.value === activeValue
  })
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
      selectionSearchMode: getSelectedSearchMode(),
      theme: getSelectedTheme(),
    }),
    credentials: window.SaladictSettings.normalizeCredentials({
      baidu: {
        token: getTokenValue("baidu"),
      },
      caiyun: {
        token: getTokenValue("caiyun"),
      },
    }),
  }
}

function getSelectedSearchMode() {
  const checkedInput = selectionModeInputs.find(input => input.checked)
  return checkedInput?.value || "auto"
}

function getSelectedTheme() {
  const checkedInput = themeInputs.find(input => input.checked)
  return checkedInput?.value || "viista"
}

function updateSaveState() {
  if (!savedOptionsData) {
    saveButton.disabled = true
    return
  }

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

function applyTheme(theme) {
  document.body.dataset.theme =
    theme === "mojavv" || theme === "flatwhite" ? theme : "viista"
}

function getTokenValue(sourceId) {
  const tokenInput = document.querySelector(`#${sourceId}-token`)
  return tokenInput instanceof HTMLInputElement ? tokenInput.value : ""
}

function renderSourceTokenField(sourceId, credentials) {
  const token = credentials?.[sourceId]?.token || ""
  const label = window.SaladictSettings.AVAILABLE_SOURCES.find(
    source => source.id === sourceId
  )?.label

  if (sourceId !== "baidu" && sourceId !== "caiyun") {
    return ""
  }

  return `
    <div class="source-credential">
      <label class="credential-label" for="${sourceId}-token">
        ${escapeHtml(label || sourceId)} Token
      </label>
      <input
        id="${sourceId}-token"
        class="credential-input"
        type="password"
        value="${escapeAttr(token)}"
        autocomplete="off"
        spellcheck="false"
        placeholder="请输入${escapeHtml(label || sourceId)} token"
      >
      <p class="credential-note">未启用时也可以先填写并保存，启用后立即生效。</p>
    </div>
  `
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
