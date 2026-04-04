;(function bootstrapBrowserApi(global) {
  const nativeBrowser = global.browser
  const nativeChrome = global.chrome

  function callStorageMethod(areaName, methodName, ...args) {
    if (nativeBrowser?.storage?.[areaName]?.[methodName]) {
      return nativeBrowser.storage[areaName][methodName](...args)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.storage[areaName][methodName](...args, result => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(result)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function storageClear() {
    if (this.__storageArea__ === "all") {
      return Promise.all([
        callStorageMethod("local", "clear"),
        callStorageMethod("sync", "clear"),
      ]).then(() => {})
    }

    return callStorageMethod(this.__storageArea__, "clear")
  }

  function storageGet(...args) {
    return callStorageMethod(this.__storageArea__, "get", ...args)
  }

  function storageSet(items) {
    return callStorageMethod(this.__storageArea__, "set", items).then(() => {})
  }

  function storageRemove(keys) {
    return callStorageMethod(this.__storageArea__, "remove", keys).then(() => {})
  }

  function storageAddListener() {
    throw new Error("当前 demo 还没有实现 storage listener 封装。")
  }

  function storageRemoveListener() {
    throw new Error("当前 demo 还没有实现 storage listener 封装。")
  }

  function sendRuntimeMessage(message) {
    if (nativeBrowser?.runtime?.sendMessage) {
      return nativeBrowser.runtime.sendMessage(message)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.runtime.sendMessage(message, response => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(response)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function addRuntimeListener(listener) {
    const runtime = nativeBrowser?.runtime || nativeChrome?.runtime
    runtime?.onMessage?.addListener(listener)
  }

  function openOptionsPage() {
    if (nativeBrowser?.runtime?.openOptionsPage) {
      return nativeBrowser.runtime.openOptionsPage()
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.runtime.openOptionsPage(() => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function getRuntimeUrl(path = "") {
    try {
      if (nativeBrowser?.runtime?.getURL) {
        return nativeBrowser.runtime.getURL(path)
      }

      return nativeChrome.runtime.getURL(path)
    } catch (error) {
      return ""
    }
  }

  function openUrl(url, active = false) {
    if (nativeBrowser?.tabs?.create) {
      return nativeBrowser.tabs.create({ url, active })
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.tabs.create({ url, active }, tab => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(tab)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function queryTabs(queryInfo) {
    if (nativeBrowser?.tabs?.query) {
      return nativeBrowser.tabs.query(queryInfo)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.tabs.query(queryInfo, tabs => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(tabs)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function removeTab(tabId) {
    if (nativeBrowser?.tabs?.remove) {
      return nativeBrowser.tabs.remove(tabId)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.tabs.remove(tabId, () => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function sendMessageToTab(tabId, message) {
    if (nativeBrowser?.tabs?.sendMessage) {
      return nativeBrowser.tabs.sendMessage(tabId, message)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.tabs.sendMessage(tabId, message, response => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(response)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function executeScript(options) {
    if (nativeBrowser?.scripting?.executeScript) {
      return nativeBrowser.scripting.executeScript(options)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.scripting.executeScript(options, results => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(results)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function openPanelWindow(url, options = {}) {
    const createData = {
      url,
      type: "popup",
      width: options.width || 460,
      height: options.height || 720,
      focused: options.focused !== false,
    }

    if (nativeBrowser?.windows?.create) {
      return nativeBrowser.windows.create(createData)
    }

    return new Promise((resolve, reject) => {
      try {
        nativeChrome.windows.create(createData, createdWindow => {
          const lastError = nativeChrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          resolve(createdWindow)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  const browserCompat =
    nativeBrowser ||
    {
      storage: {
        local: {
          get: (...args) => callStorageMethod("local", "get", ...args),
          set: items => callStorageMethod("local", "set", items).then(() => {}),
          remove: keys =>
            callStorageMethod("local", "remove", keys).then(() => {}),
          clear: () => callStorageMethod("local", "clear").then(() => {}),
        },
        sync: {
          get: (...args) => callStorageMethod("sync", "get", ...args),
          set: items => callStorageMethod("sync", "set", items).then(() => {}),
          remove: keys =>
            callStorageMethod("sync", "remove", keys).then(() => {}),
          clear: () => callStorageMethod("sync", "clear").then(() => {}),
        },
      },
      runtime: {
        openOptionsPage,
        getURL: getRuntimeUrl,
        sendMessage: sendRuntimeMessage,
        onMessage: {
          addListener: addRuntimeListener,
        },
      },
      tabs: {
        create: (...args) => openUrl(...args),
        query: (...args) => queryTabs(...args),
        remove: (...args) => removeTab(...args),
        sendMessage: (...args) => sendMessageToTab(...args),
      },
      scripting: {
        executeScript: (...args) => executeScript(...args),
      },
      windows: {
        create: (...args) => openPanelWindow(...args),
      },
    }

  const storage = {
    sync: {
      clear: storageClear,
      remove: storageRemove,
      get: storageGet,
      set: storageSet,
      addListener: storageAddListener,
      removeListener: storageRemoveListener,
      get __storageArea__() {
        return "sync"
      },
    },
    local: {
      clear: storageClear,
      remove: storageRemove,
      get: storageGet,
      set: storageSet,
      addListener: storageAddListener,
      removeListener: storageRemoveListener,
      get __storageArea__() {
        return "local"
      },
    },
    clear: storageClear,
    addListener: storageAddListener,
    removeListener: storageRemoveListener,
    get __storageArea__() {
      return "all"
    },
  }

  global.browser = browserCompat
  global.SaladictBrowserApi = {
    browser: browserCompat,
    storage,
    addRuntimeListener,
    getRuntimeUrl,
    openOptionsPage,
    openPanelWindow,
    queryTabs,
    removeTab,
    executeScript,
    sendMessageToTab,
    sendRuntimeMessage,
    openUrl,
  }
})(window)
