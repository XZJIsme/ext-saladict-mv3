# Old Saladict 项目功能与结构整理

## 1. 项目定位

`old-salad-archive/` 里的旧项目是一个面向 Chrome / Firefox / Edge / Safari 的浏览器划词查词与翻译扩展，核心目标是：

- 在网页中获取用户选中的文本
- 根据当前模式触发查词或翻译
- 通过内嵌面板、弹窗或独立窗口展示结果
- 将查询结果、例句、翻译、发音、笔记等组织成完整工作流

从构建配置和 manifest 可以确认，这个旧项目当前是 **Manifest V2** 架构，不适合直接迁移到现代 Chrome，但它的很多业务模块仍然值得参考。

## 2. 顶层目录结构

### 2.1 仓库顶层

- `assets/`
  运行时静态资源，包含图标、内嵌脚本、PDF viewer 资源、Youdao 页面翻译脚本等。
- `config/`
  Jest 等工程配置。
- `docs/`
  文档资源。
- `mac-app/`
  Safari 包装壳相关工程。
- `scripts/`
  构建辅助脚本、PDF.js 拉取与改造脚本、开发脚本。
- `src/`
  主业务代码。
- `test/`
  单元测试与词典引擎测试。
- `.storybook/`
  组件 Storybook 预览环境。
- `.github/`
  issue 模板与 GitHub 仓库元数据。

### 2.2 `src/` 一级业务域

- `app-config/`
  默认配置、词典注册表、预设 profile、上下文菜单配置、词典鉴权配置。
- `background/`
  后台逻辑，负责初始化、消息转发、同步、菜单、PDF、快捷键、窗口管理等。
- `content/`
  注入网页的 React UI，包括悬浮球、词典面板、词条列表、上下文翻译、单词编辑器。
- `selection/`
  监听用户选区、快捷触发、即时捕获等行为，并向内容面板发送查询消息。
- `popup/`
  浏览器工具栏弹窗。
- `options/`
  设置页。
- `quick-search/`
  独立快速查词窗口。
- `notebook/`
  生词本页面。
- `history/`
  历史记录页面。
- `word-editor/`
  独立词条编辑页面。
- `audio-control/`
  独立发音波形控件页面。
- `components/`
  通用 UI 组件，以及所有词典实现。
- `_helpers/`
  浏览器 API 包装、配置管理、profile 管理、语言判断、记录结构、i18n、分析埋点等基础设施。
- `_locales/`
  多语言文案。
- `manifest/`
  Chrome / Firefox / Edge / Safari 的 manifest 差异化配置。

## 3. 运行入口与页面组成

旧项目不是单页扩展，而是一个由多个入口构成的“功能套件型扩展”。

### 3.1 manifest 声明出的核心入口

从 `old-salad-archive/.neutrinorc.js` 可以看出主要入口有：

- `content`
  主内容脚本，注入词典面板 UI。
- `selection`
  选区监听脚本，负责触发查词。
- `popup`
  浏览器 action 弹窗。
- `options`
  设置页。
- `background`
  后台脚本。
- `notebook`
  生词本页面。
- `history`
  历史记录页面。
- `quick-search`
  独立快速查词面板。
- `word-editor`
  独立词条编辑器。
- `audio-control`
  独立音频/波形控制页面。

### 3.2 manifest 暴露出的能力

从 `src/manifest/common.manifest.js` 和 `src/manifest/chrome.manifest.json` 可以看到旧项目具备：

- 全站内容注入：`<all_urls>`
- 后台常驻脚本
- `browser_action` 弹窗
- `options_ui`
- `webRequest` / `webRequestBlocking`
  主要服务于 PDF sniff 与跳转
- `contextMenus`
- `commands`
  支持多组快捷键
- `cookies`
  供部分同步/服务集成使用
- `notifications`
- `storage`
- `tabs`
- `unlimitedStorage`
- 可选权限：`clipboardRead`、`clipboardWrite`

### 3.3 浏览器支持面

项目内有：

- Chrome manifest
- Firefox manifest
- Edge manifest
- Safari manifest
- `mac-app/` Safari 包装壳

说明旧项目从设计上就是跨浏览器扩展，而不是只针对 Chrome。

## 4. 旧项目实现的主要用户功能

## 4.1 网页划词查词

这是项目的核心能力。

`src/selection/` 负责：

- 获取当前选中文本与上下文句子
- 监听手动选区触发
- 监听快捷触发
- 监听即时捕获模式
- 将结果发送给内容面板
- 支持 iframe 消息透传
- 支持手动发射当前选区

支持的触发方式来自 `src/app-config/index.ts` 与 `SearchModes` 设置项：

- 鼠标选区后显示图标
- 鼠标选区后直接查词
- 双击查词
- 按住修饰键查词
  `alt / shift / ctrl / meta`
- 即时捕获模式
  光标悬停或移动时延迟触发
- 面板固定时使用另一套触发规则
- 面板内选词时使用单独触发规则
- 独立快速查词窗口使用单独触发规则

还支持：

- 排除输入框 / 文本域触发
- 触屏模式
- 语言过滤，仅对指定语言文本自动触发
- 黑名单 / 白名单站点控制

## 4.2 注入式词典面板

`src/content/index.tsx` 会向网页注入三套核心 UI：

- `SaladBowl`
  悬浮入口或悬浮球
- `DictPanel`
  词典面板
- `WordEditor`
  词条编辑器

词典面板体系包含：

- `DictList`
  词典列表容器
- `DictItem`
  单个词典结果块
- `MenuBar`
  面板顶部工具条
- `MtaBox`
  多行文本输入区
- `WaveformBox`
  发音波形区
- `WordEditor`
  编辑/保存词条

面板特性包括：

- 多词典并行展示
- 每个词典独立折叠/展开
- 多行文本翻译输入
- 上下文翻译块
- 发音播放
- 收藏到 notebook
- 编辑 note / translation / context
- 暗色模式
- 自定义面板 CSS
- 可调宽度、高度比例、字体大小、悬浮球偏移
- 固定面板与非固定面板两套交互模式

## 4.3 独立快速查词窗口

`src/quick-search/` + `background/windows-manager.ts` 实现了独立快速查词窗口。

能力包括：

- 通过快捷键打开
- 通过浏览器弹窗打开
- 通过后台命令打开
- 可预载剪贴板内容
- 可预载当前页面选区
- 可配置打开后是否自动搜索
- 可配置打开后是否抢焦点
- 可配置为独立 popup window
- 可配置停靠在主窗口左侧或右侧
- 可记录独立窗口尺寸与位置
- 可在关闭时恢复主窗口布局

这部分是旧项目里很有特色的交互能力。

## 4.4 浏览器工具栏弹窗

`src/popup/` 实现了浏览器 action 弹窗，其行为并不固定，可以配置为：

- 直接显示词典面板
- 一键把当前选区加入生词本
- 打开设置页
- 打开独立快速查词窗口
- 直接执行某个上下文菜单动作

弹窗还支持：

- 配置宽高
- 配置预载来源
  `none / clipboard / selection`
- 配置是否自动搜索

## 4.5 右键菜单与页面级动作

`src/background/context-menus.ts` + `src/app-config/context-menus.ts` 实现了非常丰富的右键菜单系统。

它不仅支持固定内置菜单，还支持配置化自定义菜单。

内置菜单能力包括：

- Saladict 面板搜索
- Saladict 独立窗口搜索
- Google/Baidu/Sogou/Microsoft 页面翻译
- Youdao 页面翻译
- 以 PDF viewer 打开链接
- 从当前 PDF viewer 复制原 PDF 地址
- 直接跳转外部词典或搜索引擎
- 打开生词本页面
- 打开历史页面

上下文菜单的目标对象包含：

- 当前选区
- 页面
- 链接
- 图片
- 音频
- 视频
- frame
- 可编辑区域

## 4.6 快捷键系统

manifest 里注册了大量命令，后台 `initialization.ts` 负责处理：

- 启用/停用扩展
- 切换即时捕获模式
- 搜索剪贴板
- 打开 PDF viewer
- 打开快速查词窗口
- 打开 Google / Youdao / Caiyun 页面翻译
- 浏览历史上一条/下一条
- 切换 profile
- 直接切到 profile 1-5
- 把当前词条加入 notebook

这说明旧项目不只是“划词后看结果”，而是已经形成完整的键盘流。

## 4.7 词典与机器翻译引擎

`src/components/dictionaries/` 下有 **36 个词典/翻译源目录**。每个目录一般包含：

- `config.ts`
  注册词典能力、语言支持、默认展开规则、选项
- `engine.ts`
  抓取/请求并解析结果
- `View.tsx`
  渲染结果 UI
- `_locales.*`
  词典本地化文案
- `_style.shadow.scss`
  Shadow DOM 或局部样式
- `favicon.png`
  词典图标
- `auth.ts`
  仅部分需要鉴权的翻译服务拥有

已实现的词典/服务包括：

- 英语词典与语料类：
  `ahdict`、`bing`、`cambridge`、`cobuild`、`etymonline`、`eudic`、`googledict`、`lexico`、`longman`、`macmillan`、`merriamwebster`、`oaldict`、`urban`、`vocabulary`、`websterlearner`、`youdao`
- 机器翻译类：
  `baidu`、`caiyun`、`google`、`sogou`、`tencent`、`youdaotrans`
- 中文/中文知识类：
  `cnki`、`guoyu`、`liangan`、`wikipedia`、`zdic`
- 日语/韩语/多语种类：
  `hjdict`、`jikipedia`、`jukuu`、`mojidict`、`naver`、`renren`、`weblio`、`weblioejje`
- 其它：
  `shanbay`

词典层支持的典型能力包括：

- 并行搜索多个词典
- 每个词典独立选项
- 结果内部 tab/catalog 切换
- 词源页跳转
- 发音 URL 返回
- 按语言自动选择目标词典
- 自定义默认展开与折叠
- 可对长结果限制初始高度

机器翻译层还有额外能力：

- 自动检测源语言
- 目标语言切换
- 源文 / 译文复制
- 段落级保留换行策略
- 针对 PDF 与普通网页使用不同换行策略

## 4.8 Profile 体系

`src/app-config/profiles.ts` 显示旧项目有完整的 profile 体系，而不是单一配置。

默认内置了多套预设：

- 默认 profile
- sentence
- translation
- scholar
- nihongo

每个 profile 可以独立控制：

- 默认启用的词典集合
- 每个词典的选项
- 波形显示
- 面板折叠行为
- 多行文本自动展开策略

这意味着用户可以按使用场景切换整套查词模式，而不是只切换一个词典。

## 4.9 生词本与历史记录

`notebook` 和 `history` 都基于 `WordPage` 实现，底层数据由 Dexie 数据库保存。

每条 `Word` 记录包含：

- 时间戳
- 单词文本
- 上下文句子
- 页面标题
- 页面 URL
- favicon
- 翻译
- 用户备注

数据能力包括：

- notebook / history 两个独立表
- 搜索
- 排序
- 过滤
- 分页
- 批量删除
- 导出选中 / 当前页 / 全量数据
- 响应词条保存事件自动刷新

## 4.10 词条编辑器

词条编辑既可以嵌在面板里，也可以通过 `word-editor.html` 独立打开。

它的作用包括：

- 编辑已保存词条
- 调整 translation / note / context
- 与 notebook 工作流联动
- 在加入 notebook 后继续补充上下文翻译

这块对于“学习型扩展”很关键，因为它把查词结果转换成了可沉淀的学习条目。

## 4.11 发音与波形

旧项目对发音不是简单的 `audio.play()`，而是做成了完整子系统：

- `background/audio-manager.ts`
  保证同一时间只播放一个音频
- `audio-control/`
  独立音频控制页面
- `components/Waveform`
  波形展示
- `WaveformBox`
  面板内波形容器
- 自动发音配置
  支持中文、英文、机器翻译发音源选择
- 英音 / 美音切换

## 4.12 PDF 支持

这是旧项目非常重的一块。

项目通过 `scripts/pdf.js` 拉取并改造 PDF.js，然后配合 `background/pdf-sniffer.ts` 实现：

- 识别直接访问的 PDF 链接
- 识别服务器返回 `application/pdf`
- 自动重定向到内置 viewer
- 将 viewer 打开在普通 tab 或独立窗口
- 允许通过黑白名单控制哪些站点启用 PDF 接管
- 在 PDF viewer 中继续使用 Saladict 查词面板
- 支持“复制原 PDF 地址”

这是强功能点，但同时也是 MV3 迁移中需要重点评估的复杂部分。

## 4.13 Notebook 同步与外部服务集成

`src/background/sync-manager/services/` 下有 **4 个同步服务**：

- `ankiconnect`
  把词条写入 Anki
- `webdav`
  把 notebook 同步为远端 JSON 文件
- `eudic`
  同步到欧路词书
- `shanbay`
  同步到扇贝

对应能力包括：

- 定时同步
- 全量上传
- 增量添加
- 凭据配置
- 远端目录检查与初始化
- 服务状态检测
- 登录状态检测
- 错误通知

其中 Anki Connect 实现得最完整，支持：

- 检查牌组是否存在
- 检查 note type 是否存在
- 自动创建牌组
- 自动创建 note model
- 更新已有 note
- 推送后同步到 AnkiWeb

## 4.14 配置导入导出

`ImportExport.tsx` 支持将整个配置体系导入导出。

导出的内容包括：

- 基础配置 `baseconfig`
- 活跃 profile
- profile 列表
- 每个 profile 的详细数据
- 同步服务配置
- 一些 sync storage 状态

这意味着旧项目已经把“扩展设置 + 学习偏好”当成可迁移资产处理。

## 4.15 权限管理

除了 manifest 固定权限，旧项目还提供了设置页里的运行时权限管理：

- `clipboardRead`
- `clipboardWrite`

用户可以在 UI 中请求或移除这两个权限。

## 4.16 国际化

项目内有多层本地化：

- 应用文案目录：
  `en`、`es`、`ne`、`zh-CN`、`zh-TW`
- manifest 文案目录：
  `en`、`np`、`zh_CN`、`zh_TW`
- 每个词典自己的 `_locales`

设置页还允许切换 UI 语言：

- 简体中文
- 繁体中文
- English

## 4.17 测试与开发辅助

测试目录下大约有 **98 个测试文件**，覆盖重点包括：

- 各个 dictionary engine
- background 模块
- helper 工具层
- sync service

另外还有：

- Storybook 组件预览
- 词典 mock fixtures
- 本地 PDF.js 资源生成脚本

说明旧项目不是 demo，而是维护过相当长时间的成熟工程。

## 5. 设置页能力地图

设置页共有 **16 个栏目入口**：

- `General`
  扩展开关、动画、后台常驻、暗色模式、UI 语言
- `Notebook`
  收藏后是否打开编辑器、是否记录历史、上下文翻译、同步服务配置
- `Profiles`
  profile 管理与切换
- `DictPanel`
  面板尺寸、动画、暗色模式、suggest、固定、波形、面板 CSS
- `SearchModes`
  划词触发规则、语言过滤、双击延迟、不同场景下的查词模式
- `Dictionaries`
  词典开关与词典级选项
- `DictAuths`
  词典鉴权配置
- `Popup`
  action 弹窗行为、尺寸、预载与自动搜索
- `QuickSearch`
  三击 Ctrl、打开位置、预载来源、自动搜索、独立窗口配置
- `Pronunciation`
  自动发音词典、英音/美音、机器翻译发音来源
- `PDF`
  PDF sniff、独立打开、PDF 黑白名单
- `ContextMenus`
  右键菜单项目管理与自定义
- `BlackWhiteList`
  普通网页黑白名单
- `ImportExport`
  导入导出配置
- `Privacy`
  分析、更新检查等隐私相关项
- `Permissions`
  动态权限开关

从这个结构可以看出，旧项目的设置能力非常强，远远超过“简单查词插件”。

## 6. 数据与消息架构

## 6.1 消息流

核心架构是：

1. `selection` 获取选区
2. 通过消息发送给 `content` 或 `background`
3. `background/server.ts` 作为中转站
4. 动态加载某个 dictionary engine
5. 返回结果给面板渲染

后台还负责：

- 打开外部词典源站
- 播放音频
- 注入面板
- 管理快速查词窗口
- 操作 notebook/history 数据
- 获取建议词
- 处理一些跨域/后端绕行请求

## 6.2 本地数据

Dexie 数据库中有三张表：

- `notebook`
- `history`
- `syncmeta`

说明旧项目不仅保存学习记录，也维护远端同步所需的元数据。

## 6.3 配置层

配置主要分成三层：

- AppConfig
  全局行为配置
- Profile
  场景化词典组合配置
- DictAuth
  少数词典的密钥配置

## 7. 从 MV3 重做角度看，可借鉴的旧代码资产

这一节先不做最终取舍，只列出“值得后续重点参考”的资产。

### 7.1 高复用价值

- `src/app-config/`
  适合借鉴配置模型、profile 思路、词典注册表设计。
- `src/components/dictionaries/`
  适合借鉴词典模块拆分方式：
  `config + engine + View`
- `src/background/server.ts`
  适合借鉴“后台作为统一中转站”的接口组织方式，但实现需按 MV3 重写。
- `src/_helpers/record-manager.ts`
  适合借鉴词条数据结构。
- `src/components/WordPage/`
  适合借鉴 notebook/history 的页面产品形态。
- `src/content/components/*`
  适合借鉴面板 UI 分层。

### 7.2 中等复用价值

- `src/background/windows-manager.ts`
  适合参考快速查词窗口与侧边栏式独立窗口思路。
- `src/options/components/Entries/*`
  适合参考功能拆分与设置面板组织方式。
- `src/background/sync-manager/services/*`
  如果新插件需要学习记录同步，可参考接口设计。

### 7.3 高复杂度、需谨慎迁移

- `src/background/pdf-sniffer.ts`
  与 MV2 的 `webRequestBlocking` 强相关，迁到 MV3 成本高。
- 页面翻译注入脚本
  依赖第三方页面结构与 CSP，后续维护成本高。
- 多浏览器差异层
  如果我们只做 Chrome MV3，可以不必照搬。
- Safari / Firefox 包装层
  对当前目标无直接帮助。

## 8. 对我们下一步的直接帮助

这份旧项目整理可以支撑下一步做两个决策：

1. 我们要做的是“轻量 MV3 查词插件”，还是“保留学习系统的完整型插件”。
2. 我们要从旧项目里复用哪些业务思想，而不是机械搬运哪些文件。

更具体地说，后续可以把旧项目能力拆成几档：

- 最小核心：
  选区监听、内容面板、后台消息、少量词典引擎
- 中等增强：
  popup、quick search、profile、发音、历史
- 重型能力：
  notebook、同步、词条编辑、PDF、页面翻译、多服务鉴权

## 9. 建议的下一步讨论顺序

建议下一轮直接按下面顺序做取舍：

1. 先定新插件目标用户和最小使用场景
2. 从旧项目里只挑必须保留的功能
3. 再决定哪些旧模块值得参考实现
4. 最后设计 MV3 的新目录结构和 manifest

---

本文档基于 `old-salad-archive/` 当前目录结构、manifest、配置模型、后台逻辑、设置页、词典目录、同步服务和页面入口整理，目标是为后续 MV3 重构做功能盘点，而不是直接给出迁移方案。
