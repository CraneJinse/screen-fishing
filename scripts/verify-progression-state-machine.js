'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const G=require('../src/game-state-runtime'),A=require('../src/achievement-system');
const {simulate,rng,profiles,timings}=require('./simulate-release-progression');
const seed=20260905,random=rng(seed),start=Date.UTC(2026,0,1);let now=start,s=G.createInitialState(start);const milestones={};
function advance(){let at=s.stateEndsAt;if(s.fishingState==='catch_land'&&!s.catchCommitted)at=s.catchCommitAt;assert.ok(at!=null);now=at;s=G.tick(s,now,random,profiles,timings);}
for(let i=0;i<300;i++){
 if(s.ownedPacks.includes('S1')){const ratio=h=>{const p=s.ownedPacks.filter(p=>G.PACK_HABITATS[p]===h);return p.reduce((n,p)=>n+s.stats.packUnique[p],0)/(p.length*38);};s=G.switchHabitat(s,ratio('freshwater')<=ratio('saltwater')?'freshwater':'saltwater',now).state;}
 s=G.transition(s,'cast',random,now,{corner:i<4?A.CORNERS[i]:undefined},timings);advance();advance();now+=1000;s=G.transition(s,'reel',random,now,{},timings);
 if(s.fishingState==='empty_reel'){advance();continue;}
 advance();advance();advance();assert.equal(s.catchCommitted,true);
 const ids=s.inventory.filter(f=>!f.locked&&!f.autoLocked).map(f=>f.inventoryId);
 if(ids.length){const sold=G.sellInventory(s,ids,now);assert.equal(sold.ok,true);s=sold.state;}
 for(const p of G.PACK_ORDER.slice(1))if(!s.ownedPacks.includes(p)&&s.ownedPacks.includes(G.PACK_PREREQUISITES[p])&&s.wallet.balance>=G.PACK_PRICES[p]){s=G.purchasePack(s,p,now).state;milestones[p]={encounters:i+1,fish:s.catches,seconds:(now-start)/1000};}
 advance();advance();assert.equal(s.fishingState,'idle');
}
const fast=simulate(seed,'collector',false,300);
assert.equal(fast.fish,s.catches);assert.equal(fast.species,Object.keys(s.collection).length);assert.equal(fast.events,Object.keys(s.specialEventCollection.entries).length);assert.equal(fast.achievements,s.achievements.length);assert.equal(fast.seconds,(now-start)/1000);assert.deepEqual(fast.milestones,milestones);
const report={ok:true,encounters:300,fish:s.catches,species:fast.species,events:fast.events,achievements:fast.achievements,seconds:fast.seconds,milestones,method:'real transition/tick/commit/sell/purchase vs compact simulation; same seed and exact virtual timestamps'};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/progression-state-machine-parity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
