/* Pokébot commands page: rendered from the bot's own /help table (data/help.json, or the copy the bot publishes) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const groups = $('groups'), cats = $('cats'), q = $('q');
  const NEW_TAGS = { new: 'new' };
  async function init() {
    let d;
    try { d = await (await fetch('/api/help')).json(); } catch { groups.innerHTML = '<div class="empty"><h3>Couldn\'t load the command list</h3></div>'; return; }
    const list = d.groups || [];
    groups.innerHTML = list.map(g => `<section class="cgroup" data-cat="${esc(g.id)}"><h2><span class="em">${esc(g.emoji)}</span>${esc(g.title)}<span class="n">${g.commands.length} ${g.id === 'new' ? 'things' : 'commands'}</span></h2><div class="clist">${g.commands.map(c => {
      const isCmd = c.cmd.startsWith('/'); const copy = isCmd ? c.cmd.split(' · ')[0] : '';
      return `<div class="c panel lift ${isCmd ? '' : 'note'}" ${copy ? `data-copy="${esc(copy)}"` : ''} data-text="${esc((c.cmd + ' ' + c.desc).toLowerCase())}"><span class="name">${esc(c.cmd)}${NEW_TAGS[g.id] ? ' <span class="tag">new</span>' : ''}</span>${copy ? '<span class="copy">Copy</span>' : ''}<span class="desc">${esc(c.desc)}</span></div>`; }).join('')}</div></section>`).join('');
    cats.innerHTML = '<button class="active" data-cat="all">All</button>' + list.map(g => `<button data-cat="${esc(g.id)}">${esc(g.emoji)} ${esc(g.title)}</button>`).join('');
    let cat = 'all';
    function apply() {
      const term = q.value.trim().toLowerCase(); let any = false;
      document.querySelectorAll('.cgroup').forEach(g => { let vis = 0; g.querySelectorAll('.c').forEach(c => { const show = (cat === 'all' || g.dataset.cat === cat) && (!term || c.dataset.text.includes(term)); c.hidden = !show; if (show) vis++; }); g.style.display = vis ? '' : 'none'; if (vis) any = true; });
      $('nores').classList.toggle('show', !any);
    }
    cats.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.cat; cats.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); apply(); });
    q.addEventListener('input', apply);
    document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
    if (location.hash) { const b = cats.querySelector(`[data-cat="${CSS.escape(location.hash.slice(1))}"]`); if (b) b.click(); }
  }
  init();
})();
