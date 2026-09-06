'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {CharacterLibrary,validatePackage}=require('../src/character-library');
const appRoot=path.resolve(__dirname,'..');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pond-bundled-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,root:path.join(dir,'characters')};}
for (const [id,name] of [['design-04','柠檬'],['skeleton-pirate-design-01','亡灵船长']]) {
test(`fresh install offers three characters and preserves ${id} selection without copying bundled art or touching progress`,t=>{
 const {dir,root}=setup(t),save=path.join(dir,'save.json');fs.writeFileSync(save,'{"coins":123}');
 const library=new CharacterLibrary({root,appRoot});
 assert.deepEqual(library.snapshot().entries.map(p=>[p.id,p.status,p.builtin]),[['classic','ready',true],['design-04','ready',true],['skeleton-pirate-design-01','ready',true]]);
 assert.equal(library.selectedId,'classic');library.select(id);
 const next=new CharacterLibrary({root,appRoot});assert.equal(next.selectedId,id);assert(next.snapshot().entries.find(p=>p.id===id).builtin);
 assert.equal(fs.readFileSync(save,'utf8'),'{"coins":123}');assert.deepEqual(fs.readdirSync(root),['selection.json']);
 assert.throws(()=>next.import(path.join(appRoot,'assets/characters',id)),/已经存在/);
 next.select('classic');assert.equal(next.selectedId,'classic');
});
test(`existing custom ${id} retains its name and selection when upgrading`,t=>{
 const {root}=setup(t);fs.mkdirSync(root,{recursive:true});fs.cpSync(path.join(appRoot,'assets/characters',id),path.join(root,id),{recursive:true});
 const file=path.join(root,id,'character.json'),meta=JSON.parse(fs.readFileSync(file));meta.name='我的'+name;fs.writeFileSync(file,JSON.stringify(meta));fs.writeFileSync(path.join(root,'selection.json'),JSON.stringify({selectedId:id}));
 const library=new CharacterLibrary({root,appRoot});assert.equal(library.selectedId,id);const entry=library.snapshot().entries.find(p=>p.id===id);assert.equal(entry.name,'我的'+name);assert.equal(entry.builtin,false);
});
test(`bundled ${id} contains every approved action and fully decodes`,()=>{
 const pack=validatePackage(path.join(appRoot,'assets/characters',id),require('../assets/pet/v1-runtime/action-manifest.json'));
 assert.equal(pack.files.length,25);assert.equal(pack.metadata.name,name);assert.equal(Object.keys(pack.data.actions).length,22);
});
}
test('missing or corrupted bundled data safely falls back to classic and keeps selection evidence',t=>{
 const {dir,root}=setup(t),bundledRoot=path.join(dir,'bundled');fs.mkdirSync(bundledRoot);fs.writeFileSync(path.join(bundledRoot,'catalog.json'),JSON.stringify({ids:['design-04']}));
 fs.mkdirSync(root);fs.writeFileSync(path.join(root,'selection.json'),JSON.stringify({selectedId:'design-04'}));
 const library=new CharacterLibrary({root,appRoot,bundledRoot});assert.equal(library.selectedId,'classic');assert.equal(library.invalid.length,1);assert.match(fs.readFileSync(path.join(root,'selection.json'),'utf8'),/design-04/);
 fs.writeFileSync(path.join(bundledRoot,'catalog.json'),JSON.stringify({ids:['../../outside']}));library.reload();assert.equal(library.selectedId,'classic');assert.match(library.notice,/不可用/);
});
