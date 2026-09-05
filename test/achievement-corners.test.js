const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../src/pet-layout');

test('four relaxed corners remain reachable across work areas, offsets and pet scales', () => {
  for (const area of [
    {x:0,y:0,width:1920,height:1040},
    {x:-2560,y:-200,width:2560,height:1400},
    {x:80,y:60,width:1280,height:720},
    {x:0,y:0,width:640,height:480}
  ]) for (const scale of [0.75,1,1.25,1.5]) {
    const width = Math.round(192*scale), height = Math.round(208*scale);
    const margins = Layout.cornerCaptureMargins(area);
    for (const corner of ['top-left','top-right','bottom-left','bottom-right']) {
      const left = corner.endsWith('left'), top = corner.startsWith('top');
      const dx = Math.min(90,(area.width-width)/4), dy = Math.min(80,(area.height-height)/4);
      const bounds = {width,height,x:left?area.x+dx:area.x+area.width-width-dx,y:top?area.y+dy:area.y+area.height-height-dy};
      assert.equal(Layout.cornerIdForBounds(bounds,area),corner,JSON.stringify({area,scale,corner}));
    }
    assert.ok(margins.x <= area.width/4 && margins.y <= area.height/4);
  }
});

test('forgiving zones include exact threshold, reject center and invalid geometry', () => {
  const area={x:0,y:40,width:1920,height:1040};
  const margin=Layout.cornerCaptureMargins(area);
  const body={width:192,height:208,x:margin.x,y:area.y+margin.y};
  assert.equal(Layout.cornerIdForBounds(body,area),'top-left');
  assert.equal(Layout.cornerIdForBounds({...body,x:margin.x+1},area),null);
  assert.equal(Layout.cornerIdForBounds({width:192,height:208,x:864,y:456},area),null);
  assert.equal(Layout.cornerIdForBounds(null,area),null);
  assert.equal(Layout.cornerIdForBounds({...body,x:NaN},area),null);
  assert.equal(Layout.cornerIdForBounds({...body,x:-1000},area),null);
});

test('explicit geometry tolerance remains supported for other callers', () => {
  const area={x:0,y:0,width:1920,height:1040};
  assert.equal(Layout.cornerIdForBounds({x:65,y:40,width:192,height:208},area,64),null);
  assert.equal(Layout.cornerIdForBounds({x:65,y:40,width:192,height:208},area),'top-left');
});
