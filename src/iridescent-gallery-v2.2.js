(async function iridescentGallery() {
  'use strict';
  const packOrder = ['F1', 'F2', 'S1', 'S2'];
  const packNames = PondGame.PACKS;
  const fishById = new Map(PondGame.FISH.map((fish) => [fish.id, fish]));
  const gallery = document.getElementById('gallery');
  const nav = document.getElementById('packNav');
  const search = document.getElementById('search');
  const response = await fetch('../assets/fish/variants/manifest.json');
  if (!response.ok) throw new Error(`无法读取炫彩清单：${response.status}`);
  const manifest = await response.json();
  const entryById = new Map(manifest.entries.map((entry) => [entry.fishId, entry]));

  function asset(entry, relative) { return `../assets/fish/variants/${entry.pack.toLowerCase()}/${relative}`; }
  function art(entry) {
    const variant = entry.variants.iridescent; const scale = Number(entry.presentation?.catalogScale) || 1;
    const base = asset(entry, variant.baseIcon); const mask = asset(entry, variant.bodyMask); const details = asset(entry, variant.detailOverlay);
    return `<div class="fish-art" style="--catalog-fish-scale:${scale}"><img src="${base}" alt=""><i class="pearl-layer spectrum-clouds" style="--mask:url('${mask}')"></i><i class="pearl-layer spectrum-ribbons" style="--mask:url('${mask}')"></i><i class="pearl-layer pearl-glint" style="--mask:url('${mask}')"></i><img class="detail-overlay" src="${details}" alt=""></div>`;
  }
  function render(query = '') {
    const needle = query.trim().toLocaleLowerCase('zh-CN'); let visibleCount = 0;
    const sections = packOrder.map((packId) => {
      const fishes = PondGame.FISH.filter((fish) => fish.pack === packId && (!needle || fish.name.toLocaleLowerCase('zh-CN').includes(needle)));
      if (!fishes.length) return '';
      visibleCount += fishes.length;
      const cards = fishes.map((fish) => {
        const entry = entryById.get(fish.id); const compact = Number(entry.presentation?.catalogScale) < 1;
        return `<article class="fish-card" data-fish="${fish.id}" data-compact="${compact}"><div class="fish-card-head"><span>#${entry.catalogIndex}</span><span>${fish.rarityName}</span></div>${art(entry)}<h3>${fish.name}</h3><p>${fish.id} · 图鉴缩放 ${entry.presentation.catalogScale}</p></article>`;
      }).join('');
      return `<section class="pack-section" id="pack-${packId}"><h2 class="pack-title">${packId} · ${packNames[packId]}<span>${fishes.length} 种</span></h2><div class="fish-grid">${cards}</div></section>`;
    }).join('');
    gallery.innerHTML = sections || '<p class="empty">没有匹配的鱼类</p>';
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.target.classList.toggle('is-visible', entry.isIntersecting)), { rootMargin: '120px', threshold: .05 });
    document.querySelectorAll('.fish-card').forEach((card) => observer.observe(card));
    document.title = `摸鱼搭子｜方案 B 炫彩图鉴（${visibleCount}/152）`;
  }
  nav.innerHTML = packOrder.map((packId) => `<a href="#pack-${packId}">${packId} · ${packNames[packId]}</a>`).join('');
  search.addEventListener('input', () => render(search.value));
  render();
})().catch((error) => {
  document.getElementById('gallery').innerHTML = `<p class="empty">${String(error.message || error)}</p>`;
});
