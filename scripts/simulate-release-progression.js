'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const G=require('../src/game-state-runtime'), P=require('../src/probability-system'), A=require('../src/achievement-system'), V=require('../src/fish-variants');
const root=path.resolve(__dirname,'..'), events=require('../src/special-events').runtimeRegistry();
const profiles=Object.fromEntries(require('../data/fish-measurements.json').entries.map(x=>[x.fishId,x]));
const timings=require('../src/asset-runtime').actionTimings(require('../assets/pet/v1-runtime/action-manifest.json'));
const duration=id=>timings[id].totalMs, start=Date.UTC(2026,0,1);
function rng(seed){return()=>{let x=seed=(seed+0x6d2b79f5)>>>0;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return((x^(x>>>14))>>>0)/4294967296;};}
function measurementRandom(rolls){rolls=[...rolls];let seed=rolls.reduce((s,r,i)=>(s^Math.floor(Math.min(1-1e-12,Math.max(1e-12,r))*0xffffffff)^((i+1)*0x9e3779b9))>>>0,0x6d2b79f5);const next=rng(seed);return()=>rolls.length?Math.min(1-1e-12,Math.max(1e-12,rolls.shift())):next();}
function simulate(seed,policy='collector',verify=false,max=16000){
 const random=rng(seed), missedRng=rng(seed^0xa1b2c3d4);let s=G.createInitialState(start),elapsed=0,encounters=0,missed=0,unhook=0,verifyCount=0,continuing=false;const milestones={},unlockedAt={},keep=[];
 const mark=name=>{if(!milestones[name])milestones[name]={encounters,fish:s.catches,seconds:elapsed/1000};};
 for(let i=0;i<max;i++){
  // Compare remaining habitat completion fractions; switching is an explicit player action.
  if(!continuing&&s.ownedPacks.includes('S1')&&policy!=='freshwater-only'){
   const own=h=>s.ownedPacks.filter(p=>G.PACK_HABITATS[p]===h), fraction=h=>own(h).reduce((n,p)=>n+s.stats.packUnique[p],0)/(own(h).length*38);
   s.activeHabitat=fraction('freshwater')<=fraction('saltwater')?'freshwater':'saltwater';
  }
  if(!continuing){s.castCount++;if(s.castCount<=4&&policy!=='stationary')s.cornerCasts[A.CORNERS[s.castCount-1]]=start+elapsed;}
  s.introductoryCast=s.firstCast&&s.castCount===1;
  const waiting=G.durationFor(s,random,timings);s.firstCast=false;elapsed+=(continuing?0:duration('cast'))+waiting;continuing=false;encounters++;
  const packs=s.ownedPacks.filter(p=>G.PACK_HABITATS[p]===s.activeHabitat);
  const e=s.introductoryCast?G.pickEncounter(random,s):P.encounter(random,{habitat:s.activeHabitat,unlockedPacks:packs,fish:G.FISH.filter(f=>packs.includes(f.pack)),specialEvents:events,counters:s.pity,specialEventPity:s.specialEventPity,collection:s.specialEventCollection.entries});
  s.specialEventPity=e.nextSpecialEventPity;
  const rolls=e.encounterType==='fish'?[random(),random()]:null;
  const miss=policy==='miss-20pct'&&missedRng()<.2;
  if(miss){missed++;elapsed+=300000;} // Late player returns after five minutes; same catch remains.
  elapsed+=1000; // Reaction delay from bite onset; not the 10-second result card.
  if(e.randomUnhook){unhook++;elapsed+=duration('empty_reel');continue;}
  elapsed+=duration('reel_pull')+duration('catch_flight')+timings.catch_land.frameStartMs[1];
  const now=start+elapsed, pending={...e,catchId:`sim-${seed}-${i}`,selectedAt:now,measurementRolls:rolls};
  let expected;
  if(verify&&verifyCount<300){expected=G.commitCatch({...s,fishingState:'catch_land',catchCommitted:false,pendingCatch:pending},random,now,profiles);verifyCount++;}
  if(e.encounterType==='special'){
   const old=s.specialEventCollection.entries[e.eventId],duplicate=Boolean(old?.count);
   s.specialEventCollection.entries[e.eventId]={count:(old?.count||0)+1,firstFoundAt:old?.firstFoundAt||now,lastFoundAt:now};
   s.specialEventPity.duplicateSpecialStreak=duplicate?Math.min(8,s.specialEventPity.duplicateSpecialStreak+1):0;
   s.achievementData.committedSpecialIds=[...s.achievementData.committedSpecialIds,pending.catchId].slice(-128);
  }else{
   const f=G.FISH.find(f=>f.id===e.fishId),old=s.collection[f.id]||{},m=G.generateMeasurement(f,measurementRandom(rolls),profiles[f.id]);
   const value=Math.max(1,Math.round(G.calculateCatchValue(f,m,profiles[f.id])*V.VALUE_MULTIPLIERS[e.variant]));
   const protectedFish=['golden','iridescent'].includes(e.variant)&&!old.variants?.[e.variant]?.count;
   const entry={...m,resultId:f.id,fishId:f.id,variant:e.variant,valueCoins:value};
   s.collection[f.id]={count:(old.count||0)+1,firstAt:old.firstAt||now,lastAt:now,maxLengthCm:Math.max(old.maxLengthCm||0,m.lengthCm),maxWeightKg:Math.max(old.maxWeightKg||0,m.weightKg),variants:V.applyCatch(old.variants,e.variant,now,m)};
   s.catches++;s.stats.totalCatchCount++;s.stats.rarity[f.rarity]++;s.stats.packs[f.pack]++;if(!old.count)s.stats.packUnique[f.pack]++;
   s.stats.uniqueSpeciesCount=Object.keys(s.collection).length;s.stats.largestLengthCm=Math.max(s.stats.largestLengthCm,m.lengthCm);s.stats.largestWeightKg=Math.max(s.stats.largestWeightKg,m.weightKg);
   s.stats.distinctStreak=s.stats.lastCaughtFishId&&s.stats.lastCaughtFishId!==f.id?s.stats.distinctStreak+1:1;s.stats.bestDistinctStreak=Math.max(s.stats.bestDistinctStreak,s.stats.distinctStreak);s.stats.lastCaughtFishId=f.id;
   s.pity=P.updatePity(s.pity,e.variant);s.achievementData=A.recordFish(s.achievementData,entry);
   if(protectedFish)keep.push(entry);
   if(verify&&expected){assert.deepEqual(s.collection,expected.collection);assert.deepEqual(s.stats,expected.stats);assert.deepEqual(s.pity,expected.pity);}
   if(!protectedFish&&policy!=='no-selling'){s.wallet.balance+=value;s.wallet.totalEarned+=value;s.achievementData.soldFishCount++;}
  }
  if(verify&&expected){assert.deepEqual(s.specialEventCollection,expected.specialEventCollection);assert.deepEqual(s.specialEventPity,expected.specialEventPity);}
  for(const pack of G.PACK_ORDER.slice(1))if(!s.ownedPacks.includes(pack)&&s.ownedPacks.includes(G.PACK_PREREQUISITES[pack])&&s.wallet.balance>=G.PACK_PRICES[pack]){
   if(verify){const bought=G.purchasePack(s,pack,now);assert.equal(bought.ok,true);}
   s.wallet.balance-=G.PACK_PRICES[pack];s.wallet.totalSpent+=G.PACK_PRICES[pack];s.ownedPacks.push(pack);mark(pack);
  }
  s=A.evaluate(s,now);
  for(const id of s.achievements)if(!unlockedAt[id])unlockedAt[id]={encounters,fish:s.catches,seconds:elapsed/1000};
  if(s.stats.uniqueSpeciesCount===152)mark('species152');
  if(Object.keys(s.specialEventCollection.entries).length===60)mark('special60');
  if(s.achievements.length===71)mark('achievements71');
  elapsed+=duration('catch_land')-timings.catch_land.frameStartMs[1]+duration(`celebrate_${e.rarity||'common'}`);
  if(milestones.achievements71&&policy!=='stationary')break;
 }
 return {seed,policy,milestones,encounters,fish:s.catches,seconds:elapsed/1000,species:s.stats.uniqueSpeciesCount,events:Object.keys(s.specialEventCollection.entries).length,achievements:s.achievements.length,missing:G.ACHIEVEMENTS.filter(a=>!s.achievements.includes(a.id)).map(a=>a.id),unlockedAt,missed,unhook,verifyCount,retainedProtected:keep.length};
}
function main(){
const count=Number(process.argv[2]||200), trials=[];
for(let i=0;i<count;i++){trials.push(simulate(20260905+i*7919,'collector',i===0));if(i%20===0)console.log(`progress ${i+1}/${count}`);}
const quant=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
function summary(key){const rows=trials.map(t=>t.milestones[key]).filter(Boolean);return{completed:rows.length,total:count,...Object.fromEntries(['encounters','fish','seconds'].map(k=>[k,{p10:quant(rows.map(r=>r[k]),.1),median:quant(rows.map(r=>r[k]),.5),p90:quant(rows.map(r=>r[k]),.9),min:Math.min(...rows.map(r=>r[k])),max:Math.max(...rows.map(r=>r[k])),mean:rows.reduce((s,r)=>s+r[k],0)/rows.length}]))};}
const scenarios=['no-selling','freshwater-only','stationary','miss-20pct'].map(p=>simulate(20260905,p,false,p==='miss-20pct'?16000:4000));
const report={version:require('../package.json').version,generatedAt:new Date().toISOString(),sampleSize:count,seedStart:20260905,seedStride:7919,maxEncounters:16000,definition:'152 species, not 608 species/color pairs; simulated active time, first cast 10 seconds incl animation, casts 2-5 wait 30-90 seconds, later 5-10 minutes; late response keeps catch; 1-second normal response, result card does not block casting; protected first gold/iridescent kept; explicit four-corner casts',timings,summary:Object.fromEntries(['F2','S1','S2','species152','special60','achievements71'].map(k=>[k,summary(k)])),scenarios,trials};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,`artifacts/release-progression-${require('../package.json').version}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify({sampleSize:count,summary:report.summary,parityCommits:trials[0].verifyCount}));
}
module.exports={simulate,rng,profiles,timings};
if(require.main===module)main();
