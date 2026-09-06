'use strict';

const fs = require('node:fs');
const path = require('node:path');
const game = require('../src/game-state-runtime');
const probability = require('../src/probability-system');
const variants = require('../src/fish-variants');
const eventsRuntime = require('../src/special-events');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'docs', 'encyclopedia', 'GAME_ENCYCLOPEDIA.md');
const measurements = JSON.parse(fs.readFileSync(path.join(root, 'data', 'fish-measurements.json'), 'utf8'));
const actions = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'pet', 'v1-runtime', 'action-manifest.json'), 'utf8'));
const specialEvents = JSON.parse(fs.readFileSync(path.join(root, 'data', 'special-events-v1.json'), 'utf8'));
const measurementById = new Map(measurements.entries.map((entry) => [entry.fishId, entry]));
const rarityOrder = new Map(game.RARITIES.map((rarity, index) => [rarity, index]));
const variantMultipliers = variants.VALUE_MULTIPLIERS;
const defaultSettings = game.createInitialState(1).settings;
const totalRarityWeight = Object.values(probability.RARITY_WEIGHTS).reduce((sum, value) => sum + value, 0);
const naturalVariantWeights = probability.variantWeights({});
const totalVariantWeight = Object.values(naturalVariantWeights).reduce((sum, value) => sum + value, 0);
function firstBoostAttempt(counter, variant) {
  for (let misses = 0; misses < 1000; misses++) {
    if (probability.variantWeights({ [counter]: misses })[variant] > naturalVariantWeights[variant]) return misses + 1;
  }
  throw Error(`No soft pity threshold for ${variant}`);
}
function hardPityAttempt(counter, level) {
  for (let misses = 0; misses < 1000; misses++) if (probability.pityMinimum({ [counter]: misses }) >= level) return misses + 1;
  throw Error(`No hard pity threshold for ${counter}`);
}

function escapeCell(value) {
  return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function compact(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { maximumFractionDigits: digits, useGrouping: false });
}

function mass(valueG) {
  const value = Number(valueG);
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${compact(value / 1_000_000, 2)} t`;
  if (value >= 1000) return `${compact(value / 1000, 2)} kg`;
  if (value >= 1) return `${compact(value, 2)} g`;
  return `${compact(value * 1000, 2)} mg`;
}

function valueRange(fish, profile, multiplier = 1) {
  // Conservative envelope: the size/weight endpoints need not co-occur in a real sample.
  // Match runtime rounding: round ordinary value first, then apply the variant multiplier.
  const price = (edge) => Math.max(1, Math.round(game.calculateCatchValue(fish, {
    lengthCm: profile.lengthCm[edge], weightKg: profile.weightG[edge] / 1000
  }, profile) * multiplier));
  const low = price('min');
  const high = price('max');
  return `${low}–${high}`;
}

function table(headers, rows) {
  const head = `| ${headers.map(escapeCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, divider, ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`)].join('\n');
}

function packFish(packId) {
  return game.FISH
    .filter((fish) => fish.pack === packId)
    .sort((left, right) => rarityOrder.get(left.rarity) - rarityOrder.get(right.rarity)
      || Number(left.id.replace('fish-', '')) - Number(right.id.replace('fish-', '')));
}

function fishCatalogSection(packId) {
  const pack = game.PACK_DEFINITIONS[packId];
  const rows = packFish(packId).map((fish) => {
    const profile = measurementById.get(fish.id);
    if (!profile) throw new Error(`Missing measurement profile: ${fish.id}`);
    return [
      profile.catalogIndex,
      fish.id,
      fish.name,
      profile.nameEn,
      profile.scientificName,
      game.rarityNames[fish.rarity],
      `${compact(profile.lengthCm.min)} / ${compact(profile.lengthCm.typical)} / ${compact(profile.lengthCm.max)}`,
      `${mass(profile.weightG.min)} / ${mass(profile.weightG.typical)} / ${mass(profile.weightG.max)}`,
      fish.baseValueCoins,
      valueRange(fish, profile),
      valueRange(fish, profile, variantMultipliers.alternate),
      valueRange(fish, profile, variantMultipliers.golden),
      valueRange(fish, profile, variantMultipliers.iridescent)
    ];
  });
  return `### ${packId} · ${pack.name}\n\n- 水域：${game.HABITATS[pack.habitat]}\n- 解锁价格：${pack.starter ? '初始免费' : `${pack.priceCoins} 金币`}\n- 前置鱼包：${pack.prerequisitePack || '无'}\n- 收录：38 种（普通 18、稀有 10、史诗 6、传说 3、神话 1）\n\n${table([
    '序号', 'ID', '中文名', '英文名', '代表学名', '稀有度', '长度 min/典型/max（cm）',
    '重量 min/典型/max', '基准价', '原色价值', '异色价值', '纯金价值', '炫彩价值'
  ], rows)}`;
}

const packRows = game.PACK_ORDER.map((packId) => {
  const pack = game.PACK_DEFINITIONS[packId];
  return [packId, pack.name, game.HABITATS[pack.habitat], packFish(packId).length,
    pack.starter ? '免费' : pack.priceCoins, pack.prerequisitePack || '无'];
});

const rarityRows = game.RARITIES.map((rarity) => {
  const count = packFish('F1').filter((fish) => fish.rarity === rarity).length;
  const percent = probability.RARITY_WEIGHTS[rarity] / totalRarityWeight * 100;
  return [game.rarityNames[rarity], rarity, count, `${compact(percent)}%`, game.RARITY_BASE_VALUES[rarity]];
});

const actionRows = Object.entries(actions.actions).map(([id, action]) => [
  id,
  action.frameCount,
  action.loop ? '循环' : '一次性',
  action.frameDurationMs,
  action.animationMeta?.type || '标准逐帧',
  ['drag_idle', 'drag_fishing'].includes(id) ? '仅兼容保留，拖动时不调用'
    : ['bite_urgent', 'fish_escape', 'sad_recover'].includes(id) ? '旧流程兼容素材，当前正常垂钓不触发' : '正式使用'
]);

const achievementRows = game.ACHIEVEMENTS.map((item) => [
  item.id, item.name, item.description, item.target, item.stat
]);

const specialSeriesNames = Object.fromEntries(specialEvents.series.map((series) => [series.seriesId, series.name]));
const specialEventRows = eventsRuntime.REGISTRY.map((item) => [
  item.id, specialSeriesNames[item.seriesId], item.title, item.description
]);

const docs = `# 《摸鱼搭子》游戏百科全书

状态：持续维护的项目权威总览。  
当前游戏版本：${require('../package.json').version}（Electron ${require('../package.json').devDependencies.electron}）；存档 schema ${game.SAVE_SCHEMA_VERSION}；尺寸模型 ${measurements.measurementVersion}；经济模型 ${game.ECONOMY_VERSION}。  
百科生成方式：\`npm run docs:encyclopedia\`。鱼类、尺寸、动作、事件、成就、价格区间与保底阈值从当前运行代码和正式数据生成。2026-09-07逐章核对；此文是对应游戏版本的快照，不承诺未来版本相同。

> 标记说明：本百科以 ${require('../package.json').version} 钓鱼核心版、正式 manifest 和验证报告为真源；桌面鱼缸已按 1.5.5 完成状态封存，不进入当前运行包。特殊事件三个系列与 60 项收藏使用概率 V3 和新版高清物件图案。

## 1. 游戏总览

《摸鱼搭子》是一款纯本地、可随时中断的 Windows 桌宠钓鱼游戏。新存档默认使用经典搭子，也可切换柠檬、亡灵船长或自定义整套角色；角色、船和钓组作为完整主体逐帧播放，实际鱼获单独叠加。桌宠可拖到显示器工作区内，使用小型透明窗口；置顶时主体可能覆盖下方内容，可拖走或隐藏，不读取其他应用内容。

核心体验是“抛竿—低频等待—中鱼提示—点击收杆—飞鱼落船—查看或收藏鱼获”。操作不要求连续输入，隐藏或退出不会产生离开惩罚。

### 1.1 产品原则

- 隐蔽：透明小窗口、快捷按钮默认隐藏、信息面板按需打开。
- 可中断：任何阶段均可隐藏；暂停时冻结游戏计时，不计算离线收益。新存档船下默认显示正向秒表，不是剩余倒计时。
- 轻操作：右键展开四个快捷按钮，中鱼时直接左键桌宠收杆。
- 本地优先：无账号、无云同步、无排行榜，不读取屏幕、键盘内容或其他应用数据。
- 收集驱动：152 种鱼、60 项特殊事件、五档鱼类稀有度、尺寸纪录、仓库、经济、成就与颜色变体共同支撑长期目标。

## 2. 当前版本边界

### 角色库（${require('../package.json').version}）

信息面板提供角色库：内置经典搭子、柠檬与亡灵船长，可导入自定义角色、刷新与整套切换。新存档默认经典搭子，三位角色均可立即使用。人物、船、鱼竿依次设计后组合为22组152帧完整动画；草稿显示“制作中”，不能切换。外观选择独立保存，不修改钓鱼规则、计时或收藏进度。经典素材位于assets/pet/v1-runtime，另外两位内置角色位于assets/characters；自定义便携角色位于user-data/characters，源码角色位于.screen-fishing-dev/characters。升级优先保留同ID自定义角色，已选角色缺失或损坏时回退经典搭子并提示；导入新角色后需在角色库点击“使用角色”切换。

角色设计skill为screen-fishing-character-designer：定制或安装流程中检测项目，有需要并获得同意后从官方GitHub下载兼容游戏；按人物→船→鱼竿咨询和确认，完成动画、起名及最终验收后入库。附带百科的skill也可直接回答玩法问题；纯问答不要求检测或下载。普通skill安装本身不会运行程序，skill与游戏分别维护版本。

### 2.1 已实现（${require('../package.json').version}）

- 三窗口：桌宠、信息面板和鱼获卡；桌面鱼缸窗口不创建。
- 当前运行模块声明${game.STATES.length}个状态，其中bite_urgent、escaping、sad_recover用于旧流程兼容；正常流程使用其余11个。资源契约仍保留22组主体动作、152个时序帧，资源数量不等于现行玩法状态数量。
- 四包 152 种鱼、四颜色模板、每种 64×64 图鉴图和四模板空中动作。
- 1824 个异色运行图层：原色/异色/纯金图标与空中条，以及炫彩银白底、遮罩、细节三分层图标与空中条。
- 现实尺寸模型、71 项成就、1000 条历史、自适应列数仓库、单卖/批量卖出、商店和淡咸水场景。
- 分层概率、1% 随机脱钩、全局三档保底、变体价值、首次珍稀形态自动锁定及显式解锁。
- 漂流瓶 30、科研标记 10、生态守护 20，共 60 项特殊事件收藏；概率 V3 为均匀随机 3–7 次有效上钩间隔，平均每 5 次出现一次，长期约 20%；动态去重与新内容保底保持不变。
- 三张原系列封面、34 张 256×256 事件物件图、34 套 1536×256 六帧上钩动画，以及随机脱钩专用结果图案。漂流瓶采用同款瓶型与四类瓶身徽记，科研 10 件、生态 20 件逐项独立。
- 可靠本地存档、旧档迁移、快捷键、声音、发布门禁与 portable 包。

### 2.2 当前界面精简

- 信息面板首页有9个入口：鱼类图鉴、鱼类仓库、商店、特殊事件、成就、角色库、历史收获、设置、玩法帮助。无隐藏桌宠按钮，余额位于右上角；统计为已发现、总捕获、最近收获。图鉴只保留图鉴顺序，仓库以单个下拉按钮提供捕获、图鉴、稀有度和异色四种排序。
- 面板字号、按钮和图标采用固定 CSS 像素尺寸；窗口宽高独立调整时自动换列、换行。仓库排序、筛选、搜索与批量出售在窄窗口允许换行，不再整体缩放或强制同排。

### 2.3 已封存

- 1.5.5 桌面鱼缸完整实现、912 条游动素材和 34 件造景商品已经封存。${require('../package.json').version} 钓鱼核心版不创建鱼缸窗口、不注册鱼缸快捷键、不显示入口或装饰商城；原鱼缸状态先写入同级封存文件，展示鱼安全回到仓库。

## 3. 窗口与交互系统

| 窗口 | 职责 | 关键规则 |
| --- | --- | --- |
| \`petWindow\` | 桌宠、动作、快捷按钮、秒表 | 透明置顶；拖动按主体锚点；不建立全屏输入层 |
| \`panelWindow\` | 图鉴、仓库、成就、历史、商店、设置 | 固定字号，宽高独立调整、自动换列与换行；失焦不自动关闭；子页面左上返回 |
| \`resultWindow\` | 普通鱼获、特殊事件、脱钩结果卡 | 不支持拖边缩放；随桌宠大小设置有限缩放，优先放主体上方，顶部空间不足时改到下方并限制在工作区；统一10秒隐藏；点击详情前先隐藏 |

右键桌宠显示“抛竿、收杆、场景、面板”四个像素按钮，10 秒无操作自动隐藏。左键移动超过约 6 像素识别为拖动；普通单击触发角色回应，中鱼状态单击直接收杆。拖动不切换独立动作。

当前EXE文件、任务栏与托盘统一使用图鉴锦鲤原色图案；打包时写入多尺寸ICO资源。黄色/红色叹号使用透明像素SVG，无方框，30秒后黄色静止；红色仅保留兼容样式，不恢复超时逃脱。1.9.4 的信息面板首次打开等待页面与渲染就绪，显示后检查实际可见性，兼容 Windows 隐藏启动参数。

默认Ctrl+Shift+M显示/隐藏桌宠，Ctrl+Shift+F打开信息面板，可在设置中修改。关闭信息面板只隐藏该面板，不暂停桌宠；隐藏桌宠会暂停钓鱼并收起面板及结果卡。真正退出使用托盘或设置中的“退出游戏”。

## 4. 钓鱼状态与时间系统

正常成功状态链（30秒内即可收杆，无需等到bite_ready）：

\`idle → casting → waiting → bite_intro/bite_loop → reel_pull → catch_flight → catch_land → celebrating → idle\`

失败或主动分支：

- 等待/抛竿中提前收杆：\`empty_reel → idle\`。
- 从中鱼开始累计30秒未收杆：转为\`bite_ready\`，使用waiting平缓持竿动作和静止黄色叹号，原鱼或事件保留，随时可进入reel_pull。
- 随机脱钩：上钩时已经决定，玩家收杆时复用empty_reel空杆表现并显示独立“鱼已挣脱”结果卡；与收杆早晚无关，不结算鱼类变体、尺寸或价值，特殊事件不走随机脱钩。

新存档首杆从抛竿到中鱼共10秒（含抛竿动画），保证普通原色鱼；第2–5杆等待30–90秒；第6杆起等待5–10分钟，使用Beta(3,3)中部更密集分布。等待时长在抛竿时确定并存档，取消重抛消耗新手杆数。前30秒为提醒期，之后原地待收杆，不逃脱、不自动入库或继续钓下一条。

第2–5杆也使用Beta(3,3)，这些范围是抛竿动画结束后的等待，完整一杆还需加抛竿及收获动画。第6杆起等待均值约7.5分钟，并非每杆固定时长。首杆不随机脱钩，不触发特殊事件，仍累计一次非特殊上钩。提前收杆发生在上钩前，因此不推进特殊事件间隔或颜色保底。新存档显示抛竿计时默认${defaultSettings.showCastTimer ? '开启' : '关闭'}，只在抛竿/等待时显示，可在设置关闭。

## 5. 鱼类与图鉴系统

### 5.1 鱼包

${table(['鱼包', '名称', '水域', '物种数', '价格（金币）', '前置'], packRows)}

四包均为普通 18、稀有 10、史诗 6、传说 3、神话 1。全部鱼包筛选时按 F1→F2→S1→S2 分区，每包内部按普通→稀有→史诗→传说→神话，再按后台序号排列；后台序号不在玩家界面展示。

购买按前置鱼包和金币判断，不要求集齐上一包38种鱼。解锁S1后才能切换咸水；场景切换只允许在待机或空杆收线阶段，垂钓中不能切换。选定水域只从该水域已拥有鱼包抽鱼。

### 5.2 稀有度

${table(['名称', '代码', '每包数量', '当前概率', '经济基础价'], rarityRows)}

1.3 已统一采用 70/20/7/2.5/0.5；先抽稀有度，再在选中鱼包的同稀有度物种中等概率选择。

### 5.3 尺寸与重量

- 长度：以典型成体长度为中心的截断正态分布，并限制在每个物种的资料范围内。
- 重量：\`FishBase Bayesian a × lengthCm^b × 独立体况扰动\`，再限制在物种重量上下限。
- 长度与重量相关但不一一锁定；同样长度可因体况产生合理重量差异。
- 小于 1 g 的真实微型鱼以 mg 显示，不强行抬高为 1 g。
- 现实尺寸不直接决定屏幕像素，画面只使用 \`displayClass/displayScale\` 保持可读性。

### 5.4 图鉴信息

未发现鱼显示统一剪影；发现后显示名称、稀有度、鱼包、首次捕获时间、累计次数、个人最大长度与最大重量。1.3 增加四种颜色变体的发现状态，但不把颜色变体伪装成新的物种编号。

## 6. 完整鱼类图鉴与数值

表内长度和重量顺序均为“最小 / 典型 / 最大”。价格列是将该物种长度、重量资料上下界代入现行价格函数所得的保守理论包络，不保证真实随机样本能同时达到两项边界或每个中间价格。先对原色价值取整，再乘异色/纯金/炫彩倍率并再次取整；具体公式见第7章。表格描述当前新鱼，旧档固化价值和迁移例外见第13章。

${game.PACK_ORDER.map(fishCatalogSection).join('\n\n')}

## 7. 经济、仓库与商店系统

### 7.1 基准价值

\`baseValue = round(rarityBase × packMultiplier × speciesModifier)\`

- 稀有度基础价：普通 20、稀有 60、史诗 180、传说 600、神话 2400。
- 鱼包倍率：F1 1.00、F2 1.08、S1 1.16、S2 1.25。
- 物种微调：根据稳定鱼种 ID 生成 0.94–1.06 的小幅差异。
- 尺寸因子：长度/典型长度和重量/典型重量先各自限制在0.5–1.5，再计算0.65 + 0.20×长度比 + 0.15×重量比。代码外层保护为0.82–1.22，但受前述比例限制，实际算式只可能在0.825–1.175以内；具体物种还受自身资料范围限制。
- 1.3 颜色倍率：原色 1.0、异色 1.5、纯金 4.0、炫彩 8.0。

原色价值为round(baseValue×尺寸因子)，最终valueCoins为round(已取整原色价值×颜色倍率)，最低1金币。当前尺寸版本且已有合法valueCoins的鱼不因重新打开游戏而调价；旧尺寸版本修复及缺失价值的补全属于迁移例外，见第13章。F2/S1/S2售价为4000/6000/8000金币，按F1→F2→S1→S2永久解锁。金币来自出售鱼获，钓到鱼不会直接增加余额，特殊事件和成就点不发金币。

### 7.2 仓库

鱼获落船时自动创建唯一库存实例。默认按捕获时间倒序，也可按图鉴、稀有度、异色排序并切换正反方向；图鉴排序比较鱼包、稀有度、颜色、图鉴序号，不按尺寸从小到大排列。支持详情出售、右键出售和批量勾选确认；批量出售自动排除受保护鱼。已售鱼从仓库移除，图鉴和历史保留，不能重复出售。

每个物种首次获得的纯金、首次获得的炫彩分别自动锁定，玩家显式解锁后才能出售；后续同物种同颜色不重复自动锁定。普通鱼获也可手动锁定保护。

## 8. 概率系统与特殊事件

抽取顺序固定为：\`encounterType → packId → rarity → fishId → randomUnhook → variant → measurement → valueCoins\`。

### 8.1 顶层事件

- 概率V${probability.PROBABILITY_VERSION}每段均匀随机选择${probability.SPECIAL_INTERVAL_MIN}–${probability.SPECIAL_INTERVAL_MAX}次有效上钩间隔，平均间隔为5次，长期特殊事件率约${compact(probability.SPECIAL_RATE * 100)}%。例如间隔3表示“鱼、鱼、特殊”，正常序列不会连发，最多连续${probability.NON_SPECIAL_STREAK_LIMIT}次非特殊上钩；这不是每杆独立20%投骰。
- 计数依据上钩已经出现，不依据成功收取：鱼类随机脱钩仍计入非特殊次数；特殊事件上钩即开始下一段间隔，但收杆落船时才增加收藏和重复计数。30秒提醒结束不丢弃待收鱼/事件，也不会因此再抽一次。
- 下一段间隔在特殊事件出现时即保存，暂停、隐藏和重启不重抽。旧档保留已等次数，已等 6 次以上下一次有效上钩立即兑现；已有 pendingCatch 保留选定结果和原概率版本。
- 按长期20%计算，鱼类事件约80%；非首杆鱼类事件有${compact(probability.RANDOM_UNHOOK_RATE * 100)}%条件概率随机脱钩，上钩时已经选定，及时或晚收杆都不会改变它。
- 在资源正常、持续完成垂钓且忽略首杆有限影响的条件下，长期理论比例为特殊事件约20%、随机脱钩约0.8%、成功鱼获约79.2%；不代表短期每五杆严格兑现一次。
- 正常概率流程在缺少完整60项manifest或素材时关闭特殊事件，保留特殊间隔和重复计数；首杆教学分支仍计一次非特殊上钩。修复素材后重启以重新检查资源，不能假设当前进程会自动热加载。

### 8.2 鱼包、稀有度与物种

先确定是否特殊事件；普通鱼类分支中，同一水域的已解锁鱼包等概率抽取。只有两包均已解锁时，淡水F1/F2或咸水S1/S2才各50%；仅拥有一包时该包100%。选定鱼包后按70/20/7/2.5/0.5抽稀有度，再在该稀有度内等概率抽具体鱼种。首杆普通原色保底是独立例外。

### 8.3 颜色概率与全局保底

${table(['变体', '代码', '基础概率', '价值倍率', '软保底', '硬保底'], [
  ['原色', 'normal', `${compact(naturalVariantWeights.normal / totalVariantWeight * 100)}%`, `${variantMultipliers.normal}×`, '无', '无'],
  ['异色', 'alternate', `${compact(naturalVariantWeights.alternate / totalVariantWeight * 100)}%`, `${variantMultipliers.alternate}×`, '无', `第${hardPityAttempt('alternatePlusMisses', 1)}条保证异色或更高`],
  ['纯金', 'golden', `${compact(naturalVariantWeights.golden / totalVariantWeight * 100)}%`, `${variantMultipliers.golden}×`, `第${firstBoostAttempt('goldenPlusMisses', 'golden')}条开始有实际权重增加`, `第${hardPityAttempt('goldenPlusMisses', 2)}条保证纯金或更高`],
  ['炫彩', 'iridescent', `${compact(naturalVariantWeights.iridescent / totalVariantWeight * 100)}%`, `${variantMultipliers.iridescent}×`, `第${firstBoostAttempt('iridescentMisses', 'iridescent')}条开始有实际权重增加`, `第${hardPityAttempt('iridescentMisses', 3)}条保证炫彩`]
])}

表内基础概率是四种互斥颜色的自然权重，不包含软/硬保底；“异色或更高”自然合计12%，“纯金或更高”合计2%。软保底按此前连续未出目标等级的成功入库鱼计数：纯金公式在45次未中后增加权重；炫彩公式在180次未中后开始计算加成，但以整数基点取整，第186条候选才首次增加实际权重。以上“第N条”均指该保底周期内第N条将成功入库的鱼，不是游戏总抛竿次数。

保底在当前存档内跨鱼种、鱼包和水域累计，游戏没有账号系统。异色及以上重置异色保底，纯金及以上重置纯金保底，炫彩重置炫彩保底；特殊事件、随机脱钩和未收取的待收杆鱼获不增加或清空颜色保底。最终颜色等级只能被保底抬高，不能把自然抽中的更高等级降级。

### 8.4 特殊事件收藏与保底

当前版本包含漂流瓶30、科研标记10、生态守护20，共60项。所有条目都可在淡水或咸水发现。未发现条目权重100、已发现条目权重50；系列按其候选条目权重之和选择，不是三个系列各三分之一。全未发现时三个系列占特殊事件的50%/约16.67%/约33.33%，会随收藏变化。连续成功收取${probability.DUPLICATE_SPECIAL_STREAK_LIMIT}个重复内容后，若仍有未发现条目，下一次特殊事件强制选新内容；集齐后仍可重复获得。30秒后安静待收杆，落船时才收藏；事件不进入鱼类仓库、历史、图鉴、金币或颜色保底，但计入相关特殊收藏成就。

收藏首页保留三个系列原封面和唯一发现进度；系列详情逐行显示图标、标题、介绍、首次发现时间和次数，未发现内容隐藏文字并灰阶。60项内容引用34张256×256图案与34套1536×256六帧动作条；漂流瓶共享四类徽记图案，科研和生态逐项独立。所有结果卡显示10秒后自动隐藏，不代表撤销已经入库的收获。结果卡默认168×176 DIP，宽度为round(clamp(168×桌宠缩放,152,200))，高度按22:21取整；不是跟随桌宠在全范围同比放大。

${table(['ID', '系列', '名称', '内容'], specialEventRows)}

## 9. 异色与珍珠炫彩系统（1.3 已实现）

### 9.1 四个模板

- 原色：复用当前物种真源，保持身份和现实特征。
- 异色：物种专属的新配色，保护深色轮廓、眼睛、嘴部与识别性花纹。
- 纯金：通体金黄，但至少保留四档明暗和关键结构，不做单色剪影。
- 炫彩：银白珍珠底，粉、青、紫、桃橙与柔金在完整鱼身遮罩内流动，固定细节覆盖在动态层上方。

### 9.2 V2.2 珍珠基底与方案 B 正式结构层

152 种鱼继续使用 V2.2 银白珍珠 base、排除边界的鱼身 mask、淡雅粉/青/紫/桃橙/柔金、0.76/0.54/0.72 三层透明度、\`color/screen\` 混合模式、128 px 审查尺寸和 8.4/6.2/4.8 秒周期。经 10 鱼 A/B 审查后，用户选择方案 B 作为正式 details：最外边界统一为深黑蓝 \`#12151D\`，内部关键花纹逐像素保留原鱼 RGB。负起始延迟让页面打开时已经处于流动相位。完整 152 种动态样式总览位于 \`src/iridescent-gallery-v2.2.html\`。

### 9.3 动态实现

炫彩由银白底图、鱼身 mask、彩云层、反向光谱层、移动高光和方案 B 结构 overlay 组成。结构层不参与流光平移：边界保持深黑蓝，内部关键纹理保持原鱼颜色。当前只在图鉴、仓库、详情、鱼获卡和飞鱼动画中使用；仅可见卡片播放，滚出视口或窗口隐藏时暂停，系统要求减少动态时显示静态珍珠版本。不使用 WebGL 或常驻 Canvas 循环。

### 9.4 图鉴长体型适配

图鉴卡片尺寸保持不变。生成器按原始图标 alpha 内容边界计算宽高比，只通过等比 \`scale()\` 缩小卡片内部鱼图及其全部炫彩层：宽高比越大，缩放为 0.84、0.79、0.74 或 0.68；龙鱼按用户点名固定为 0.84。该规则不改写 PNG、不改变宽高比例，也不影响仓库、鱼获卡和空中动作。

## 10. 动画与美术系统

### 10.1 主体规范

- 轻俯拍完整主体：角色、船、鱼竿、鱼线、浮漂、钩饵共同逐帧设计，只有实际鱼获动态叠加。
- 逻辑画布 192×208，发布帧 384×416，最近邻缩放，禁止非等比拉伸。
- 动作切换必须等待图像解码完成后原子替换，不能出现透明空白帧。
- 正常待机与等待的眨眼按 8–15 秒随机调度，12% 双眨眼；闭眼帧不进入基础循环。

### 10.2 22 组主体动作

${table(['动作 ID', '帧数', '播放', '单帧 ms', '类型', '状态'], actionRows)}

合计 ${actionRows.length} 组、${actionRows.reduce((sum, row) => sum + Number(row[1]), 0)} 个时序帧。\`catch_land\` 第 2 帧是唯一的 \`catch_committed/result_card_show\` 结算点。

### 10.3 鱼类空中动作

每种鱼提供 256×64 横向动作条，含 4 个 64×64 姿态；运行时映射到 10 帧飞鱼轨迹，并逐帧让鱼的 \`hookAnchor\` 对齐主体 \`fishAnchor\`。动作族包括 flexible、deep_body、eel、ray、pulse、crustacean、amphibian、shell。

1.3 全量异色资产已保持同一鱼种的轮廓、锚点、朝向与动作节奏；炫彩空中鱼使用银白底、三层动态遮罩和细节覆盖，四帧与原动作逐姿态对齐。

## 11. 信息面板系统

- 首页：已发现物种、总捕获、最近收获三个统计；金币另置标题右上角，九个功能入口含角色库和玩法帮助。
- 图鉴：筛选和搜索在宽屏同排、窄屏换行；固定图标尺寸并自动换列；按包分区与稀有度排序；详情显示首次捕获和累计次数。
- 仓库：按可用宽度自动换列的鱼获实例，显示种类、稀有度、尺寸、价值和余额；支持排序、详情、右键和批量出售。
- 成就：一行一条，左侧高清图标、中间条件、右侧进度；固定字号和图标尺寸，支持系列/状态/搜索/排序、3项关注与补发摘要。
- 历史：每行一条，小鱼图在左，种类、稀有度、时间在右；详情显示尺寸、重量和价值。
- 商店：显示鱼包、价格、前置与水域；未满足条件时灰显并解释原因。
- 设置：静音、水泡声、置顶、开机启动、75%–135%桌宠大小、快捷键、正向秒表、导出/导入存档、恢复默认设置和退出；不保留“减少动态”和“紧急阶段提示”的游戏内开关。恢复默认设置不清空鱼获进度。默认静音开启、水泡声关闭、置顶开启、开机启动关闭。

## 12. 成就系统

${table(['ID', '名称', '条件', '目标值', '统计字段'], achievementRows)}

当前成就版本2，共${game.ACHIEVEMENTS.length}条、${game.ACHIEVEMENTS.reduce((sum, item) => sum + item.points, 0)}点、${game.ACHIEVEMENT_SERIES.length}个系列。界面逐行显示，不显示称号区；旧称号字段仅供兼容。${game.ACHIEVEMENTS.filter(item => item.retroactive === 'A').length}条可从累计状态回溯；${game.ACHIEVEMENTS.filter(item => item.retroactive === 'B').length}条小尺寸、出售和五物种窗口成就只采纳可信历史证据，历史缺失时继续积累。五物种窗口成就要求连续五条成功鱼获互不相同；特殊事件、脱钩、提前收杆、暂停和退出不清空成功鱼获序列。旧编号只属于设计档案，玩家按上表名称查找。

四角判定在每次抛竿时由主进程读取小船主体当前位置；横向范围为工作区宽度16%（160至320 DIP），纵向18%（140至240 DIP），均不超过对应边长25%。不必紧贴屏幕边缘，四角分别抛竿即可；详情显示各角落完成状态。

特殊收藏成就采用固定数量，后续扩展内容不涨门槛。旧尺寸版本先修复再补发；重复提交不重复发奖。成就点仅展示，不影响经济和概率。

## 13. 存档、迁移与可靠性

- Windows发布程序名为\`摸鱼搭子.exe\`；正式存档位于实际EXE同目录的\`user-data/screen-fishing-save.json\`，即使用户给EXE改名仍按所在目录定位。源码开发默认使用项目下\`.screen-fishing-dev/screen-fishing-save.json\`。每个程序目录独立保存进度、窗口设置、缓存和单实例锁；不同目录不共享进度。
- 新解压的程序目录不自动读取任何共享旧目录，因此不带 \`user-data\` 时会创建全新存档；复制其他副本的完整 \`user-data\` 可克隆进度，也可使用游戏内导入功能迁移旧 JSON。
- 重打包会暂存并恢复本机 \`user-data\`，但发布 ZIP 明确排除该目录，既不删除开发者存档，也不分发个人记录。
- 同目录临时文件写入、fsync、备份和原子 rename；主存档损坏时从备份恢复。
- 启动时区分无存档与读取异常：瞬时错误有限重试，备份恢复会保留好备份并隔离异常主档；主备均不可读时停止启动且禁止写入空白状态。
- 运行时以启动进度为下限阻止意外倒退覆盖；导入存档是唯一允许显式重设下限的路径。最近一次读取来源、尝试次数和进度摘要写入 \`userData/startup-save-diagnostics.json\`。
- 关闭窗口只隐藏到托盘时，再次启动 EXE 会通过 Electron 单实例事件与跨进程启动令牌双通道唤醒主实例；主实例同步重读不倒退的磁盘状态并刷新所有窗口，处理记录写入 \`launch-monitor-diagnostics.json\`。
- 当前 schema ${game.SAVE_SCHEMA_VERSION}，历史上限 ${game.HISTORY_LIMIT}。
- 暂停、隐藏和恢复会冻结并平移剩余计时，不制造离开惩罚。
- schema 8 已新增 probability/variant 版本、三层保底计数和逐形态图鉴统计；旧鱼获迁移为原色，旧 \`valueCoins\` 原样保留，不凭空解锁异色。
- schema 11 新增独立的 \`specialEventPity\` 与 \`specialEventCollection\`；旧档只做加法迁移，不改写鱼获、金币、历史或鱼类保底。

旧尺寸版本（measurementVersion低于5）修复是价值保留的例外：历史/库存会按当前物种资料恢复尺寸、重量，缺失价值或需要V5修复的条目会重新计算价值。不能承诺所有年代旧档的重量和valueCoins都逐字不变；钱包、收藏和已购鱼包按迁移规则保留。角色包和角色选择存于同一数据目录的characters及characters/selection.json，与主存档分开；跨目录保留全部数据时复制完整user-data，单独导入游戏JSON不能搬运自定义角色图片。

## 14. 声音、性能与隐私

声音默认关闭并静音，需同时启用水泡声和关闭静音才播放；响应抛竿、咬钩、出水、落船和稀有庆祝状态边沿。面板和结果卡关闭时隐藏并复用，面板首次使用时创建；不是空闲即销毁。图鉴等列表的炫彩仅在可见时播放，窗口隐藏/系统减少动态时暂停或使用静态外观。程序无需网络、账号或第三方遥测，也不读取其他窗口内容；skill下载游戏另需网络。

## 15. 桌面鱼缸系统（1.5.5 完成并封存）

当前 ${require('../package.json').version} 钓鱼核心版不启用或打包鱼缸窗口、鱼缸游动素材和装饰目录。以下内容作为完整设计与实现档案保留，恢复时以封存发布包和专项规格为准。

- 独立像素鱼缸窗口基准 \`512×288 DIP\`，支持 75%–125% 等比缩放、移动、置顶、锁定穿透、托盘和快捷键隐藏；首次显示不超过工作区 32%，任何时候不超过 40%，缩放不改变容量。
- 商店中的五种鱼缸款式可重复购买；每次购买创建独立的“鱼缸N”实例。每个实例分别保存款式、水域、鱼和布置，同一时刻桌面只显示活动鱼缸。
- 每个鱼缸可以在已解锁条件下切换淡水或咸水；不兼容鱼自动安全移回仓库，不出售、不删除。鱼缸引用仓库中的具体 \`inventoryId\`，同一条鱼不能跨缸重复展示，展示鱼不能被批量误售。
- 每缸同时限制 8 条鱼和 12 点体型负载；微型/小型/大型/巨型消耗 1/2/3/4 点，真实尺寸只决定视觉档，不按真实比例撑满窗口。
- 已完成 152/152 物种各 6 帧游动，共 912 条运行 sprite strip；八动作族共享帧合同，四种异色共享轮廓与时序，炫彩使用银白底、鱼身遮罩和 details overlay。
- 商店增加鱼缸款式、底砂、石材、水草、沉木、背景和轻效果；鱼缸款式按实例重复购买，其他装饰一次购买永久复用，只改变外观，不改变概率、价值或等待。
- 首版明确不含喂食、清洁、水质、疾病、死亡、繁育、自动钓鱼、离线衰减或被动金币。
- 每缸保存绑定款式、背景、底砂、轻效果与最多 8 个自由装饰；4 DIP 网格、50%–200% 连续装饰缩放、水平翻转、撤销/重做/恢复默认和原子保存均已接入。
- 鱼群最高 30 fps 更新位置、约 9 fps 切换六帧，支持三泳层、软分离、松散群游、暂停观察和底栖休息；方向只在减速至零后翻转，鱼头不会逆向滑行。鱼不再截获点击，整个鱼缸可左键拖动，右键菜单保留。
- 炫彩的 base、mask 与 details 共用同一动作帧，黑色细节不参与材质平移；只有珍珠色层缓慢流动。透明素材按 alpha 内容裁切，底砂固定贴合水体底边。
- 图鉴、仓库和鱼缸可放入库存共用捕获、图鉴、稀有度和异色四种正反排序，以及鱼包/稀有度/异色复选筛选和鱼名搜索。
- 装饰目录共 34 件：5 款鱼缸、6 款底砂、6 件石景、8 件水草/珊瑚、4 件沉木、3 款背景和 2 种轻效果；基础缸后续购买 600 金币，其余款式 800–1600 金币，装饰 80–700 金币，无属性加成。

完整规格：\`docs/plans/DEVELOPMENT_PLAN_1_5.md\`。市场依据：\`docs/research/AQUARIUM_GAME_MARKET_RESEARCH_2026-09-04.md\`。

## 16. 资源与发布门禁

下列是维护/发布时需要核对的范围，数量可由当前清单核实；“应通过”不是阅读或生成本百科时已执行了全部测试。具体版本的实测结果以对应审查报告为准。独立skill附带本文时，不自动附带所有游戏脚本或封存包。

- 主体：22/22 动作、152/152 帧、结算事件唯一、锚点合法。
- 鱼类：152/152 图标、152/152 动作条、608/608 空中帧、危险路径 0。
- 异色：152/152物种、608/608形态、1824个运行图层；应检查图标/空中alpha、遮罩边界、四帧非空和生成确定性。
- 概率：正式发布使用固定种子大样本验证特殊事件长期约20%、间隔3–7次及连续非特殊上限，同时验证鱼包、稀有度、脱钩、自然异色和保底边界；模拟次数与结论须在当次报告列明。
- 尺寸：152/152 物种资料、范围有效、随机样本不越界。
- 特殊事件发布要求：3/3原系列封面、60/60条目及图标/动作引用、34/34张256×256物件图与34/34套1536×256六帧动作条、随机脱钩图及readiness回退均应通过；具体执行结果以当前版本审查报告为准。
- 封存鱼缸：1.5.5 的 152/152 物种、912/912 动作条、34/34 商品透明素材、多实例、双容量、跨缸展示锁与布置目录校验均保留在封存包，不进入当前 Portable。
- 当前程序：静态检查、单元测试、三窗口 Electron package smoke、鱼缸入口/快捷键/API/发布资产排除和存档安全转换必须通过。
- 发布：portable 目录和 ZIP 文件清单、哈希、版本与实启验证。

维护项目常用命令：\`npm run check\`、\`npm test\`、\`npm run smoke\`、\`npm run validate:pet-assets\`、\`npm run validate:fish-assets\`、\`npm run validate:fish-variants\`、\`npm run validate:probability\`、\`node scripts/validate-fish-measurements.js\`、\`npm run validate:release\`。公开源码的package.json脚本集合较精简，以实际文件为准；便携游戏和独立skill用户无需执行这些维护命令。

## 17. 文档真源与维护规则

1. 正式钓鱼状态、时间、尺寸与经济行为以\`src/game-state-runtime.js\`及\`main.js\`为真源；\`src/game-state.js\`主要提供基础鱼类目录，其旧版状态/抽取函数不能作为当前正式规则。界面以\`src/panel.js\`、renderer/result和相关CSS为准，规则还应与测试交叉核对。
2. 鱼类身份与原色路径以 \`src/game-state.js\`、\`assets/fish/runtime-manifest.json\` 为真源；四模板路径、V2.2 珍珠参数、方案 B 结构层规则和图鉴等比缩放参数以 \`assets/fish/variants/manifest.json\` 为真源。
3. 尺寸以 \`data/fish-measurements.json\` 为真源，证据位于 \`docs/research/measurement-snapshots/\`。
4. 动作以 \`assets/pet/v1-runtime/action-manifest.json\` 为真源。
5. 鱼类概率和异色合同以 \`docs/specifications/probability/PROBABILITY_VARIANT_SYSTEM_SPEC_1_3.md\` 为设计真源；特殊事件内容以 \`docs/specifications/events/SPECIAL_EVENT_SYSTEM_DESIGN_DRAFT.md\` 为依据，当前触发与迁移合同以 \`docs/specifications/probability/SPECIAL_EVENT_PROBABILITY_SPEC_V3.md\` 为准；以 \`src/probability-system.js\`、\`src/special-events.js\`、\`src/fish-variants.js\`、事件 manifest 和验证报告为实现真源。
6. 1.5.5 鱼缸以 \`docs/plans/DEVELOPMENT_PLAN_1_5.md\` 为封存设计真源，以 \`release/archive/aquarium-1.5.5/\` 为可运行恢复点；1.6+ 钓鱼核心版通过 \`src/fishing-core.js\` 执行无损封存与展示锁释放。
7. 每次鱼表、尺寸、动作、成就或经济常量变化后运行 \`npm run docs:encyclopedia\` 并提交百科差异检查。
8. 历史报告不得覆盖当前代码事实；发生冲突时，应在百科中明确“当前/计划/废弃”状态。
`;

if (game.FISH.length !== 152) throw new Error(`Expected 152 fish, received ${game.FISH.length}`);
if (measurements.entries.length !== 152) throw new Error(`Expected 152 measurement profiles, received ${measurements.entries.length}`);
if (actionRows.length !== 22) throw new Error(`Expected 22 pet actions, received ${actionRows.length}`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${docs.trim()}\n`, 'utf8');
console.log(`game encyclopedia generated: ${path.relative(root, outputPath)}; fish=${game.FISH.length}; actions=${actionRows.length}; achievements=${achievementRows.length}`);
