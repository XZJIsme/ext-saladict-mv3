# 设置存储设计

## 目标

把旧项目的存储思路翻译成适合当前 MV3 demo 的最小方案，并保持后续可扩展。

## 旧项目的核心思路

- 全局配置放在 `browser.storage.sync`
- 可切换的 profile 也放在 `storage.sync`
- 少量本机状态放在 `browser.storage.local`
- 历史记录、notebook 等结构化数据放在 IndexedDB

## 当前 demo 的简化设计

当前 demo 还很小，不需要 profile、压缩存储、导入导出和数据库分层，所以先简化为：

- 用户设置统一放在 `browser.storage.sync`
- 只使用一个键：`userSettings`
- 先不做 profile
- 先不做压缩
- 先不引入 IndexedDB
- 新项目复制出自己的 [browser-api.js](/Volumes/diskbox/prjs/chrome-extension/ext-saladict-mv3/browser-api.js)，延续旧项目“业务代码不直接碰原生 API”的思路

当前设置对象结构：

```json
{
  "version": 1,
  "enabledSourceIds": ["google", "baidu", "caiyun"]
}
```

## 为什么这样设计

- 和旧项目一样，用户偏好属于“可同步配置”，适合 `browser.storage.sync`
- 现在只有少量设置，拆成多个 key 反而增加复杂度
- 统一对象便于以后做版本迁移
- 以后如果新增主题、字体、默认语言策略，都可以继续挂在这个对象里

## 预留扩展方向

- 如果以后加入窗口尺寸、临时草稿、最近输入等本机状态，可放到 `browser.storage.local`
- 如果以后加入历史记录、收藏词条、同步元数据，再单独引入 IndexedDB
- 如果以后功能变大，再考虑把设置拆成 `baseconfig` 和 `profiles`

## 当前界面策略

- popup 只负责翻译和快速入口
- 完整设置放在独立的 `options.html`
- popup 标题栏提供“设置”按钮，点击后打开设置页
