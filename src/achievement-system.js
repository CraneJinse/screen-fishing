(function exposeAchievements(globalScope) {
  'use strict';
  const ACHIEVEMENTS = Object.freeze([
  {
    "id": "first-cast",
    "number": 1,
    "name": "第一竿",
    "description": "完成第一次抛竿",
    "target": 1,
    "stat": "castCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/first-cast.png"
  },
  {
    "id": "first-catch",
    "number": 2,
    "name": "初次相遇",
    "description": "成功钓到第一条鱼",
    "target": 1,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/first-catch.png"
  },
  {
    "id": "ten-catches",
    "number": 3,
    "name": "小有收获",
    "description": "累计成功钓到10条鱼",
    "target": 10,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/ten-catches.png"
  },
  {
    "id": "catches-25",
    "number": 4,
    "name": "鱼篓渐满",
    "description": "累计成功钓到25条鱼",
    "target": 25,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-25.png"
  },
  {
    "id": "catches-50",
    "number": 5,
    "name": "水边常客",
    "description": "累计成功钓到50条鱼",
    "target": 50,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-50.png"
  },
  {
    "id": "hundred-catches",
    "number": 6,
    "name": "老练钓手",
    "description": "累计成功钓到100条鱼",
    "target": 100,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/hundred-catches.png"
  },
  {
    "id": "catches-250",
    "number": 7,
    "name": "一篓又一篓",
    "description": "累计成功钓到250条鱼",
    "target": 250,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-250.png"
  },
  {
    "id": "catches-500",
    "number": 8,
    "name": "五百次相遇",
    "description": "累计成功钓到500条鱼",
    "target": 500,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-500.png"
  },
  {
    "id": "catches-1000",
    "number": 9,
    "name": "千尾故事",
    "description": "累计成功钓到1000条鱼",
    "target": 1000,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-1000.png"
  },
  {
    "id": "catches-2000",
    "number": 10,
    "name": "长长的鱼获簿",
    "description": "累计成功钓到2000条鱼",
    "target": 2000,
    "stat": "totalCatchCount",
    "seriesId": 1,
    "seriesName": "水边起步",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/catches-2000.png"
  },
  {
    "id": "species-5",
    "number": 11,
    "name": "认个脸熟",
    "description": "发现5种鱼",
    "target": 5,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/species-5.png"
  },
  {
    "id": "species-10",
    "number": 12,
    "name": "十位水下邻居",
    "description": "发现10种鱼",
    "target": 10,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/species-10.png"
  },
  {
    "id": "unique-25",
    "number": 13,
    "name": "水域观察员",
    "description": "发现25种鱼",
    "target": 25,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/unique-25.png"
  },
  {
    "id": "species-50",
    "number": 14,
    "name": "图鉴渐厚",
    "description": "发现50种鱼",
    "target": 50,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/species-50.png"
  },
  {
    "id": "unique-76",
    "number": 15,
    "name": "半部图鉴",
    "description": "发现76种鱼",
    "target": 76,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/unique-76.png"
  },
  {
    "id": "species-100",
    "number": 16,
    "name": "百种相识",
    "description": "发现100种鱼",
    "target": 100,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/species-100.png"
  },
  {
    "id": "species-125",
    "number": 17,
    "name": "最后几页",
    "description": "发现125种鱼",
    "target": 125,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/species-125.png"
  },
  {
    "id": "all-species",
    "number": 18,
    "name": "水世界博物志",
    "description": "发现当前四包全部152种鱼",
    "target": 152,
    "stat": "uniqueSpeciesCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/all-species.png"
  },
  {
    "id": "one-species-10",
    "number": 19,
    "name": "老朋友又来了",
    "description": "同一物种累计成功钓到10条，颜色不限",
    "target": 10,
    "stat": "maxSpeciesCatchCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/one-species-10.png"
  },
  {
    "id": "one-species-30",
    "number": 20,
    "name": "熟客专座",
    "description": "同一物种累计成功钓到30条，颜色不限",
    "target": 30,
    "stat": "maxSpeciesCatchCount",
    "seriesId": 2,
    "seriesName": "鱼类图鉴",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/one-species-30.png"
  },
  {
    "id": "rare",
    "number": 21,
    "name": "稀有邂逅",
    "description": "首次钓到稀有鱼",
    "target": 1,
    "stat": "rarity.rare",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/rare.png"
  },
  {
    "id": "epic",
    "number": 22,
    "name": "史诗发现",
    "description": "首次钓到史诗鱼",
    "target": 1,
    "stat": "rarity.epic",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/epic.png"
  },
  {
    "id": "legendary",
    "number": 23,
    "name": "传说时刻",
    "description": "首次钓到传说鱼",
    "target": 1,
    "stat": "rarity.legendary",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/legendary.png"
  },
  {
    "id": "mythic",
    "number": 24,
    "name": "神话现身",
    "description": "首次钓到神话鱼",
    "target": 1,
    "stat": "rarity.mythic",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/mythic.png"
  },
  {
    "id": "rare-25",
    "number": 25,
    "name": "蓝色常客",
    "description": "累计钓到25条稀有鱼",
    "target": 25,
    "stat": "rarity.rare",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/rare-25.png"
  },
  {
    "id": "epic-10",
    "number": 26,
    "name": "紫光常在",
    "description": "累计钓到10条史诗鱼",
    "target": 10,
    "stat": "rarity.epic",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/epic-10.png"
  },
  {
    "id": "legendary-5",
    "number": 27,
    "name": "金色传闻",
    "description": "累计钓到5条传说鱼",
    "target": 5,
    "stat": "rarity.legendary",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/legendary-5.png"
  },
  {
    "id": "mythic-3",
    "number": 28,
    "name": "神话再临",
    "description": "累计钓到3条神话鱼，可以同种",
    "target": 3,
    "stat": "rarity.mythic",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/mythic-3.png"
  },
  {
    "id": "all-rarities",
    "number": 29,
    "name": "五色阶梯",
    "description": "普通、稀有、史诗、传说、神话各钓到至少1条",
    "target": 5,
    "stat": "raritiesDiscovered",
    "seriesId": 3,
    "seriesName": "稀有邂逅",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/all-rarities.png"
  },
  {
    "id": "pack-f1-complete",
    "number": 32,
    "name": "溪流博物志",
    "description": "发现淡水鱼包一全部38种鱼",
    "target": 38,
    "stat": "packUnique.F1",
    "seriesId": 4,
    "seriesName": "四水游记",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/pack-f1-complete.png"
  },
  {
    "id": "pack-f2-complete",
    "number": 34,
    "name": "湖泊博物志",
    "description": "发现淡水鱼包二全部38种鱼",
    "target": 38,
    "stat": "packUnique.F2",
    "seriesId": 4,
    "seriesName": "四水游记",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/pack-f2-complete.png"
  },
  {
    "id": "pack-s1-complete",
    "number": 36,
    "name": "近海博物志",
    "description": "发现咸水鱼包一全部38种鱼",
    "target": 38,
    "stat": "packUnique.S1",
    "seriesId": 4,
    "seriesName": "四水游记",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/pack-s1-complete.png"
  },
  {
    "id": "pack-s2-complete",
    "number": 38,
    "name": "远洋博物志",
    "description": "发现咸水鱼包二全部38种鱼",
    "target": 38,
    "stat": "packUnique.S2",
    "seriesId": 4,
    "seriesName": "四水游记",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/pack-s2-complete.png"
  },
  {
    "id": "first-alternate",
    "number": 41,
    "name": "换一身颜色",
    "description": "首次钓到异色鱼",
    "target": 1,
    "stat": "variantCatchCount.alternate",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/first-alternate.png"
  },
  {
    "id": "first-golden",
    "number": 42,
    "name": "鱼身镀金",
    "description": "首次钓到纯金鱼",
    "target": 1,
    "stat": "variantCatchCount.golden",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/first-golden.png"
  },
  {
    "id": "first-iridescent",
    "number": 43,
    "name": "流动的虹光",
    "description": "首次钓到炫彩鱼",
    "target": 1,
    "stat": "variantCatchCount.iridescent",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/first-iridescent.png"
  },
  {
    "id": "alternate-species-10",
    "number": 44,
    "name": "异色画册",
    "description": "发现10种鱼的异色形态",
    "target": 10,
    "stat": "variantSpeciesCount.alternate",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/alternate-species-10.png"
  },
  {
    "id": "golden-species-5",
    "number": 45,
    "name": "五尾金光",
    "description": "发现5种鱼的纯金形态",
    "target": 5,
    "stat": "variantSpeciesCount.golden",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/golden-species-5.png"
  },
  {
    "id": "iridescent-species-3",
    "number": 46,
    "name": "三道虹影",
    "description": "发现3种鱼的炫彩形态",
    "target": 3,
    "stat": "variantSpeciesCount.iridescent",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/iridescent-species-3.png"
  },
  {
    "id": "one-species-two-variants",
    "number": 47,
    "name": "一鱼两色",
    "description": "同一物种收集任意2种颜色形态",
    "target": 2,
    "stat": "maxVariantsPerSpecies",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/one-species-two-variants.png"
  },
  {
    "id": "one-species-three-variants",
    "number": 48,
    "name": "一鱼三色",
    "description": "同一物种收集任意3种颜色形态",
    "target": 3,
    "stat": "maxVariantsPerSpecies",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/one-species-three-variants.png"
  },
  {
    "id": "one-species-four-variants",
    "number": 49,
    "name": "四色全貌",
    "description": "同一物种集齐原色、异色、纯金、炫彩",
    "target": 4,
    "stat": "maxVariantsPerSpecies",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/one-species-four-variants.png"
  },
  {
    "id": "variant-pairs-200",
    "number": 50,
    "name": "两百张彩色名片",
    "description": "累计收集200个不同的物种与颜色组合",
    "target": 200,
    "stat": "speciesVariantPairs",
    "seriesId": 5,
    "seriesName": "异色收藏",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/variant-pairs-200.png"
  },
  {
    "id": "length-50",
    "number": 51,
    "name": "半米惊喜",
    "description": "钓到长度至少50cm的鱼",
    "target": 50,
    "stat": "largestLengthCm",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/length-50.png"
  },
  {
    "id": "length-record",
    "number": 52,
    "name": "一米大物",
    "description": "钓到长度至少100cm的鱼",
    "target": 100,
    "stat": "largestLengthCm",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/length-record.png"
  },
  {
    "id": "length-200",
    "number": 53,
    "name": "两米身影",
    "description": "钓到长度至少200cm的鱼",
    "target": 200,
    "stat": "largestLengthCm",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/length-200.png"
  },
  {
    "id": "weight-1",
    "number": 54,
    "name": "一公斤的分量",
    "description": "钓到重量至少1kg的鱼",
    "target": 1,
    "stat": "largestWeightKg",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/weight-1.png"
  },
  {
    "id": "weight-record",
    "number": 55,
    "name": "十公斤级",
    "description": "钓到重量至少10kg的鱼",
    "target": 10,
    "stat": "largestWeightKg",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/weight-record.png"
  },
  {
    "id": "weight-50",
    "number": 56,
    "name": "沉甸甸的大物",
    "description": "钓到重量至少50kg的鱼",
    "target": 50,
    "stat": "largestWeightKg",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/weight-50.png"
  },
  {
    "id": "length-at-most-5",
    "number": 57,
    "name": "掌心小客",
    "description": "钓到长度不超过5cm的鱼",
    "target": 1,
    "stat": "smallLengthCatchCount",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 10,
    "tier": 2,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/length-at-most-5.png"
  },
  {
    "id": "weight-at-most-10g",
    "number": 58,
    "name": "轻如一片叶",
    "description": "钓到重量不超过10g的鱼",
    "target": 1,
    "stat": "smallWeightCatchCount",
    "seriesId": 6,
    "seriesName": "尺寸与纪录",
    "points": 10,
    "tier": 2,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/weight-at-most-10g.png"
  },
  {
    "id": "bottles-1",
    "number": 61,
    "name": "水上来信",
    "description": "收藏第一条不同内容的漂流瓶",
    "target": 1,
    "stat": "specialUnique.drift_bottle",
    "seriesId": 7,
    "seriesName": "漂流来信",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/bottles-1.png"
  },
  {
    "id": "bottles-10",
    "number": 63,
    "name": "信件一小叠",
    "description": "收藏10条不同内容的漂流瓶",
    "target": 10,
    "stat": "specialUnique.drift_bottle",
    "seriesId": 7,
    "seriesName": "漂流来信",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/bottles-10.png"
  },
  {
    "id": "bottles-30",
    "number": 65,
    "name": "三十封水上来信",
    "description": "收藏30条不同内容的漂流瓶",
    "target": 30,
    "stat": "specialUnique.drift_bottle",
    "seriesId": 7,
    "seriesName": "漂流来信",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/bottles-30.png"
  },
  {
    "id": "research-1",
    "number": 71,
    "name": "研究站的线索",
    "description": "收藏第一种科研标记",
    "target": 1,
    "stat": "specialUnique.research_salvage",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/research-1.png"
  },
  {
    "id": "research-10",
    "number": 73,
    "name": "研究站回收档案",
    "description": "收藏10种不同的科研标记",
    "target": 10,
    "stat": "specialUnique.research_salvage",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/research-10.png"
  },
  {
    "id": "eco-1",
    "number": 74,
    "name": "捞起一点改变",
    "description": "收藏第一种生态守护事件",
    "target": 1,
    "stat": "specialUnique.eco_cleanup",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/eco-1.png"
  },
  {
    "id": "eco-10",
    "number": 76,
    "name": "守护记录",
    "description": "收藏10种不同的生态守护事件",
    "target": 10,
    "stat": "specialUnique.eco_cleanup",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/eco-10.png"
  },
  {
    "id": "eco-20",
    "number": 77,
    "name": "守护档案集",
    "description": "收藏20种不同的生态守护事件",
    "target": 20,
    "stat": "specialUnique.eco_cleanup",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 40,
    "tier": 4,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/eco-20.png"
  },
  {
    "id": "special-30",
    "number": 79,
    "name": "三十段水边见闻",
    "description": "收藏任意30种不同特殊事件",
    "target": 30,
    "stat": "specialUniqueTotal",
    "seriesId": 8,
    "seriesName": "科研与守护",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/special-30.png"
  },
  {
    "id": "sale-first",
    "number": 81,
    "name": "第一笔鱼钱",
    "description": "成功出售第一条鱼",
    "target": 1,
    "stat": "soldFishCount",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 5,
    "tier": 1,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/sale-first.png"
  },
  {
    "id": "sale-10",
    "number": 82,
    "name": "鱼市熟面孔",
    "description": "累计成功出售10条鱼",
    "target": 10,
    "stat": "soldFishCount",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 5,
    "tier": 1,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/sale-10.png"
  },
  {
    "id": "sale-100",
    "number": 83,
    "name": "百尾流转",
    "description": "累计成功出售100条鱼",
    "target": 100,
    "stat": "soldFishCount",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 10,
    "tier": 2,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/sale-100.png"
  },
  {
    "id": "earned-1000",
    "number": 84,
    "name": "第一只钱袋",
    "description": "钱包累计收入达到1000金币",
    "target": 1000,
    "stat": "wallet.totalEarned",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 5,
    "tier": 1,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/earned-1000.png"
  },
  {
    "id": "earned-10000",
    "number": 85,
    "name": "万金小账本",
    "description": "钱包累计收入达到10000金币",
    "target": 10000,
    "stat": "wallet.totalEarned",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/earned-10000.png"
  },
  {
    "id": "earned-50000",
    "number": 86,
    "name": "鼓鼓的账本",
    "description": "钱包累计收入达到50000金币",
    "target": 50000,
    "stat": "wallet.totalEarned",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/earned-50000.png"
  },
  {
    "id": "own-f2",
    "number": 87,
    "name": "向湖泊出发",
    "description": "拥有淡水鱼包二F2",
    "target": 1,
    "stat": "ownedPack.F2",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/own-f2.png"
  },
  {
    "id": "own-s1",
    "number": 88,
    "name": "第一次看海",
    "description": "拥有咸水鱼包一S1",
    "target": 1,
    "stat": "ownedPack.S1",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/own-s1.png"
  },
  {
    "id": "own-s2",
    "number": 89,
    "name": "远洋通行证",
    "description": "拥有咸水鱼包二S2",
    "target": 1,
    "stat": "ownedPack.S2",
    "seriesId": 9,
    "seriesName": "鱼市与珍藏",
    "points": 20,
    "tier": 3,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/own-s2.png"
  },
  {
    "id": "corners",
    "number": 91,
    "name": "屏幕四角",
    "description": "在屏幕四个角落附近分别抛竿一次",
    "target": 4,
    "stat": "cornerCount",
    "seriesId": 10,
    "seriesName": "自在漫游",
    "points": 10,
    "tier": 2,
    "retroactive": "A",
    "iconPath": "assets/ui/achievements-v2/corners.png"
  },
  {
    "id": "five-unique-window",
    "number": 93,
    "name": "五位不同的朋友",
    "description": "连续5次成功鱼获为5个互不相同的物种",
    "target": 5,
    "stat": "bestUniqueFiveWindow",
    "seriesId": 10,
    "seriesName": "自在漫游",
    "points": 10,
    "tier": 2,
    "retroactive": "B",
    "iconPath": "assets/ui/achievements-v2/five-unique-window.png"
  }
].map(Object.freeze));
  const ACHIEVEMENT_SERIES = Object.freeze([
  {
    "id": 1,
    "name": "水边起步",
    "title": "水边常客",
    "achievementIds": [
      "first-cast",
      "first-catch",
      "ten-catches",
      "catches-25",
      "catches-50",
      "hundred-catches",
      "catches-250",
      "catches-500",
      "catches-1000",
      "catches-2000"
    ]
  },
  {
    "id": 2,
    "name": "鱼类图鉴",
    "title": "图鉴收藏家",
    "achievementIds": [
      "species-5",
      "species-10",
      "unique-25",
      "species-50",
      "unique-76",
      "species-100",
      "species-125",
      "all-species",
      "one-species-10",
      "one-species-30"
    ]
  },
  {
    "id": 3,
    "name": "稀有邂逅",
    "title": "珍鱼见证者",
    "achievementIds": [
      "rare",
      "epic",
      "legendary",
      "mythic",
      "rare-25",
      "epic-10",
      "legendary-5",
      "mythic-3",
      "all-rarities"
    ]
  },
  {
    "id": 4,
    "name": "四水游记",
    "title": "四水旅行家",
    "achievementIds": [
      "pack-f1-complete",
      "pack-f2-complete",
      "pack-s1-complete",
      "pack-s2-complete"
    ]
  },
  {
    "id": 5,
    "name": "异色收藏",
    "title": "虹光收藏家",
    "achievementIds": [
      "first-alternate",
      "first-golden",
      "first-iridescent",
      "alternate-species-10",
      "golden-species-5",
      "iridescent-species-3",
      "one-species-two-variants",
      "one-species-three-variants",
      "one-species-four-variants",
      "variant-pairs-200"
    ]
  },
  {
    "id": 6,
    "name": "尺寸与纪录",
    "title": "大小都喜欢",
    "achievementIds": [
      "length-50",
      "length-record",
      "length-200",
      "weight-1",
      "weight-record",
      "weight-50",
      "length-at-most-5",
      "weight-at-most-10g"
    ]
  },
  {
    "id": 7,
    "name": "漂流来信",
    "title": "水上收信人",
    "achievementIds": [
      "bottles-1",
      "bottles-10",
      "bottles-30"
    ]
  },
  {
    "id": 8,
    "name": "科研与守护",
    "title": "水边档案员",
    "achievementIds": [
      "research-1",
      "research-10",
      "eco-1",
      "eco-10",
      "eco-20",
      "special-30"
    ]
  },
  {
    "id": 9,
    "name": "鱼市与珍藏",
    "title": "小小收藏家",
    "achievementIds": [
      "sale-first",
      "sale-10",
      "sale-100",
      "earned-1000",
      "earned-10000",
      "earned-50000",
      "own-f2",
      "own-s1",
      "own-s2"
    ]
  },
  {
    "id": 10,
    "name": "自在漫游",
    "title": "水边漫游者",
    "achievementIds": [
      "corners",
      "five-unique-window"
    ]
  }
].map(Object.freeze));

  // Frozen 1.9.0 membership: future packs must not move existing completion targets.
  const BASE_PACK_IDS = Object.freeze({"F1":["fish-1","fish-2","fish-3","fish-4","fish-5","fish-6","fish-7","fish-10","fish-11","fish-12","fish-13","fish-14","fish-15","fish-17","fish-18","fish-19","fish-20","fish-23","fish-24","fish-25","fish-26","fish-39","fish-40","fish-46","fish-47","fish-50","fish-131","fish-132","fish-133","fish-134","fish-135","fish-136","fish-138","fish-142","fish-145","fish-148","fish-151","fish-153"],"F2":["fish-8","fish-9","fish-16","fish-21","fish-22","fish-27","fish-28","fish-29","fish-30","fish-31","fish-32","fish-33","fish-34","fish-35","fish-36","fish-37","fish-38","fish-41","fish-42","fish-44","fish-45","fish-48","fish-49","fish-51","fish-52","fish-137","fish-139","fish-140","fish-141","fish-143","fish-144","fish-146","fish-147","fish-149","fish-150","fish-152","fish-154","fish-155"],"S1":["fish-53","fish-54","fish-55","fish-56","fish-57","fish-58","fish-60","fish-61","fish-63","fish-64","fish-65","fish-66","fish-67","fish-68","fish-69","fish-71","fish-72","fish-73","fish-76","fish-77","fish-78","fish-80","fish-82","fish-83","fish-85","fish-86","fish-92","fish-94","fish-101","fish-117","fish-157","fish-162","fish-168","fish-171","fish-176","fish-177","fish-178","fish-180"],"S2":["fish-62","fish-70","fish-79","fish-81","fish-84","fish-91","fish-93","fish-95","fish-97","fish-98","fish-100","fish-102","fish-103","fish-104","fish-105","fish-106","fish-107","fish-108","fish-109","fish-110","fish-111","fish-112","fish-113","fish-115","fish-116","fish-118","fish-120","fish-121","fish-122","fish-123","fish-124","fish-125","fish-126","fish-127","fish-128","fish-160","fish-164","fish-166"]});
  const VERSION = 2;
  const CORNERS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  const CORNER_NAMES = ['左上', '右上', '左下', '右下'];
  const VARIANTS = ['normal', 'alternate', 'golden', 'iridescent'];
  const definitions = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
  let fishRegistry = [], eventRegistry = [];
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  function configure(fish, events) { fishRegistry = fish || []; eventRegistry = events || []; }
  function createData() { return { version: VERSION, soldFishCount: 0, smallLengthCatchCount: 0, smallWeightCatchCount: 0, recentFishIds: [], bestUniqueFiveWindow: 0, partialHistory: false, pendingMeasurements: false, committedSpecialIds: [] }; }
  function recordFish(data, entry) {
    const next = { ...createData(), ...data, recentFishIds: [...(data?.recentFishIds || []), entry.resultId || entry.fishId].slice(-5) };
    next.bestUniqueFiveWindow = Math.max(number(next.bestUniqueFiveWindow), new Set(next.recentFishIds).size);
    if (positive(entry.lengthCm) && Number(entry.lengthCm) <= 5) next.smallLengthCatchCount = 1;
    if (positive(entry.weightKg) && Number(entry.weightKg) <= .01) next.smallWeightCatchCount = 1;
    return next;
  }
  function migrate(state, original, now) {
    const source = original || state;
    const known = new Set(fishRegistry.map(f => f.id));
    const migrated = source.achievementData?.version === VERSION;
    let data = createData();
    if (migrated) {
      for (const key of ['soldFishCount', 'smallLengthCatchCount', 'smallWeightCatchCount', 'bestUniqueFiveWindow']) data[key] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number(source.achievementData[key])));
      data.recentFishIds = (Array.isArray(source.achievementData.recentFishIds) ? source.achievementData.recentFishIds : []).filter(id => known.has(id)).slice(-5);
      data.bestUniqueFiveWindow = Math.min(5, data.bestUniqueFiveWindow);
      data.partialHistory = Boolean(source.achievementData.partialHistory);
      data.pendingMeasurements = Boolean(source.achievementData.pendingMeasurements);
      data.committedSpecialIds = [...new Set(Array.isArray(source.achievementData.committedSpecialIds) ? source.achievementData.committedSpecialIds : [])].filter(id => typeof id === 'string').slice(-128);
    } else {
      // Only explicit measurements and transaction evidence qualify. Normalizers
      // may supply display defaults, which must never manufacture old awards.
      const history = Array.isArray(source.history) ? source.history : [];
      const seen = new Set();
      for (const item of [...history].reverse()) {
        if (item?.type && item.type !== 'fish') continue;
        const id = item?.resultId || item?.fishId;
        if (!known.has(id) || !item?.catchId) { data.recentFishIds = []; continue; }
        if (seen.has(item.catchId)) continue;
        seen.add(item.catchId);
        data = recordFish(data, { ...item, resultId: id });
        if (item.soldAt !== null && item.soldAt !== undefined && Number.isFinite(Number(item.soldAt)) && Number(item.soldAt) >= 0) data.soldFishCount++;
      }
      for (const item of Array.isArray(source.inventory) ? source.inventory : []) {
        if (!known.has(item?.fishId || item?.resultId) || !item?.catchId || seen.has(item.catchId)) continue;
        if (positive(item.lengthCm) && Number(item.lengthCm) <= 5) data.smallLengthCatchCount = 1;
        if (positive(item.weightKg) && Number(item.weightKg) <= .01) data.smallWeightCatchCount = 1;
        seen.add(item.catchId);
      }
      data.partialHistory = number(state.stats?.totalCatchCount) > history.length;
      data.pendingMeasurements = number(source.measurementVersion) < 5 && (history.length > 0 || number(state.stats?.totalCatchCount) > 0);
      if (data.pendingMeasurements) { data.smallLengthCatchCount = 0; data.smallWeightCatchCount = 0; }
    }
    const existing = [...new Set(Array.isArray(source.achievements) ? source.achievements : [])];
    const archive = { ...(source.achievementArchive || {}) };
    for (const id of existing) if (!definitions.has(id)) archive[id] = archive[id] || { id, unlockedAt: source.achievementTimes?.[id] ?? null, source: 'legacy' };
    const metadata = { ...(source.achievementMetadata || {}) };
    for (const id of existing.filter(id => definitions.has(id))) if (!metadata[id]) metadata[id] = { source: 'legacy', pointsAtUnlock: definitions.get(id).points };
    return { ...state, achievementData: data, achievementVersion: VERSION, achievementMigratedAt: source.achievementMigratedAt ?? now, achievementArchive: archive, achievementMetadata: metadata,
      achievementTracking: [...new Set(Array.isArray(source.achievementTracking) ? source.achievementTracking : [])].filter(id => definitions.has(id)).slice(0, 3),
      achievementTitleId: ACHIEVEMENT_SERIES.some(s => String(s.id) === String(source.achievementTitleId)) ? String(source.achievementTitleId) : '',
      achievementNotice: source.achievementNotice && Array.isArray(source.achievementNotice.ids) ? { ...source.achievementNotice, ids: source.achievementNotice.ids.filter(id => definitions.has(id)) } : null,
      achievementTitles: Array.isArray(source.achievementTitles) ? source.achievementTitles.filter(id => ACHIEVEMENT_SERIES.some(s => String(s.id) === String(id))).map(String) : [],
      achievements: existing.filter(id => definitions.has(id)), _achievementMigration: !migrated };
  }
  function metrics(state) {
    const stats = state.stats || {}, collection = state.collection || {};
    const records = fishRegistry.filter(f => number(collection[f.id]?.count) > 0).map(f => ({ fish: f, record: collection[f.id] }));
    const result = { ...stats, castCount: number(state.castCount), cornerCount: CORNERS.filter(id => Object.hasOwn(state.cornerCasts || {}, id)).length,
      maxSpeciesCatchCount: Math.max(0, ...records.map(x => number(x.record.count))),
      raritiesDiscovered: ['common','rare','epic','legendary','mythic'].filter(r => number(stats.rarity?.[r]) > 0).length,
      maxVariantsPerSpecies: 0, speciesVariantPairs: 0, specialUniqueTotal: 0, ...state.achievementData };
    for (const rarity of ['common','rare','epic','legendary','mythic']) result[`rarity.${rarity}`] = number(stats.rarity?.[rarity]);
    for (const pack of ['F1','F2','S1','S2']) {
      result[`packUnique.${pack}`] = BASE_PACK_IDS[pack].filter(id => number(collection[id]?.count) > 0).length;
      result[`ownedPack.${pack}`] = state.ownedPacks?.includes(pack) ? 1 : 0;
    }
    for (const v of VARIANTS) { result[`variantCatchCount.${v}`] = 0; result[`variantSpeciesCount.${v}`] = 0; }
    for (const { record } of records) {
      let count = 0;
      for (const v of VARIANTS) {
        const catches = number(record.variants?.[v]?.count ?? (v === 'normal' ? record.count : 0));
        result[`variantCatchCount.${v}`] += catches;
        if (catches > 0) { result[`variantSpeciesCount.${v}`]++; count++; }
      }
      result.speciesVariantPairs += count;
      result.maxVariantsPerSpecies = Math.max(result.maxVariantsPerSpecies, count);
    }
    for (const event of eventRegistry) if (number(state.specialEventCollection?.entries?.[event.id]?.count) > 0) {
      const key = `specialUnique.${event.seriesId}`;
      result[key] = (result[key] || 0) + 1; result.specialUniqueTotal++;
    }
    result.baseSpeciesCount = Object.values(BASE_PACK_IDS).flat().filter(id => number(collection[id]?.count) > 0).length;
    result['wallet.totalEarned'] = number(state.wallet?.totalEarned);
    return result;
  }
  function achievementProgress(state, achievement) { const def = typeof achievement === 'string' ? definitions.get(achievement) : achievement; return def ? number(metrics(state)[def.id === 'all-species' ? 'baseSpeciesCount' : def.stat]) : 0; }
  function evaluate(input, now = Date.now(), source = 'earned') {
    const state = { ...input }, values = metrics(state), unlocked = new Set(state.achievements || []), times = { ...state.achievementTimes }, metadata = { ...state.achievementMetadata };
    const added = [];
    for (const a of ACHIEVEMENTS) if (!(state.achievementData?.pendingMeasurements && a.seriesId === 6) && !unlocked.has(a.id) && number(values[a.id === 'all-species' ? 'baseSpeciesCount' : a.stat]) >= a.target) {
      unlocked.add(a.id); times[a.id] = now; metadata[a.id] = { source, pointsAtUnlock: a.points }; added.push(a.id);
    }
    state.achievements = [...unlocked].filter(id => definitions.has(id)); state.achievementTimes = times; state.achievementMetadata = metadata;
    state.achievementTitles = [...new Set([...(state.achievementTitles || []), ...ACHIEVEMENT_SERIES.filter(s => s.achievementIds.every(id => unlocked.has(id))).map(s => String(s.id))])];
    if (state.achievementTitleId && !state.achievementTitles.includes(String(state.achievementTitleId))) state.achievementTitleId = '';
    if (added.length) state.achievementNotice = { ids: [...new Set([...(state.achievementNotice?.ids || []), ...added])], source: state.achievementNotice?.source === 'retroactive' || source === 'retroactive' ? 'retroactive' : 'earned', at: now };
    delete state._achievementMigration;
    return state;
  }
  function achievementSummary(state) {
    const unlocked = new Set(state.achievements || []);
    const series = ACHIEVEMENT_SERIES.map(s => ({ id: s.id, name: s.name, title: s.title, unlocked: s.achievementIds.filter(id => unlocked.has(id)).length, total: s.achievementIds.length, completed: s.achievementIds.every(id => unlocked.has(id)) || state.achievementTitles?.includes(String(s.id)) }));
    return { unlocked: ACHIEVEMENTS.filter(a => unlocked.has(a.id)).length, total: ACHIEVEMENTS.length, points: ACHIEVEMENTS.reduce((sum, a) => {
      const snapshot = state.achievementMetadata?.[a.id]?.pointsAtUnlock;
      const points = snapshot !== null && snapshot !== undefined && Number.isFinite(Number(snapshot)) && Number(snapshot) >= 0 ? Number(snapshot) : a.points;
      return sum + (unlocked.has(a.id) ? points : 0);
    }, 0), totalPoints: 1255, series, titles: series.filter(s => s.completed).map(s => ({ id: String(s.id), name: s.title })) };
  }
  function achievementDetails(state, id) {
    const a = definitions.get(id); if (!a) return null;
    return { progress: achievementProgress(state, a), target: a.target, unlocked: state.achievements?.includes(id) || false, source: state.achievementMetadata?.[id]?.source || null,
      partialHistory: a.retroactive === 'B' && Boolean(state.achievementData?.partialHistory),
      hint: id === 'corners' ? '把钓鱼角色拖到屏幕角落附近再抛竿；四个角落可分次完成，退出后保留。' : '',
      corners: id === 'corners' ? CORNERS.map((key, i) => ({ id: key, name: CORNER_NAMES[i], completed: Object.hasOwn(state.cornerCasts || {}, key) })) : [] };
  }
  function finalizeMeasurements(input, now = Date.now()) {
    if (!input.achievementData?.pendingMeasurements) return input;
    const data = { ...input.achievementData, pendingMeasurements: false };
    for (const item of [...(input.history || []), ...(input.inventory || [])]) {
      if (positive(item.lengthCm) && Number(item.lengthCm) <= 5) data.smallLengthCatchCount = 1;
      if (positive(item.weightKg) && Number(item.weightKg) <= .01) data.smallWeightCatchCount = 1;
    }
    return evaluate({ ...input, achievementData: data }, now, 'retroactive');
  }
  function applyAchievementAction(input, action) {
    const state = { ...input };
    if (action?.type === 'acknowledge') { state.achievementNotice = null; return { ok: true, state }; }
    if (action?.type === 'title') {
      const id = String(action.id ?? '');
      if (id && !achievementSummary(state).titles.some(t => t.id === id)) return { ok: false, reason: 'title-locked', state };
      return { ok: true, state: { ...state, achievementTitleId: id } };
    }
    if (action?.type === 'track' && definitions.has(action.id)) {
      const tracked = new Set(state.achievementTracking || []);
      if (tracked.has(action.id)) tracked.delete(action.id);
      else if (tracked.size >= 3) return { ok: false, reason: 'tracking-limit', state };
      else tracked.add(action.id);
      return { ok: true, state: { ...state, achievementTracking: [...tracked] } };
    }
    return { ok: false, reason: 'invalid-achievement-action', state };
  }
  const api = { VERSION, CORNERS, ACHIEVEMENTS, ACHIEVEMENT_SERIES, configure, createData, recordFish, migrate, metrics, evaluate, achievementProgress, achievementSummary, achievementDetails, finalizeMeasurements, applyAchievementAction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondAchievements = api;
})(typeof window !== 'undefined' ? window : globalThis);
