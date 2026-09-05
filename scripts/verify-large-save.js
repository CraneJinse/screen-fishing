'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),G=require('../src/game-state-runtime');
const results=[];
for(const count of [100,1000,10000]){
 const s=G.createInitialState(1000),f=G.FISH[0];s.inventory=Array.from({length:count},(_,i)=>({inventoryId:`large-${i}`,catchId:`large-${i}`,fishId:f.id,resultId:f.id,caughtAt:1000+i,variant:'normal',lengthCm:5,weightKg:.01,valueCoins:20,locked:i===0}));
 s.collection[f.id]={count,firstAt:1000,maxLengthCm:5,maxWeightKg:.01,variants:{normal:{count}}};
 const json=JSON.stringify(s);let begin=performance.now(),n=G.normalizeState(JSON.parse(json),2000),normalizeMs=performance.now()-begin;
 assert.equal(n.inventory.length,count);assert.equal(n.stats.totalCatchCount,count);
 begin=performance.now();const sold=G.sellInventory(n,n.inventory.filter(f=>!f.locked).map(f=>f.inventoryId),3000);const sellMs=performance.now()-begin;
 assert.equal(sold.ok,true);assert.equal(sold.state.inventory.length,1);assert.equal(sold.state.wallet.balance,(count-1)*20);assert.equal(sold.state.stats.totalCatchCount,count);
 assert.equal(G.sellInventory(sold.state,['large-1'],4000).ok,false);
 results.push({count,bytes:Buffer.byteLength(json),normalizeMs,sellMs,retainedLocked:1,ok:true});
}
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/large-save-report.json',JSON.stringify({ok:true,results},null,2));console.log(JSON.stringify(results));
