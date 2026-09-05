'use strict';
const fishes = [
  { id: 'fish-1', nameZh: '金鱼', nameEn: 'Goldfish', files: 'fish-1' },
  { id: 'fish-2', nameZh: '霓虹灯鱼', nameEn: 'Neon Tetra', files: 'fish-2' },
  { id: 'fish-18', nameZh: '神仙鱼', nameEn: 'Angelfish', files: 'fish-18' },
  { id: 'fish-26', nameZh: '黑白魟', nameEn: 'Polka-dot Stingray', files: 'fish-26' }
];
const variants = [{ id: 'normal', label: '原色', note: '正式图标复用' }, { id: 'alternate', label: '异色', note: '物种专属调色' }, { id: 'golden', label: '纯金', note: '四档明暗金色' }, { id: 'iridescent', label: '炫彩', note: '银白底 + 遮罩光谱' }];
const tabs = document.querySelector('#fishTabs'); const gallery = document.querySelector('#gallery'); const status = document.querySelector('#motionStatus');
let current = fishes[0]; let observer;
function renderTabs() { tabs.replaceChildren(...fishes.map((fish) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = `${fish.nameZh} · ${fish.id}`; button.setAttribute('aria-pressed', String(fish.id === current.id)); button.addEventListener('click', () => { current = fish; renderTabs(); renderGallery(); }); return button; })); }
function renderGallery() { gallery.replaceChildren(...variants.map((variant) => { const card = document.createElement('article'); card.className = 'variant-card'; card.dataset.variant = variant.id; const file = `../assets/fish/variant-prototype/v1/${current.files}-${variant.id}.png`; const mask = `../assets/fish/variant-prototype/v1/${current.files}-iridescent-mask.png`; card.innerHTML = `<h2>${variant.label}</h2><p>${variant.note}</p><div class="fish-art"><img src="${file}" alt="${current.nameZh} ${variant.label}">${variant.id === 'iridescent' ? `<span class="spectrum" style="--mask:url('${mask}')" aria-hidden="true"></span>` : ''}</div><p>${current.nameEn}</p>`; return card; })); if (observer) observer.disconnect(); observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.target.classList.toggle('is-visible', entry.isIntersecting)), { threshold: 0.1 }); document.querySelectorAll('.variant-card').forEach((card) => observer.observe(card)); }
document.addEventListener('visibilitychange', () => { document.body.classList.toggle('page-hidden', document.hidden); status.textContent = document.hidden ? '页面隐藏：动态暂停' : '页面可见：按视口播放'; });
renderTabs(); renderGallery(); status.textContent = '页面可见：按视口播放';
