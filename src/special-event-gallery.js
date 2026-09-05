(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const themeNames = { work: '工位摸鱼', waterside: '水边怪趣', warmth: '温柔祝福', vibe: 'Vibe Coding' };
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase = 0, observer;
  const query = new URLSearchParams(location.search);
  if (query.has('capture')) { document.body.classList.add('capture-mode'); playing = false; }
  if (query.get('mode') === 'collection') $('mode').value = 'collection';
  if (query.has('series')) $('series').value = query.get('series');
  if (['64', '128', '256'].includes(query.get('size'))) $('size').value = query.get('size');
  function render() {
    observer?.disconnect();
    const group = $('series').value, expanded = $('mode').value === 'collection';
    const sections = PondSpecialEvents.SERIES.filter((item) => group === 'all' || item.id === group);
    let count = 0;
    $('gallery').innerHTML = sections.map((series) => {
      const all = PondSpecialEvents.REGISTRY.filter((event) => event.seriesId === series.id);
      const entries = expanded ? all : all.filter((event, i) => all.findIndex((other) => other.iconPath === event.iconPath) === i);
      count += entries.length;
      return `<section data-series="${series.id}"><h2>${escape(series.name)}<span>${entries.length} 款${expanded ? '收藏' : '设计'}</span></h2><div class="grid">${entries.map((event) => {
        const same = all.filter((item) => item.iconPath === event.iconPath);
        const title = !expanded && event.bottleTheme ? themeNames[event.bottleTheme] : event.title;
        return `<article class="event-card" data-id="${event.id}"><span class="code">${escape(!expanded && same.length > 1 ? `${same[0].id} — ${same.at(-1).id}` : event.id)}</span><h3>${escape(title)}</h3>
          <div class="art-pair"><div class="art-well"><img src="../${event.iconPath}" alt="${escape(title)}" loading="eager"></div><div class="art-well"><div class="animation" role="img" aria-label="${escape(title)}上钩动画" style="background-image:url('../${event.animationPath}');background-size:${event.frameCount * 100}% 100%"></div></div></div>
          <div class="art-labels"><span>收藏图案</span><span>上钩动作</span></div><p class="description">${escape(event.description)}</p>${!expanded && same.length > 1 ? `<p class="membership">对应 ${same.length} 条收藏 · ${escape(same.map((item) => item.title).join(' / '))}</p>` : ''}</article>`;
      }).join('')}</div></section>`;
    }).join('');
    $('empty').hidden = count > 0;
    observer = new IntersectionObserver((changes) => changes.forEach((entry) => entry.target.classList.toggle('visible', entry.isIntersecting)), { rootMargin: '80px' });
    document.querySelectorAll('.event-card').forEach((card) => observer.observe(card));
    draw(phase, true);
    updateButton();
    window.eventGalleryReady = true;
  }
  function draw(frame, all = false) {
    phase = frame;
    document.querySelectorAll(all ? '.animation' : '.event-card.visible .animation').forEach((node) => node.style.backgroundPosition = `${frame / 5 * 100}% 0`);
    $('frame').value = String(frame); $('frameLabel').textContent = `${frame + 1} / 6`;
  }
  function updateButton() { $('motion').textContent = playing ? '暂停动画' : '播放动画'; $('motion').setAttribute('aria-pressed', String(playing)); }
  $('motion').addEventListener('click', () => { playing = !playing; updateButton(); });
  $('frame').addEventListener('input', () => { playing = false; updateButton(); draw(Number($('frame').value), true); });
  $('mode').addEventListener('change', render); $('series').addEventListener('change', render);
  $('size').addEventListener('change', () => document.body.style.setProperty('--art-size', `${$('size').value}px`));
  if (query.has('size')) document.body.style.setProperty('--art-size', `${Math.max(32, Math.min(256, Number(query.get('size')) || 128))}px`);
  setInterval(() => { if (playing && !document.hidden) draw((phase + 1) % 6); }, 160);
  render();
})();
