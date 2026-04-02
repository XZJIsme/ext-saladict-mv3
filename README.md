# Saladict MV3 Minimal Demo

这是一个最小化的 Chrome Manifest V3 插件 demo。

当前功能：

- 使用旧项目复制出来的 icon
- 点击浏览器工具栏中的插件图标
- 打开一个空白 popup
- popup 右上角有一个 `×`，点击后关闭

## 在 Chrome 里运行

1. 在 Chrome 地址栏打开 `chrome://extensions`
2. 打开右上角的 `Developer mode`
3. 点击 `Load unpacked`
4. 选择当前项目根目录
5. 不要选 `old-salad-archive`

## 验证功能

加载成功后：

- Chrome 工具栏会出现插件图标
- 点击图标会打开一个白色空白 popup
- popup 右上角有关闭按钮 `×`
- 点击 `×` 后 popup 会关闭

## 你现在会看到的关键文件

- `manifest.json`
  MV3 扩展入口配置
- `popup.html`
  popup 页面结构
- `popup.css`
  popup 样式
- `popup.js`
  关闭按钮逻辑
- `assets/icons/`
  当前 demo 使用的图标资源
