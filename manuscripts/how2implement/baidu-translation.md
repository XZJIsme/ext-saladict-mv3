# 如何让百度翻译在当前插件里真正可用

## 结论

旧项目里让百度翻译“变得有用”的关键，不是直接抓百度网页，也不是在项目里手写一套百度签名算法，而是：

1. 把百度翻译接入成一个“机器翻译 source”
2. 通过统一的机器翻译参数层决定 `sl` / `tl` / 换行策略
3. 使用 `@opentranslate/baidu` 发请求
4. 从设置里读取百度开放平台凭据 `appid` / `key`
5. 把结果喂回统一的 `MachineTrans` 视图组件

也就是说，旧项目的百度翻译本质上依赖的是“百度翻译开放平台 API + `@opentranslate/baidu` 封装”，而不是网页抓取。

## 相关文件

- `old-salad-archive/src/components/dictionaries/baidu/config.ts`
- `old-salad-archive/src/components/dictionaries/baidu/auth.ts`
- `old-salad-archive/src/components/dictionaries/baidu/engine.ts`
- `old-salad-archive/src/components/MachineTrans/engine.ts`
- `old-salad-archive/src/options/components/Entries/DictAuths.tsx`
- `old-salad-archive/src/components/MachineTrans/MachineTrans.tsx`
- `old-salad-archive/src/app-config/auth.ts`

## 旧项目里的实现方式

### 1. 百度翻译被定义成一个机器翻译 source

`config.ts` 没有复杂逻辑，只是声明：

- 百度支持哪些语言
- 它使用统一的 `machineConfig(...)`
- 它在配置层拥有 `keepLF`、`slInitial`、`tl`、`tl2` 这些机器翻译通用选项

这说明旧项目没有为百度单独造一套 UI 和参数模型，而是把百度翻译纳入统一机器翻译框架。

### 2. 凭据结构很简单

`auth.ts` 只定义了：

```ts
export const auth = {
  appid: '',
  key: ''
}
```

同时还给了一个官方入口地址：

```ts
http://api.fanyi.baidu.com/api/trans/product/prodinfo
```

这表示旧项目预期用户自己去百度开放平台申请凭据，然后填入设置页。

### 3. 真正发请求的是 `@opentranslate/baidu`

`engine.ts` 是关键：

- 它 `import { Baidu } from '@opentranslate/baidu'`
- 通过 `new Baidu({ env: 'ext', config })` 创建 translator
- 如果构建环境里有 `BAIDU_APPID` / `BAIDU_KEY`，就用环境变量
- 否则运行时从 `config.dictAuth.baidu.appid` / `config.dictAuth.baidu.key` 读取
- 最终调用：

```ts
translator.translate(text, sl, tl, translatorConfig)
```

这里说明几件事：

- 旧项目没有自己实现百度签名
- 旧项目把百度 API 的细节交给 `@opentranslate/baidu`
- 当前用户设置里的 `appid/key` 会覆盖到这次请求

### 4. 语言方向不是百度自己决定，而是统一机器翻译层先算好

真正决定 `sl` / `tl` / 文本预处理的是 `getMTArgs(...)`，在 `MachineTrans/engine.ts`：

- 先根据配置决定是否保留换行
- 如果文本像日文/韩文，会先给一个初始源语言
- 否则调用 translator 的 `detect(text)` 自动识别
- 再按用户配置、插件语言、`tl2` fallback 等逻辑算目标语言
- 如果 `sl === tl`，会再做一次回退处理

所以旧项目不是“百度翻译自己单独识别语言”，而是先让统一层把参数算好，再调用百度 translator。

### 5. 结果渲染也复用统一视图

百度的 `View.tsx` 只是：

```ts
export { MachineTrans as default } from '@/components/MachineTrans/MachineTrans'
```

这表示百度结果展示没有特殊页面，直接复用机器翻译视图组件。

`search(...)` 返回的数据结构里包含：

- `sl`
- `tl`
- `searchText`
- `trans`
- `tts`

然后交给 `machineResult(...)` 包装 catalog 选项，例如：

- 切换源语言
- 切换目标语言
- 复制原文
- 复制译文

### 6. 设置页负责让用户输入凭据

`DictAuths.tsx` 会遍历所有 `dictAuth` 项，把每个翻译源的认证字段渲染成表单项。

对百度来说，最终就是两个输入框：

- `appid`
- `key`

并且帮助链接直接指向 `baidu/auth.ts` 里的官方地址。

### 7. 旧项目对“缺凭据”的显式处理并不在百度里完成

百度 `engine.ts` 本身没有像腾讯、搜狗那样主动返回 `requireCredential: true`。

它的逻辑更偏向：

- 有凭据就正常请求
- 请求失败就返回一个空的机器翻译结果

相比之下：

- 腾讯
- 搜狗

会在缺少 key 时显式返回 `requireCredential: true`，然后 `MachineTrans.tsx` 渲染“去设置页填写账号”的提示。

这意味着：

- 旧项目里的百度接入方式能工作
- 但它对“未配置凭据”的 UX 其实不够友好

## 对当前插件的直接启发

如果我们要在当前插件里把百度翻译做成“真正可用”，最靠谱的做法不是继续走现在这种打开官网页面的临时占位，而是复制旧项目的总体思路，但做一个更小、更清晰的版本。

### 推荐实现方案

1. 在当前插件里新增百度设置项
2. 设置页增加两个字段：
   - `baidu.appid`
   - `baidu.key`
3. 继续把这些设置存在统一设置对象里
4. 新增一个百度 translator 层
5. translator 层优先复用 `@opentranslate/baidu`
6. popup 在请求百度前先判断是否有凭据
7. 如果没有凭据，就直接明确显示“需要先在设置页填写 appid/key”
8. 如果有凭据，再真正发百度 API 请求

### 为什么建议这样做

- 路径最接近旧项目，风险最小
- 不用自己维护百度签名算法
- 以后切回多 source 架构也更顺
- 比当前“静态占位卡片”更诚实，用户能立刻知道缺了什么
- 比旧项目更好的一点是：可以在缺凭据时直接提示，不要吞掉错误

## 当前插件里需要补的东西

### 必需项

- 设置模型里增加百度凭据字段
- 设置页里增加百度凭据输入框
- 百度请求函数从设置里读取 `appid/key`
- 百度 source 在无凭据时返回明确错误信息

### 可选项

- 加一个“前往百度开放平台”的帮助链接
- 把百度 source 的状态区分成：
  - 未配置凭据
  - 请求失败
  - 翻译成功

## 不建议照搬的部分

### 1. 不建议继续引用旧项目文件

根据当前项目规则，`old-salad-archive/` 只能作为参考，不能在运行时继续依赖。

所以：

- 思路可以复用
- 代码需要复制出来并重写到当前项目

### 2. 不建议照搬旧项目的完整机器翻译框架

旧项目的 `MachineTrans` 抽象很好，但对当前插件来说太大了。

当前插件可以只复制有价值的部分：

- 语言方向决策思路
- 认证配置思路
- translator 封装思路

没有必要现在就把整个旧项目的 catalog、切换语言菜单、统一视图框架一起搬过来。

### 3. 不建议保留“失败后返回空结果”的 UX

旧项目百度 `catch` 之后返回空翻译结果，这会让用户看不出到底是：

- 没配置凭据
- 请求失败
- API 被拒绝

当前插件更应该直接显示明确错误文案。

## 最小落地步骤

如果后面开始实现，可以按这个顺序做：

1. 扩展设置结构，加入 `baidu.appid` / `baidu.key`
2. 设置页加输入框和保存逻辑
3. 在当前插件里新增百度 translator 模块
4. 接入 `@opentranslate/baidu`
5. 无凭据时返回明确提示
6. 有凭据时真正请求并渲染结果
7. 最后再考虑是否补语言切换、TTS、更多 catalog 能力

## 一句话判断

旧项目让百度翻译可用的真正方式是：

“把百度开放平台凭据接进统一机器翻译框架，并通过 `@opentranslate/baidu` 完成翻译请求。”

对当前插件来说，最值得复制的是这条架构思路，而不是网页抓取方案。
