'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const game=require('../src/game-state-runtime'),probability=require('../src/probability-system');
const variants=require('../src/fish-variants'),events=require('../src/special-events');
const measurements=require('../data/fish-measurements.json'),manifest=require('../assets/pet/v1-runtime/action-manifest.json');
const content=fs.readFileSync(path.join(__dirname,'../docs/encyclopedia/GAME_ENCYCLOPEDIA.md'),'utf8');
const rows=content.split(/\r?\n/).filter(line=>line.startsWith('| ')).map(line=>line.split(/(?<!\\)\|/).slice(1,-1).map(cell=>cell.trim().replaceAll('\\|','|')));
const compact=(value,digits=3)=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:digits,useGrouping:false});
function mass(g){return g>=1e6?`${compact(g/1e6,2)} t`:g>=1000?`${compact(g/1000,2)} kg`:g>=1?`${compact(g,2)} g`:`${compact(g*1000,2)} mg`;}

test('all 17 chapters and fish identities, measurements and prices match runtime',()=>{
  assert.deepEqual([...content.matchAll(/^## (\d+)\./gm)].map(m=>Number(m[1])),Array.from({length:17},(_,i)=>i+1));
  const fishRows=rows.filter(r=>/^fish-\d+$/.test(r[1]));assert.equal(fishRows.length,game.FISH.length);
  for(const fish of game.FISH){
    const row=fishRows.find(r=>r[1]===fish.id),p=measurements.entries.find(x=>x.fishId===fish.id);assert(row,fish.id);
    assert.deepEqual(row.slice(0,9),[String(p.catalogIndex),fish.id,fish.name,p.nameEn,p.scientificName,game.rarityNames[fish.rarity],['min','typical','max'].map(k=>compact(p.lengthCm[k])).join(' / '),['min','typical','max'].map(k=>mass(p.weightG[k])).join(' / '),String(fish.baseValueCoins)],fish.id);
    for(const [index,variant] of variants.VARIANTS.entries()){
      const mult=variants.VALUE_MULTIPLIERS[variant],range=row[9+index].split('–').map(Number);
      const ends=['min','max'].map(k=>Math.round(game.calculateCatchValue(fish,{lengthCm:p.lengthCm[k],weightKg:p.weightG[k]/1000},p)*mult));assert.deepEqual(range,ends,fish.id+' '+variant);
      let seed=1000+Number(p.catalogIndex);const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<40;i++){const measure=game.generateMeasurement(fish,random,p);const actual=Math.round(game.calculateCatchValue(fish,measure,p)*mult);assert(actual>=range[0]&&actual<=range[1],fish.id+' price outside published envelope');}
    }
  }
});
test('all event text and achievement conditions match runtime registries',()=>{
  const eventRows=rows.filter(r=>/^(DB|RS|EC)-\d+$/.test(r[0]));assert.equal(eventRows.length,events.REGISTRY.length);
  for(const e of events.REGISTRY)assert.deepEqual(eventRows.find(r=>r[0]===e.id),[e.id,e.seriesName,e.title,e.description]);
  const section=content.slice(content.indexOf('## 12.'),content.indexOf('## 13.'));
  for(const a of game.ACHIEVEMENTS)assert.deepEqual(rows.find(r=>r[0]===a.id&&r[1]===a.name),[a.id,a.name,a.description,String(a.target),a.stat]);
  assert.equal(section.split('\n').filter(l=>l.startsWith('| ')&&!l.startsWith('| ID')&&!l.startsWith('| ---')).length,game.ACHIEVEMENTS.length);
});
test('action rows match official timing and distinguish legacy actions',()=>{
  for(const [id,a] of Object.entries(manifest.actions)){
    const row=rows.find(r=>r[0]===id);assert(row,id);assert.deepEqual(row.slice(1,5),[String(a.frameCount),a.loop?'循环':'一次性',String(a.frameDurationMs),a.animationMeta?.type||'标准逐帧']);
    if(['bite_urgent','fish_escape','sad_recover','drag_idle','drag_fishing'].includes(id))assert.match(row[5],/兼容/);
  }
});
test('pack prices, rarity and actual soft/hard pity boundaries match mechanics',()=>{
  for(const p of Object.values(game.PACK_DEFINITIONS))assert.deepEqual(rows.find(r=>r[0]===p.id),[p.id,p.name,game.HABITATS[p.habitat],String(game.FISH.filter(f=>f.pack===p.id).length),p.starter?'免费':String(p.priceCoins),p.prerequisitePack||'无']);
  const total=Object.values(probability.RARITY_WEIGHTS).reduce((s,n)=>s+n,0);
  for(const rarity of game.RARITIES)assert.equal(rows.find(r=>r[1]===rarity)[3],compact(probability.RARITY_WEIGHTS[rarity]/total*100)+'%');
  for(const [counter,variant,level] of [['goldenPlusMisses','golden',2],['iridescentMisses','iridescent',3]]){
    const row=rows.find(r=>r[1]===variant),soft=Number(row[4].match(/第(\d+)条/)[1]),hard=Number(row[5].match(/第(\d+)条/)[1]);
    const base=probability.variantWeights({})[variant];assert.equal(probability.variantWeights({[counter]:soft-2})[variant],base);assert(probability.variantWeights({[counter]:soft-1})[variant]>base);
    assert(probability.pityMinimum({[counter]:hard-2})<level);assert(probability.pityMinimum({[counter]:hard-1})>=level);
  }
});
test('version and UI navigation match current game and obsolete claims are absent',()=>{
  assert(content.includes(`当前游戏版本：${require('../package.json').version}`));assert(content.includes(`声明${game.STATES.length}个状态`));
  const panel=fs.readFileSync(path.join(__dirname,'../src/panel.js'),'utf8');const home=panel.slice(panel.indexOf('function renderHome()'),panel.indexOf('function homeButton('));
  const names=[...home.matchAll(/homeButton\('[^']+', '[^']+', '([^']+)'\)/g)].map(m=>m[1]);assert.equal(names.length,9);for(const name of names)assert(content.includes(name));
  for(const stale of ['鱼类超时仍计入','特殊事件超时仍算','首页保留8个入口','按账号全局','空闲时按需销毁面板','同种鱼聚合并按尺寸从小到大','可爱角色 Peiqi'])assert(!content.includes(stale),stale);
  assert.match(content,/0\.825–1\.175/);assert.match(content,/每个物种首次获得的纯金/);assert.match(content,/摸鱼搭子\.exe/);
});
