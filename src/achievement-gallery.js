'use strict';
(function () {
  const api = window.PondAchievements;
  const byId = (id) => document.getElementById(id);
  const series = byId('series'), search = byId('search'), gallery = byId('gallery');
  for (const item of api.ACHIEVEMENT_SERIES) {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; series.append(option);
  }
  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = api.ACHIEVEMENTS.filter(a => (series.value === 'all' || String(a.seriesId) === series.value)
      && (!q || a.name.toLowerCase().includes(q) || String(a.number).padStart(3,'0').includes(q) || a.id.includes(q)));
    gallery.replaceChildren();
    for (const a of rows) {
      const card = document.createElement('article'); card.className = 'icon-card'; card.dataset.achievementId = a.id;
      const stage = document.createElement('div'); stage.className = 'icon-stage';
      const img = document.createElement('img'); img.src = '../' + a.iconPath; img.alt = a.name; img.width = 256; img.height = 256;
      img.addEventListener('error', () => { img.dataset.assetError='true'; });
      stage.append(img);
      const name = document.createElement('h2'), num = document.createElement('span'); num.className='number'; num.textContent=String(a.number).padStart(3,'0'); name.append(num, a.name);
      const condition = document.createElement('p'); condition.textContent = a.description;
      const id = document.createElement('small'); id.textContent = a.id;
      card.append(stage, name, condition, id); gallery.append(card);
    }
    byId('count').textContent = rows.length + ' / ' + api.ACHIEVEMENTS.length + ' 款';
    byId('empty').hidden = rows.length > 0;
  }
  series.addEventListener('change', render); search.addEventListener('input',render);
  byId('size').addEventListener('change', e => document.documentElement.style.setProperty('--size', e.target.value+'px'));
  byId('theme').addEventListener('change', e => document.body.classList.toggle('light', e.target.value === 'light'));
  render();
})();

