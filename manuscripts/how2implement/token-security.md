# Token Security

## 目标

在设置页允许用户填写 token / key / secret，同时尽量避免泄漏。

这里的目标不是“绝对安全”，而是把风险面收窄到合理范围内。

## 基本判断

浏览器扩展里，用户自己输入的 token 不可能做到绝对安全。

能做到的是：

- 不同步到不必要的地方
- 不显示在不必要的地方
- 不传到不必要的地方
- 不让太多模块直接接触它

## 存储建议

### 普通设置

放在 `browser.storage.sync`：

- 主题
- 语言
- 启用哪些翻译源

### 敏感凭据

放在 `browser.storage.local`：

- token
- appid
- key
- secret

不要把敏感凭据放进 `sync`。

原因：

- `sync` 会跟浏览器账号同步
- 暴露面更大
- token 这类内容更适合只留在当前设备

## 数据结构建议

不要把凭据和普通设置混在一个对象里。

建议拆成两份：

- `userSettings`
- `dictCredentials`

这样做的好处：

- 语义清晰
- 后面导出普通设置时不容易误带 token
- 以后清空设置时可以分开处理

## 设置页建议

- 输入框默认使用密码类型
- 提供“显示 / 隐藏”切换
- 保存后不要把完整 token 明文展示在页面上
- 如果要显示已保存状态，优先显示掩码

第一版可以先不做复杂掩码，但至少不要在页面上反复明文回显。

## 请求时的原则

- token 只在扩展自己的上下文里使用
- 不要把 token 注入网页环境
- 不要把 token 放进 DOM
- 不要把 token 放进 URL query
- 优先放在请求 header 或 request body

也就是说：

- popup
- options
- background / service worker

这些扩展上下文可以接触 token。

网页本身不应该接触 token。

## 最常见的泄漏点

实际开发里，token 更容易从这些地方泄漏：

- `console.log(token)`
- 报错时打印完整请求对象
- 把 token 拼到 URL
- 把 token 渲染到页面
- 导出设置时把 token 一起导出
- 埋点 / 上报时把 token 带出去

这些地方要明确禁止。

## 是否需要本地加密

第一版不建议为了“看起来安全”做前端本地加密。

原因：

- 加密密钥仍然在扩展代码里
- 对真正能访问本机的人帮助不大
- 会增加实现复杂度
- 容易制造“已经很安全”的错觉

相比之下，更有价值的是：

- `local` 存储
- 最小暴露
- 不日志泄漏
- 不导出

## 实现建议

后面真正落代码时，建议拆成三层：

1. `userSettings`
   - 普通设置
   - 使用 `browser.storage.sync`

2. `dictCredentials`
   - 百度 / 彩云 / 其他 source 的凭据
   - 使用 `browser.storage.local`

3. `credentials` 模块
   - 统一读写凭据
   - 业务 UI 不直接到处访问存储

## 推荐结论

最靠谱的方案不是“神奇加密”，而是：

- 普通设置与凭据分离
- 凭据只放 `browser.storage.local`
- 凭据只在扩展内部使用
- 不进入日志、URL、DOM、导出文件
- 由少量专门模块统一管理

这已经是当前插件场景下，性价比最高的安全做法。
