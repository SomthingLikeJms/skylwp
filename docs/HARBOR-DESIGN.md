# 字符港湾视觉预览 0.9.0

本版根据用户选定的组合设计：ASCIICKER 的树木体积感、Kingdom Two Crowns 的远近层次、Eastward 的生活街区内容，以及 Matthew Walkden 港口插画的船型轮廓。素材均为本项目的字符几何绘制，没有引入参考作品的图片或代码。

- 树冠以不规则叶团、受光面与冷色阴影分层；三组树冠的比例不同，棕榈采用双干展开叶片。低矮灌木留出空隙。
- 咖啡露台、藤架长椅与台阶依附现有活动地点；居民买咖啡、休息、工作、候船、登船的状态机保留。
- 新增低对比远岸层次；维港保留自身山体。远景跳过建筑后面的不可见字格，树木几何只生成一次。
- 浏览器、Agent、内存、网络、播放器分别控制不同船型。每秒更新船群意图，不增加操作系统轮询。船只最多十四艘（含离港船）；前景渡轮使用独立航道。
- 截图中的测试预览使用固定种子 20261102；演示事件与原生真实采集验证分开记录。

视觉参考：

- [ASCIICKER](https://github.com/msokalski/asciicker)
- [Kingdom Two Crowns](https://kingdomthegame.com/kingdom-two-crowns/)
- [Eastward 官方图库](https://eastwardgame.com/media/)
- [Matthew Walkden / Arcane Waters](https://www.mattwalkden.com/arcane-waters-illustrations-1)
