# README 媒体

全部画面由当前 0.9.3 前端实际绘制，使用固定种子 `20261102` 和演示事件。天气、任务、浏览器和音乐输入为模拟数据，不是本机采集证明。没有使用生成式图片，也没有改变程序的美术样式；小组件位置通过程序已有的布局设置调整。

| 文件 | 内容 | 尺寸 | 播放 |
| --- | --- | --- | --- |
| `bund-dusk.png` | 外滩黄昏 | 1920×1200 | 静态 |
| `manhattan-night.png` | 曼哈顿夜景 | 1920×1200 | 静态 |
| `victoria-harbour-day.png` | 维港白天 | 1920×1200 | 静态 |
| `city-live.gif` | 城市、施工进度与完成烟花 | 1280×800 | 8 秒，10 fps，2 倍速 |
| `residents-life.gif` | 白天步道，休息、候船与登船 | 1060×296 | 10 秒，10 fps，8 倍速 |

GIF 使用同一调色板、无抖动编码并循环播放。原始逐帧 PNG、事件状态、检查与编码报告保存在忽略的 `artifacts/readme-media/`。居民片段会验证：等待确认对应坐下、明确完成后经历登船、乘船和离开；普通居民会买东西。

重新生成需要项目开发依赖、本机 Edge，以及带 Pillow 的 Python，仅供维护媒体时使用：

```powershell
# 终端一
npm run dev

# 终端二
node tools/capture-readme-media.mjs
python tools/encode-readme-gifs.py
```

`EDGE_PATH` 可指定浏览器路径，`CITY_URL` 可指定开发地址（需保留 `?qa=1`）。项目用户使用壁纸或浏览器演示不需要这些录制工具。
