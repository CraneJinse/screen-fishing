# 角色设计skill

游戏1.11.2内置经典搭子、柠檬和亡灵船长，打开信息面板→角色库即可切换，不需要安装skill。

需要自己设计角色时，使用独立仓库[screen-fishing-character-designer](https://github.com/CraneJinse/screen-fishing-character-designer)。当前版本0.6.1，支持本游戏1.11.0及以上。

在skill仓库Releases下载ZIP和校验文件，将screen-fishing-character-designer文件夹放到当前项目/.agents/skills/，入口为.agents/skills/screen-fishing-character-designer/SKILL.md。安装在项目下即可，不需要全局安装。下一轮对话调用$screen-fishing-character-designer，未刷新时重新打开项目。

从人物、船、鱼竿逐步设计；没有想法时用轻松问答探索。确认E动作规划板后自主完成22组动画，再展示网页看板，提供5个参考名字或使用用户自拟名字，并统一审阅，最终确认后导入。skill需要宿主图像生成工具；定制图和用户存档默认保留本机。详细流程与许可见skill仓库。
