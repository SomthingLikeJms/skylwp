# ASCII 城市

由本机活动驱动的 ASCII 城市动态壁纸，画面和控制台沿用项目内的美术原型。当前提供 Windows 免安装便携版和独立的浏览器预览。

这是源码仓库，依赖、开发工具链、本机数据和 `outputs/` 构建产物不提交到 Git。首次使用请先按下方“开发”说明构建。

构建后双击根目录 `Start.cmd`，或解压生成的 `outputs/AsciiCity-Wallpaper.zip` 后双击 `AsciiCity.exe`。便携版使用现有 WebView2，自动读取本机系统、播放输出、媒体会话和 Agent 记录，并挂在桌面图标下面。双击托盘图标打开控制台，**Esc** 返回桌面；`Stop.cmd` 或托盘菜单可退出。使用说明见 `docs/PORTABLE.md`。

`Start-Preview.cmd` 和 `outputs/ASCII城市预览.html` 保留为模拟前端预览，便于独立开发；按 **H** 切换交互与壁纸预览。

## 当前功能

- 外滩、曼哈顿、维港三个场景，三种主题、三档字格，以及原型中的倒影、船、居民、云雾与灯光。
- 在线城市天气和三档氛围，精细字符、电路纹理、扫描光带、信号流、雨滴涟漪、流星、雪、雷电与雨后彩虹。
- 天气和 Agent 小组件统一视觉，可分别拖动、键盘微调和重置，位置随便携设置保存并在重启后恢复。
- Codex 桌面新版日志的实际文件修改、命令执行、测试和思考活动，实时显示活动卡片和施工状态。
- 独立于渲染帧率的 30 Hz 世界步进，带种子随机数和统一事件协议。交互渲染 30 fps，壁纸预览 12 fps。
- 按任务步骤建楼，读文件/编辑/命令事件入口，等待确认、报错、测试通过与会话完成。
- 中文双宽字形、按显示宽度截断、2048×2048 动态字形图集与 LRU 淘汰。离线预览使用系统中文字体。
- 原生版每十分钟读取 Open-Meteo 天气，支持 Windows 系统城市、固定城市或跟随场景；新安装默认使用系统城市。月亮用点阵表情显示实况天气；城市云雨默认跟随本机负载，CPU 多云、下雨、雷暴和内存起雾阈值、平滑时间、保持时间均可保存，也可切换为跟随实况。独立网页保留模拟数据。
- 原生桌面空白单击烟花，排除图标和拖动框选；江面保留低亮度的 CPU、内存及最近 Agent 动作/进度，支持浓度、内容与 01 数值设置。
- 本次运行的时间轴、暂停/播放、跳转、JSONL 导入与导出；每五分钟在内存中保留检查点。
- 隐私开关；记录默认对任务、曲名与错误详情脱敏，勾选后才导出具体文字。
- 城市采用 WebGL2 单次绘制，按变化的行上传字格纹理；月亮使用小尺寸 Canvas 点阵层，保留平滑圆形轮廓。

记录的起点是打开预览的时刻；关闭前可导出。浏览器隐藏时停止预览步进，避免后台空耗。脱敏后的记录保留世界事件和进度，世界中的文字也使用脱敏内容；勾选包含文字的导出可精确保留原始文字。

## 开发

需要 Node.js 22.12 或更新版本。项目使用 npm workspaces。

```powershell
npm ci
npm run dev
npm run check
npm test
npm run build
```

开发地址为 `http://127.0.0.1:5173`。`npm run build` 同时生成常规静态目录 `apps/web/dist` 和单文件离线预览。

Windows 桌面源码位于 `apps/shell`，使用 Tauri 2、Rust 和 Windows API。可在项目目录准备便携开发工具链，然后构建便携 ZIP：

```powershell
./scripts/prepare-rust.ps1
./scripts/package-native.ps1
```

开发工具链仅供构建，最终用户无需安装它们。`data`、本机日志和配对令牌不会进入 ZIP。

浏览器验证使用本机 Edge，不下载浏览器：

```powershell
# 先启动开发服务，再在另一终端执行
$env:CITY_URL = 'http://127.0.0.1:5173/?qa=1'
npm run test:browser
```

`tools/visual-compare.mjs` 使用 4173 端口运行原型对照测试。输出截图与报告位于 `artifacts/`，属于本地验证产物。

## 结构

- `reference/ascii-city.html`：原型的原样副本，作为美术基准。
- `apps/web/src/engine`：网格、字形图集、显示宽度、着色器和 WebGL2 输出。
- `apps/web/src/world`：世界数据、时钟、随机数、噪声、步进和光照。
- `apps/web/src/scenes`：场景数据、地标与程序化楼宇。
- `apps/web/src/compose`：按原型顺序合成画面。
- `apps/web/src/events`：协议校验、事件总线、模拟脚本、记录和回放。
- `apps/web/src/systems`：Agent、天气、文字与实体动作。
- `docs/PLAN.md`：用户提供的完整方案。
- `docs/STATUS.md`：当前交付范围和后续工作。

宿主可调用 `window.asciiCity.dispatch(event)` 输入符合协议的事件；`window.asciiCity.export()` 返回默认脱敏的 JSONL。该接口只消费数据，不执行收到的脚本或命令。
