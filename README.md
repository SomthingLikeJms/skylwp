# ASCII 城市

由本机活动驱动的 ASCII 城市动态壁纸，画面和控制台沿用项目内的美术原型。当前提供 Windows 免安装便携版和独立的浏览器预览。

当前版本 **0.9.3**：完善居民与设施互动，船群关联本机信号，统一楼宇、树木和船体材质，并修复桌面图标遮挡。功能范围与验证记录见 [当前状态](docs/STATUS.md) 和 [验证记录](docs/VALIDATION.md)。

## 下载与使用

- [下载 Windows x64 便携版 0.9.3](https://github.com/SomthingLikeJms/skylwp/releases/download/v0.9.3/Skylwp-0.9.3-windows-x64.zip)
- [下载浏览器演示包](https://github.com/SomthingLikeJms/skylwp/releases/download/v0.9.3/Skylwp-0.9.3-browser-preview.zip)：解压后打开 `Preview.html`，使用模拟信号。
- [版本说明与 SHA-256 校验文件](https://github.com/SomthingLikeJms/skylwp/releases/tag/v0.9.3)

Windows 版解压整个文件夹后双击 `AsciiCity.exe`，保留同目录的 DLL。需要 Windows x64 和 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)，无需安装 Node.js、Rust 或 Wallpaper Engine；当前实机验证环境为 Windows 11。双击托盘图标打开控制台，**Esc** 返回桌面；`Stop.cmd` 或托盘菜单可退出。升级时先退出旧程序，再用新文件覆盖原目录，保留自己的 `data` 文件夹。完整说明见 [便携版使用说明](docs/PORTABLE.md)。

程序可读取本机系统、播放输出、媒体会话和 Agent 记录，各项采集可在控制台关闭。版本为便携预览版；已知限制和验证范围见版本说明。

依赖、开发工具链、本机数据和 `outputs/` 构建产物不提交到 Git。源码开发与自行构建见下方“开发”；构建后也可使用根目录的 `Start.cmd`、`Start-Preview.cmd` 启动。浏览器演示按 **H** 切换交互与壁纸预览。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件与 GeoNames 数据沿用各自许可证，许可文本和归属见 [第三方声明](docs/THIRD-PARTY-NOTICES.txt)。天气服务的使用还须遵守 Open-Meteo 的服务条款。

## 当前功能

- 外滩、曼哈顿、维港三个场景，三种主题、三档字格，以及原型中的倒影、船、居民、云雾与灯光。
- 在线城市天气和三档氛围，精细字符、电路纹理、扫描光带、信号流、雨滴涟漪、流星、雪、雷电与雨后彩虹。
- 天气和 Agent 小组件默认 82% 透明，支持调整透明度、分别拖动、键盘微调、移除和重新添加，位置与显示状态随便携设置保存。
- 三座城市有各自的小店、长椅、工作台和码头。居民会排队买东西、端着杯子找座位、等船、登船与离开；长椅和渡轮有实际容量。雨天撑伞慢行，骑行暂停。
- 活跃 Agent 对应有颜色的居民：思考时去店里歇脚，等待确认时坐下等消息，工具活动回到工作台，明确完成计划或结束会话后去码头。四位普通居民维持城市日常，全部居民最多 14 人；没有新日志不会被视为完成任务。
- 两层远处城区、港口吊机与导航灯，加上屋顶设备、绿植、天线、阳台、底层店招与立面明暗，丰富远近层次。保留钓鱼居民、骑行者、小猫和水鸟。
- 滨水步道加入错缝石材铺装、护栏、路灯与地面光池、树池花坛、骑行带、导览牌、垃圾箱和候船廊。三城分别使用乔木、榆树和棕榈，以及不同铺装配色。
- 九类信号船和各城通勤渡轮采用独立图案、远近两档尺寸，带舷窗、倒影与方向性尾流。浏览器标签、活跃 Agent、内存、网络和播放器共同决定船型、数量与活动，信号船含离港船最多 14 艘；通勤渡轮保留居民登船互动。
- 楼宇、树木和船体共用材质与明暗比例，树冠按叶团受光，船体使用细边线和侧面阴影；普通窗灯偏暖，Agent 与音乐灯光保留对应信号色。
- Codex 桌面新版日志的实际文件修改、命令执行、测试和思考活动，实时显示活动卡片和施工状态。
- 独立于渲染帧率的 30 Hz 世界步进，带种子随机数和统一事件协议。交互渲染 30 fps，壁纸预览 12 fps。
- 按任务步骤建楼，读文件/编辑/命令事件入口，等待确认、报错、测试通过与会话完成。
- 中文双宽字形、按显示宽度截断、2048×2048 动态字形图集与 LRU 淘汰。离线预览使用系统中文字体。
- 原生版每十分钟读取 Open-Meteo 天气，支持 Windows 系统城市、固定城市或跟随场景；新安装默认使用系统城市。月亮用点阵表情显示实况天气；城市云雨默认跟随本机负载，CPU 多云、下雨、雷暴和内存起雾阈值、平滑时间、保持时间均可保存，也可切换为跟随实况。独立网页保留模拟数据。
- 原生桌面空白单击烟花，排除图标和拖动框选；江面保留低亮度的 CPU、内存及最近 Agent 动作/进度，支持浓度、内容与 01 数值设置。
- Windows 11 壁纸窗口保持在桌面图标下面，切换模式时重新确认层级，系统调整层级后自动恢复。采集使用事件通知与有界缓存，静音时音频降频，未变动的 Agent 日志跳过读取。
- 最近 15 分钟的时间轴、暂停/播放、跳转、JSONL 导入与导出；每 30 秒保留检查点，事件还受 10,000 条和 6 MiB 的容量限制。
- 隐私开关；记录默认对任务、曲名与错误详情脱敏，勾选后才导出具体文字。
- 城市采用 WebGL2 单次绘制，按变化的行上传字格纹理；月亮使用小尺寸 Canvas 点阵层，保留平滑圆形轮廓。

记录窗口会向前移动，导出包含窗口起点的世界状态；关闭前可导出。音频帧只用于实时频谱，不进入历史，回放保留播放状态、曲目和节拍事件，不能精确还原实时音频灯效。浏览器隐藏时停止预览步进。脱敏后的记录保留世界事件和进度，检查点中的任务、曲名和日志也脱敏；勾选包含文字后才保留具体文字。新导出使用 `city-v9` 并保存居民行程与船群状态，仍可导入 `city-v4` / `city-v5` / `city-v6` / `city-v7` / `city-v8` 记录；旧记录使用当前场景画法，按兼容规则恢复居民与船群。

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
