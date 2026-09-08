# 摸鱼搭子

一个可随时放下的 Windows 桌面钓鱼小游戏。右键桌宠抛竿，中鱼后点击收杆，收集鱼类、特殊事件与成就。

![锦鲤](assets/ui/tray/screen-fishing-256.png)

当前版本：1.12.2 公开测试版。152种鱼、4个鱼包、60项特殊事件、71项成就、3位内置角色；纯本地存档，无账号、无内购。

## 直接游玩

在本仓库 Releases 下载 ScreenFishing-1.12.2-windows-x64.zip，完整解压到可写文件夹，双击 ScreenFishing.exe。不要直接在压缩包内运行，也不要只复制 exe。Windows x64 运行包已带 Electron，无需自行安装 Node.js。

GitHub 的 Source code 压缩包是开发源码，需要按下面步骤构建。当前未提供安装器、自动更新或代码签名；不要关闭系统防护，确认下载来源后再决定运行。

## 基本操作

- 右键人物/船：抛竿、收杆、切换水域、打开信息面板。
- 中鱼时点击人物/船收杆；按住拖动可移动桌宠。
- Ctrl+Shift+M：显示/隐藏桌宠；Ctrl+Shift+F：信息面板；Ctrl+Shift+Space：抛竿/收杆（均可在设置修改）。
- 默认静音；新档首杆约10秒，第2–5杆等待30–90秒，第6杆起等待5–10分钟。中鱼后前30秒显示动态提醒，随后保留静止黄色叹号，可随时收杆，鱼不会逃走。
- 鱼获卡显示10秒；关闭面板不会退出游戏。退出请使用托盘菜单或设置中的退出。
- 默认只有淡水F1；卖鱼得金币，依次解锁F2/S1/S2，咸水鱼需要主动切换到咸水。
- 商店提供自动抛竿鱼竿和三档永久钓饵；钓饵提高高稀有度及异色形态概率，自动抛竿可在设置中关闭。
- 信息面板的角色库可切换经典搭子、柠檬和亡灵船长；角色外观不影响概率与进度。

## 存档与升级

存档位于程序同目录 user-data/。新目录不带此文件夹时从0开始。升级前从托盘退出并备份完整 user-data，再将它复制到新版本程序同级目录。不要将存档提交到公共仓库。详见 [存档与隐私](docs/SAVE_AND_PRIVACY.md)。

## 从源码运行

Windows x64，Node.js 24 LTS 与 npm。依赖版本已锁定：

```powershell
npm ci
npm run check
npm test
npm start
```

构建便携包：`npm run build`。输出在 dist/，已存在的同名输出不会被覆盖，请先备份并移走旧输出。开发版存档也应避免提交。

## 测试和文档

- [发布前测试方案](docs/TEST_PLAN.md)、[游戏百科](docs/encyclopedia/GAME_ENCYCLOPEDIA.md)
- [构建与贡献说明](CONTRIBUTING.md)、[更新日志](CHANGELOG.md)
- `npm run verify:progression` 核验模拟器与真实状态机；`npm run simulate` 运行200组新档模拟。
- `npm run verify:ui` 和 `npm run verify:achievements` 使用隔离数据测试窗口，会短暂出现测试窗口。

## 许可

自有代码使用 [MIT](LICENSE)。美术及第三方内容不自动适用 MIT，详见 [素材声明](ASSET_NOTICE.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。
