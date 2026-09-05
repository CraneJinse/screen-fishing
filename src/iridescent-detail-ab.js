(async function iridescentDetailAB() {
  'use strict';
  const root = document.getElementById('comparison');
  const response = await fetch(`../artwork/iridescent-detail-ab-v1/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`无法读取 A/B 清单：${response.status}`);
  const manifest = await response.json();
  const asset = (relative) => `../${relative}?v=${encodeURIComponent(manifest.revision)}`;
  const art = (entry, option) => {
    const detail = option === 'A' ? entry.optionA.detailOverlay : entry.optionB.detailOverlay;
    return `<div class="fish-art" style="--fish-scale:${entry.catalogScale}"><img src="${asset(entry.baseIcon)}" alt=""><i class="pearl-layer spectrum-clouds" style="--mask:url('${asset(entry.bodyMask)}')"></i><i class="pearl-layer spectrum-ribbons" style="--mask:url('${asset(entry.bodyMask)}')"></i><i class="pearl-layer pearl-glint" style="--mask:url('${asset(entry.bodyMask)}')"></i><img class="detail-overlay" src="${asset(detail)}" alt=""></div>`;
  };
  root.innerHTML = manifest.entries.map((entry) => `<section class="fish-row" data-fish="${entry.fishId}">
    <div class="fish-meta"><img class="source-art" src="${asset(entry.sourceIcon)}" alt="${entry.name} 原色"><div><h2>${entry.name}</h2><p>${entry.fishId} · ${entry.packName}</p><p>${entry.rarityName} · 图鉴缩放 ${entry.catalogScale}</p></div></div>
    <article class="variant-card option-a">${art(entry, 'A')}<div><h3>方案 A</h3><p>黑色轮廓与关键结构线<br>其余内部花纹使用多级浅灰蓝</p></div></article>
    <article class="variant-card option-b">${art(entry, 'B')}<div><h3>方案 B</h3><p>黑色外轮廓<br>内部结构与花纹保留原版像素颜色</p></div></article>
  </section>`).join('');
  document.title = `摸鱼搭子｜炫彩结构线 A/B（${manifest.entries.length} 种）`;
})().catch((error) => {
  document.getElementById('comparison').innerHTML = `<p class="error">${String(error.message || error)}</p>`;
});
