const test=require('node:test'),assert=require('node:assert/strict'),G=require('../src/game-state-runtime');
const timings={cast:{totalMs:1104}},random=()=>.5;
function bite(){let s=G.transition(G.createInitialState(1000),'cast',random,1000,{},timings);s=G.tick(s,s.stateEndsAt,random,{},timings);return G.tick(s,s.stateEndsAt,random,{},timings);}
test('等待在抛竿时确定，重读抛竿和等待状态不再抽时间',()=>{
 let s=G.transition(G.createInitialState(1000),'cast',random,1000,{},timings);assert.equal(s.castWaitDurationMs,8896);assert.equal(s.firstCast,false);
 s=G.normalizeState(JSON.parse(JSON.stringify(s)),1500);s=G.tick(s,2104,()=>{throw Error('reroll');},{},timings);assert.equal(s.stateEndsAt,11000);
 const paused=G.suspend(s,3104),resumed=G.resume(G.normalizeState(JSON.parse(JSON.stringify(paused))),100000);assert.equal(resumed.stateEndsAt,107896);
});
test('取消重抛消耗新手杆数，不能反复获得10秒首杆',()=>{
 let s=G.createInitialState(1000),now=1000;
 for(let i=1;i<=6;i++){s=G.transition(s,'cast',random,now,{},timings);assert.equal(s.castCount,i);assert.equal(s.introductoryCast,i===1);if(i>1)assert.ok(s.castWaitDurationMs>=(i<=5?30000:300000));s=G.transition(s,'early-reel',random,now+1,{},timings);now=s.stateEndsAt;s=G.tick(s,now,random);}
});
test('新存档首杆保证普通原色鱼，不发生特殊事件或随机脱钩',()=>{
 for(const r of [0,.2,.9,.999999]){let s=G.transition(G.createInitialState(1000),'cast',()=>r,1000);s=G.tick(s,s.stateEndsAt,()=>r);s=G.tick(s,s.stateEndsAt,()=>r);assert.equal(s.pendingCatch.encounterType,'fish');assert.equal(s.pendingCatch.rarity,'common');assert.equal(s.pendingCatch.variant,'normal');assert.equal(s.pendingCatch.randomUnhook,false);}
});
test('普通鱼与特殊事件待收杆可暂停、重读、隔天领取且不重复入库',()=>{
 for(const special of [false,true]){
 let s=bite();if(special)s.pendingCatch={encounterType:'special',eventId:require('../src/special-events').REGISTRY[0].id,catchId:'test-special-ready',probabilityVersion:3};
 s=G.tick(s,s.biteDeadlineAt,random);assert.equal(s.fishingState,'bite_ready');const pending=s.pendingCatch;
 s=G.resume(G.normalizeState(JSON.parse(JSON.stringify(G.suspend(s,40000)))),86400000);
 assert.equal(s.fishingState,'bite_ready');assert.equal(s.stateEndsAt,null);assert.deepEqual(s.pendingCatch,pending);
 assert.equal(G.transition(s,'cast',random,86400001).fishingState,'bite_ready');
 s=G.transition(s,'reel',random,86400002);s=G.tick(s,s.stateEndsAt,random);s=G.tick(s,s.stateEndsAt,random);s=G.tick(s,s.catchCommitAt,random);const again=G.commitCatch(s,random,86405000);
 assert.equal(again.catches,s.catches);assert.deepEqual(again.specialEventCollection,s.specialEventCollection);assert.equal(s.catches,special?0:1);
 if(special)assert.equal(Object.values(s.specialEventCollection.entries)[0].count,1);
 }
});
test('旧档紧急阶段安全转为待收杆，延迟tick不会导致逃脱',()=>{
 let s=bite();s={...s,version:12,saveSchemaVersion:12,fishingState:'bite_urgent',stateEndsAt:s.biteDeadlineAt};
 const pending=s.pendingCatch;s=G.tick(s,s.biteDeadlineAt+3600000,random);assert.equal(s.fishingState,'bite_ready');assert.deepEqual(s.pendingCatch,pending);assert.equal(s.stats.escapeCount,0);
});
