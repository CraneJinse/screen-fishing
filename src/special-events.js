(function exposeSpecialEvents(globalScope) {
  'use strict';
  const groups = {
    drift_bottle: ['三分钟许可证','稳定的实验','会议纪要','午休公约','工位结界','保存成功','最终版本','灵感加载','今日待办','瓶子的投诉','鱼群差评','永远少一项','像素游鱼','漂流瓶更新说明','稀有度声明','考完以后','无名生日','热水提醒','留给明天','到点吃饭','看看远处','小小进步','小幸运','需求很简单','安装 Vibe','JSON 是谁','本地公开','红字证据','别问技术栈','群里的密钥'],
    research_salvage: ['断裂标记带','水温计探头','盐度棱镜','流速计叶片','压力计表盘','空样本瓶','浮游网圈','水下相机卡','防水野外笔记','研究站回邮牌'],
    eco_cleanup: ['瘪掉的塑料瓶','彩色瓶盖串','泡沫饭盒碎片','透明塑料袋','饮料吸管','缠成团的鱼线','断裂旧浮漂','破损假饵','空鱼饵袋','泡沫浮球碎块','生锈鱼钩盒','键盘按键','鼠标上盖','轮胎橡胶片','玻璃纤维碎片','沾泥工作手套','反光条碎片','油污抹布','黑水样本','水华样本']
  };
  const names = { drift_bottle: '漂流瓶', research_salvage: '科研标记', eco_cleanup: '生态守护' };
  const prefixes = { drift_bottle: 'DB', research_salvage: 'RS', eco_cleanup: 'EC' };
  const descriptions = {
    drift_bottle: ['持证人获准发呆三分钟。签发单位：水务摸鱼办。','第47次实验依旧失败。好消息是，失败得非常稳定。','会议结论：下次开会继续讨论，本次会议为何没有结论。','午休期间想起的工作，一律视为下午的工作。','只要手还放在键盘上，发呆就算思考。','已保存。保存了什么不重要，Ctrl+S会让人安心。','最终版_v2_真的最终版_这次绝对不改了.zip','我不是在摸鱼，我只是在等灵感加载到100%。','今日待办：1.写待办；2.奖励自己完成了第一项。','我是瓶子。纸条未经允许住进来很久了，请安排调解。','这里的鱼饵味道不错，但服务员总想把我们拉出水面。','购物清单：面包、牛奶、鱼饵，以及我忘记写下的那一样。','<°)))彡  <°)))彡  <°)))彡——它们游过纸面，只剩三串水印。','版本1.0：修复了瓶塞太紧。已知问题：瓶子仍然不会自己游泳。','这张纸本来十分稀有，直到你第二次捞到它。','等这场考试结束，我要去一个看得见水的地方，什么也不想。','今天可能是谁的生日。捡到的人，替我说一句生日快乐吧。','记得多喝热水。','今天做不完也没关系，明天的你并不是敌人。','到了饭点就去吃饭。世界不会因为你晚回十分钟消息就停转。','看一眼远处吧。你的眼睛也需要偶尔去岸边散步。','没人鼓掌的小进步，也是真的进步。','愿你今天遇到一个恰到好处的小幸运。','我不懂，你看着弄吧。直接输出完整代码。','怎么下载Vibe Coding啊？装好以后是不是就会写代码了？','JSON是谁？为什么每次报错都有他？','为什么我朋友打不开localhost:5173？我这里明明已经运行成功了。','报错都发给你了，截图里红字那么多，你看不到吗？','能不能别问我技术栈？我只想做一个简单的、功能完整的平台。','我把API Key发群里了，为什么大家都让我撤回？'],
    research_salvage: ['标记带已经自然断开，幸好没有缠住任何东西。','电子水温计的小探头，还停留在最后一次读数。','一块小小的检测棱镜，转动时会闪出淡蓝色光。','只有指甲大小的叶片，水流经过时本应轻轻转动。','玻璃已经裂开，但红色指针仍安静地停在原处。','洗得很干净的小瓶子，瓶盖上写着“待采样”。','微型采样网只剩下金属圆环，网布已经不见了。','一张防水存储卡，或许拍到过鱼从镜头前游过。','只剩一页能看清：今天的数据没有被风吹走。','小牌上印着一个地址，以及一句“感谢归还设备”。'],
    eco_cleanup: ['瓶身已经晒得发白，却仍然没有消失。','几只瓶盖被水草缠成一串，像一条很糟糕的项链。','轻飘飘的泡沫碎片，风一吹就可能再次回到水里。','湿透以后几乎看不见，但它并不属于这里。','一根褪色的吸管，在水里打了很多个转。','透明鱼线打成死结，差一点就看不见它。','颜色已经褪去一半，它曾经提醒过谁水下有动静。','亮片还会反光，但尾钩早已锈住。','袋子里面什么也没有，只有一股很顽固的腥味。','白色浮球裂成几块，表面布满细小咬痕。','铁盒锈得打不开，最好让它停在安全的地方。','一个孤零零的Esc键，终于成功逃离了键盘。','只剩半个鼠标外壳，在水里也点不开任何东西。','厚厚的黑色橡胶边缘，已经被水磨得很圆。','看起来像透明细丝，摸起来却一点也不柔软。','手套里灌满细沙，看起来比原来重了好几倍。','一小段银白反光材料，在水下仍会突然闪一下。','布料吸满了深色油渍，隔着袋子也显得沉甸甸。','瓶中的水颜色异常发暗，已经被贴上待检测标签。','绿色水样里漂着细小颗粒，需要进一步确认来源。']
  };
  descriptions.drift_bottle[5] += '看到这记得保存。';
  function bottleTheme(order) { return order <= 9 ? 'work' : order <= 15 ? 'waterside' : order <= 23 ? 'warmth' : 'vibe'; }
  function artPath(seriesId, order, animation = false) {
    const dir = seriesId === 'drift_bottle' ? 'drift-bottle' : seriesId === 'research_salvage' ? 'research-salvage' : 'eco-cleanup';
    const key = seriesId === 'drift_bottle' ? `bottle-${bottleTheme(order)}` : `${prefixes[seriesId]}-${String(order).padStart(3, '0')}`;
    return `assets/events/${dir}/${animation ? `animations/${key}-catch-strip` : key}.png`;
  }
  const REGISTRY = Object.freeze(Object.entries(groups).flatMap(([seriesId, titles]) => titles.map((title, index) => ({
    id: `${prefixes[seriesId]}-${String(index + 1).padStart(3, '0')}`, seriesId, seriesName: names[seriesId], order: index + 1,
    title, description: descriptions[seriesId][index], iconPath: artPath(seriesId, index + 1), animationPath: artPath(seriesId, index + 1, true),
    frameWidth: 256, frameHeight: 256, frameCount: 6, displaySize: 64, hookAnchor: { x: 128, y: 128 },
    ...(seriesId === 'drift_bottle' ? { bottleTheme: bottleTheme(index + 1) } : {}),
    enabled: true, habitats: ['freshwater', 'saltwater'], baseWeight: 100
  }))));
  function enabledFor(habitat, registry = REGISTRY) { return registry.filter((e) => e && e.enabled === true && (!Array.isArray(e.habitats) || e.habitats.includes(habitat)) && Number(e.baseWeight) > 0); }
  function byId(id, registry = REGISTRY) { return registry.find((event) => event.id === id) || null; }
  function animationPose(state, progress) {
    const t = Math.max(0, Math.min(0.999, Number(progress) || 0));
    if (state === 'reel_pull') return Math.floor(t * 2);
    if (state === 'catch_flight') return 2 + Math.floor(t * 3);
    if (state === 'catch_land') return t < 0.35 ? 4 : 5;
    return 5;
  }
  const MANIFEST = Object.freeze({ version: 1, enabled: true, entries: REGISTRY });
  let runtimeCache = null;
  function readiness(manifest = MANIFEST, registry = REGISTRY, fileExists = null) {
    if (!manifest || manifest.enabled !== true || !Array.isArray(manifest.entries) || manifest.entries.length !== 60 || registry.length !== 60) return { ready: false, reason: 'manifest-incomplete' };
    const packagedManifest = Object.hasOwn(manifest, 'specialEventsEnabled');
    if (packagedManifest && (manifest.specialEventsEnabled !== true || manifest.eventVersion !== 3 || manifest.probabilityVersion !== 3)) return { ready: false, reason: 'manifest-version' };
    if (packagedManifest && manifest.entries.some((entry) => entry.frameWidth !== 256 || entry.frameHeight !== 256 || entry.frameCount !== 6 || entry.displaySize !== 64)) return { ready: false, reason: 'animation-contract' };
    if (packagedManifest && (!Array.isArray(manifest.series) || manifest.series.length !== 3 || manifest.series.some((series) => !series.coverIcon))) return { ready: false, reason: 'series-incomplete' };
    const ids = new Set(registry.map((e) => e.id));
    if (manifest.entries.some((e) => !ids.has(e.id) || e.enabled !== true || !(e.iconPath || e.icon) || !(e.animationPath || e.catchAnimation))) return { ready: false, reason: 'manifest-mismatch' };
    if (manifest.entries.some((e) => { const source = registry.find((x) => x.id === e.id); return !source || source.iconPath !== `assets/events/${e.icon}` || source.animationPath !== `assets/events/${e.catchAnimation}`; })) return { ready: false, reason: 'path-mismatch' };
    if (typeof fileExists === 'function' && registry.some((e) => !fileExists(e.iconPath) || !fileExists(e.animationPath))) return { ready: false, reason: 'asset-missing' };
    if (packagedManifest && typeof fileExists === 'function' && (manifest.series.some((series) => !fileExists(`assets/events/${series.coverIcon}`)) || !manifest.escapePattern || !fileExists(`assets/events/${manifest.escapePattern}`))) return { ready: false, reason: 'support-asset-missing' };
    return { ready: true, reason: 'ok' };
  }
  function runtimeRegistry() {
    if (typeof module === 'undefined' || !module.exports) return REGISTRY;
    if (runtimeCache !== null) return runtimeCache;
    const fs = require('node:fs'); const path = require('node:path');
    const root = path.resolve(__dirname, '..'); const manifestPath = path.join(root, 'assets/events/event-manifest.json');
    if (!fs.existsSync(manifestPath)) return (runtimeCache = []);
    let manifest; try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { return (runtimeCache = []); }
    const check = (p) => fs.existsSync(path.join(root, p));
    runtimeCache = readiness(manifest, REGISTRY, check).ready ? REGISTRY.map((event) => {
      const entry = manifest.entries.find((item) => item.id === event.id);
      return Object.freeze({ ...event, frameWidth: entry.frameWidth, frameHeight: entry.frameHeight,
        frameCount: entry.frameCount, displaySize: entry.displaySize, hookAnchor: entry.hookAnchor,
        iconPath: `assets/events/${entry.icon}`, animationPath: `assets/events/${entry.catchAnimation}` });
    }) : [];
    return runtimeCache;
  }
  const api = { SERIES: Object.freeze(Object.entries(groups).map(([id, items]) => Object.freeze({ id, name: names[id], count: items.length }))), MANIFEST, REGISTRY, enabledFor, byId, animationPose, readiness, runtimeRegistry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; globalScope.PondSpecialEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
