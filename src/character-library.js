'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { isDeepStrictEqual } = require('node:util');
const { pathToFileURL } = require('node:url');
const Assets = require('./asset-runtime');
const DEFAULT_ID = 'classic';
const FORMAT = 'screen-fishing-character';
const MAX_BYTES = 64 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id) && id !== DEFAULT_ID;

function inside(root, relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('素材路径不合法');
  const base = fs.realpathSync(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw Error('素材路径超出角色目录');
  let cursor = base;
  for (const part of relative.split('/')) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('角色包不接受链接文件'); }
  if (!fs.statSync(target).isFile() || !fs.realpathSync(target).startsWith(base + path.sep)) throw Error('素材必须是角色包内的普通文件');
  return target;
}
function json(file, limit = 128 * 1024) {
  if (fs.statSync(file).size > limit) throw Error('角色说明文件过大');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255]; return (crc ^ 0xffffffff) >>> 0; }
// Decode bounded 8-bit RGBA PNGs, including CRC and alpha, without a runtime dependency.
function validatePng(file, width, height, frames = 1) {
  const size = fs.statSync(file).size;
  if (size > 12 * 1024 * 1024) throw Error('单张图片超过12MB');
  const b = fs.readFileSync(file);
  if (!b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('图片不是PNG');
  const chunks = []; let pos = 8, seenHeader = false, ended = false, w, h;
  while (pos + 12 <= b.length) {
    const len = b.readUInt32BE(pos), type = b.toString('ascii', pos + 4, pos + 8), end = pos + 12 + len;
    if (end > b.length || crc32(b.subarray(pos + 4, end - 4)) !== b.readUInt32BE(end - 4)) throw Error('PNG文件损坏');
    const data = b.subarray(pos + 8, end - 4);
    if (!seenHeader && type !== 'IHDR') throw Error('PNG缺少头信息');
    if (type === 'IHDR') {
      if (seenHeader || len !== 13) throw Error('PNG头信息损坏');
      seenHeader = true; w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (w !== width || h !== height || data[8] !== 8 || data[9] !== 6 || data[10] || data[11] || data[12]) throw Error(`图片应为${width}×${height}、8位RGBA、非隔行PNG`);
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') { if (len || end !== b.length) throw Error('PNG结束信息损坏'); ended = true; break; }
    pos = end;
  }
  if (!ended || !chunks.length) throw Error('PNG未完成');
  const row = w * 4, expected = (row + 1) * h;
  const raw = zlib.inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
  if (raw.length !== expected) throw Error('PNG像素数据不完整');
  let previous = Buffer.alloc(row), opaque = Array(frames).fill(0), transparent = Array(frames).fill(0);
  for (let y = 0; y < h; y++) {
    const offset = y * (row + 1), filter = raw[offset], current = Buffer.alloc(row);
    if (filter > 4) throw Error('PNG过滤器不合法');
    for (let x = 0; x < row; x++) {
      const a = x >= 4 ? current[x - 4] : 0, up = previous[x], c = x >= 4 ? previous[x - 4] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? up : filter === 3 ? Math.floor((a + up) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      current[x] = (raw[offset + 1 + x] + predictor) & 255;
      if (x % 4 === 3) { const frame = Math.floor((x / 4) / (w / frames)); if (current[x]) opaque[frame]++; else transparent[frame]++; }
    }
    previous = current;
  }
  if (opaque.some(n => n < 32) || transparent.some(n => !n)) throw Error('每帧必须有可见角色和透明背景');
  return { width: w, height: h, frames };
}
function validatePackage(directory, template, { decode = true } = {}) {
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('角色包不能是链接目录');
  const metadata = json(inside(directory, 'character.json'), 32768);
  if (metadata.format !== FORMAT || metadata.schemaVersion !== 1 || !validId(metadata.id)) throw Error('角色格式、版本或ID不正确');
  for (const [field, max] of [['name', 40], ['description', 300], ['author', 80]]) {
    if (metadata[field] != null && (typeof metadata[field] !== 'string' || metadata[field].length > max)) throw Error(`角色${field}字段不正确`);
  }
  if (!metadata.name?.trim() || !['draft', 'ready'].includes(metadata.status)) throw Error('缺少角色名称或制作状态');
  const design = metadata.design;
  if (!design || ['character', 'boat', 'rod'].some(key => typeof design[key] !== 'string' || !design[key].trim() || design[key].length > 6000)) throw Error('请填写人物、船和鱼竿三部分设计说明');
  const files = ['character.json']; let preview = null, data = null;
  if (metadata.preview != null) {
    if (!metadata.preview.endsWith('.png')) throw Error('预览图必须为PNG文件');
    const file = inside(directory, metadata.preview), dimensions = Assets.pngSize(file);
    if (!dimensions || dimensions.width < 128 || dimensions.height < 128 || dimensions.width > 1024 || dimensions.height > 1024) throw Error('预览图尺寸须在128–1024像素内');
    if (decode) validatePng(file, dimensions.width, dimensions.height); files.push(metadata.preview); preview = file;
  }
  if (metadata.status === 'ready') {
    if (!preview) throw Error('可用角色必须提供透明预览图');
    if (metadata.actionManifest !== 'action-manifest.json') throw Error('动作清单必须为action-manifest.json');
    data = json(inside(directory, metadata.actionManifest)); files.push(metadata.actionManifest);
    if (!isDeepStrictEqual(data.canvas, template.canvas) || data.defaultAction !== template.defaultAction || data.schemaVersion !== template.schemaVersion) throw Error('角色画布或动作版本不兼容');
    if (Object.keys(data.actions || {}).sort().join() !== Object.keys(template.actions).sort().join()) throw Error('角色必须包含全部22组动作');
    for (const [id, contract] of Object.entries(template.actions)) {
      const action = data.actions[id];
      // All gameplay timing, anchors, hit areas and event frames stay authoritative.
      if (!isDeepStrictEqual({ ...action, file: contract.file }, contract)) throw Error(`动作${id}的时序、锚点或交互范围不符合当前游戏契约`);
      if (!/^actions\/[a-z_]+\.png$/.test(action.file)) throw Error('动作文件应放在actions目录');
      const file = inside(directory, action.file), dimensions = Assets.pngSize(file);
      if (dimensions?.width !== contract.frameWidth * contract.frameCount || dimensions?.height !== contract.frameHeight) throw Error(`动作${id}图片尺寸不正确`);
      if (decode) validatePng(file, contract.frameWidth * contract.frameCount, contract.frameHeight, contract.frameCount); files.push(action.file);
    }
  }
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.reduce((n, f) => n + fs.statSync(inside(directory, f)).size, 0) > MAX_BYTES) throw Error('角色包超过64MB');
  return { metadata, data, preview, files: uniqueFiles, directory: fs.realpathSync(directory) };
}
function atomicJson(file, data) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
class CharacterLibrary {
  constructor({ root, appRoot, bundledRoot = path.join(appRoot, 'assets/characters') }) {
    this.root = path.resolve(root); this.appRoot = path.resolve(appRoot);
    this.bundledRoot = bundledRoot && path.resolve(bundledRoot);
    this.template = json(path.join(appRoot, 'assets/pet/v1-runtime/action-manifest.json'));
    this.packs = new Map(); this.selectedId = DEFAULT_ID; this.reload();
  }
  reload() {
    this.packs.clear(); this.notice = ''; this.selectedId = DEFAULT_ID; this.invalid = [];
    try {
      fs.mkdirSync(this.root, { recursive: true });
      if (fs.lstatSync(this.root).isSymbolicLink()) throw Error('角色目录不能是链接');
      const setting = path.join(this.root, 'selection.json');
      if (fs.existsSync(setting)) { try { this.selectedId = json(inside(this.root, 'selection.json')).selectedId; } catch { this.notice = '角色选择记录损坏，已使用默认角色；原文件保留。'; } }
      const entries = fs.readdirSync(this.root, { withFileTypes: true }).filter(e => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()));
      if (entries.length > 100) this.notice = '角色库超过100个目录，仅读取前100个。';
      for (const entry of entries.slice(0, 100)) {
        try {
          const pack = validatePackage(path.join(this.root, entry.name), this.template, { decode: false });
          if (entry.name !== pack.metadata.id || this.packs.has(pack.metadata.id)) throw Error('目录名与角色ID不一致');
          this.packs.set(pack.metadata.id, pack);
        } catch (error) { this.invalid.push({ id: entry.name, name: entry.name.slice(0, 40), status: 'invalid', error: error.message }); }
      }
      // Local packs retain priority when upgrading an existing installation.
      // Bundled art stays read-only in application assets, outside personal saves.
      if (this.bundledRoot && fs.existsSync(this.bundledRoot)) {
        try {
          const catalog = json(inside(this.bundledRoot, 'catalog.json'));
          if (!Array.isArray(catalog.ids) || catalog.ids.length > 20 || new Set(catalog.ids).size !== catalog.ids.length) throw Error('内置角色目录无效');
          for (const id of catalog.ids) {
            if (!validId(id)) throw Error('内置角色ID无效');
            if (this.packs.has(id) || entries.some(e => e.name === id)) continue;
            try {
              const pack = validatePackage(path.join(this.bundledRoot, id), this.template, { decode: false });
              if (pack.metadata.id !== id || pack.metadata.status !== 'ready') throw Error('内置角色尚未完成');
              this.packs.set(id, { ...pack, builtin: true });
            } catch (error) { this.invalid.push({ id, name: id, status: 'invalid', error: error.message }); }
          }
        } catch { this.notice = '内置角色目录暂时不可读，经典搭子仍可使用。'; }
      }
      if (this.selectedId !== DEFAULT_ID && this.packs.get(this.selectedId)?.metadata.status !== 'ready') { this.notice = '上次选择的角色不可用，暂时使用默认角色。'; this.selectedId = DEFAULT_ID; }
      if (this.selectedId !== DEFAULT_ID) {
        try { const pack = this.packs.get(this.selectedId); this.packs.set(this.selectedId, { ...validatePackage(pack.directory, this.template), builtin: pack.builtin }); }
        catch (error) { this.invalid.push({ id: this.selectedId, name: this.packs.get(this.selectedId).metadata.name, status: 'invalid', error: error.message }); this.packs.delete(this.selectedId); this.selectedId = DEFAULT_ID; this.notice = '所选角色图片损坏，已使用默认角色。'; }
      }
    } catch { this.notice = '角色目录暂时不可读，已使用默认角色。'; }
    return this.snapshot();
  }
  snapshot() {
    const builtin = { id: DEFAULT_ID, name: '经典搭子', description: '原版人物、木船与钓组', author: 'Screen Fishing', status: 'ready', builtin: true, previewStrip: 6, preview: pathToFileURL(path.join(this.appRoot, 'assets/pet/v1-runtime/actions/idle.png')).href, design: { character: '经典像素钓鱼伙伴', boat: '木制小船', rod: '完整鱼竿、鱼线、浮漂与鱼钩' } };
    return { version: 1, selectedId: this.selectedId, notice: this.notice, entries: [builtin, ...[...this.packs.values()].map(p => ({ id: p.metadata.id, name: p.metadata.name, description: p.metadata.description || '', author: p.metadata.author || '', status: p.metadata.status, builtin: Boolean(p.builtin), design: p.metadata.design, preview: p.preview ? pathToFileURL(p.preview).href : null })), ...this.invalid] };
  }
  select(id) {
    if (fs.lstatSync(this.root).isSymbolicLink()) throw Error('角色目录不能是链接');
    if (id !== DEFAULT_ID && this.packs.get(id)?.metadata.status !== 'ready') throw Error('这个角色尚未完成或不可用');
    if (id !== DEFAULT_ID) {
      const verified = validatePackage(this.packs.get(id).directory, this.template);
      verified.builtin = this.packs.get(id).builtin;
      if (verified.metadata.status !== 'ready') throw Error('这个角色尚未完成');
      this.packs.set(id, verified);
    }
    const setting = path.join(this.root, 'selection.json');
    if (fs.existsSync(setting)) {
      inside(this.root, 'selection.json');
      if (fs.existsSync(setting + '.bak') && fs.lstatSync(setting + '.bak').isSymbolicLink()) throw Error('选择备份不能是链接');
      fs.copyFileSync(setting, setting + '.bak');
    }
    atomicJson(setting, { schemaVersion: 1, selectedId: id });
    this.selectedId = id; this.notice = ''; return this.snapshot();
  }
  assets(base) {
    const pack = this.packs.get(this.selectedId);
    if (!pack || pack.metadata.status !== 'ready') return base;
    return { ...base, fallbackPet: pathToFileURL(pack.preview).href, manifests: base.manifests.map(m => m.id === 'pet' ? { id: 'pet', basePath: pathToFileURL(pack.directory).href, data: pack.data } : m) };
  }
  import(directory) {
    const pack = validatePackage(path.resolve(directory), this.template), id = pack.metadata.id;
    if (this.packs.get(id)?.builtin) throw Error('此角色ID已经存在，请使用新的ID');
    fs.mkdirSync(this.root, { recursive: true });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw Error('角色目录不能是链接');
    const lock = path.join(this.root, '.import.lock');
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx'); } catch { throw Error('其他角色正在导入，请稍后重试'); }
    const staging = path.join(this.root, '.incoming-' + crypto.randomUUID()), target = path.join(this.root, id);
    let archive;
    try {
      if (fs.existsSync(target)) {
        const old = validatePackage(target, this.template);
        if (old.metadata.status !== 'draft' || pack.metadata.status !== 'ready') throw Error('此角色ID已经存在，请使用新的ID');
      }
      fs.mkdirSync(staging);
      for (const file of pack.files) { const dest = path.join(staging, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(inside(pack.directory, file), dest); }
      validatePackage(staging, this.template);
      if (fs.existsSync(target)) {
        const archives = path.join(this.root, '.archive'); fs.mkdirSync(archives, { recursive: true });
        if (fs.lstatSync(archives).isSymbolicLink() || !fs.realpathSync(archives).startsWith(fs.realpathSync(this.root) + path.sep)) throw Error('角色归档目录不能是链接或越界路径');
        archive = path.join(archives, id + '-' + crypto.randomUUID()); fs.renameSync(target, archive);
      }
      try { fs.renameSync(staging, target); } catch (error) { if (archive && !fs.existsSync(target)) fs.renameSync(archive, target); throw error; }
      this.reload(); return { id, library: this.snapshot() };
    } finally {
      fs.closeSync(descriptor); fs.unlinkSync(lock);
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
module.exports = { CharacterLibrary, validatePackage, validatePng, FORMAT, DEFAULT_ID, validId };
