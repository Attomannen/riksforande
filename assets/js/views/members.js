/* Ledamöter: alla tjänstgörande ledamöter, sökbara, med antal avvikande röster för valt riksmöte. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, norm, fmtNum, partyInfo, SEAT_ORDER, debounce } = RF;
  RF.views = RF.views || {};

  const rebelCounts = {}; // rm -> Map(iid -> antal), sparas under sessionen när de väl är hämtade

  async function loadRebelCounts(rm, onProgress) {
    if (rebelCounts[rm]) return rebelCounts[rm];
    const pc = await api.partyCounts(rm);
    const parties = analysis.activeParties(pc);
    const perParty = {};
    const report = (p) => (d, t) => {
      perParty[p] = [d, t];
      let done = 0, total = 0;
      for (const [a, b] of Object.values(perParty)) { done += a; total += b; }
      onProgress(done, total);
    };
    const results = await Promise.all(parties.map((p) => analysis.partyOutliers(rm, p, report(p))));
    const map = new Map();
    for (const res of results) res.members.forEach((m) => map.set(m.iid, (map.get(m.iid) || 0) + m.items.length));
    rebelCounts[rm] = map;
    return map;
  }

  RF.views.members = async function (ctx) {
    const { el, rm } = ctx;
    const body = h('div', ui.loading('Hämtar ledamöter…'));
    mount(el, h('div.page-head', h('div', h('h1', 'Riksdagens ledamöter'), h('p', 'Alla tjänstgörande ledamöter. Öppna en ledamot för att se varje röst, hur ofta hen följer partiet och varje gång hen har brutit partilinjen.'))), body);

    let members;
    try { members = await api.members(); } catch (err) {
      if (ctx.alive()) mount(body, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const q = ctx.query;
    const selected = new Set((q.get('parti') || '').split(',').filter(Boolean));
    const search = h('input', { type: 'search', placeholder: 'Sök namn eller valkrets', value: q.get('q') || '', 'aria-label': 'Sök ledamöter' });
    const valkretsar = [...new Set(members.map((m) => m.valkrets).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
    const vkSel = h('select', { 'aria-label': 'Valkrets' }, h('option', { value: '' }, 'Alla valkretsar'), valkretsar.map((v) => h('option', { value: v, selected: q.get('valkrets') === v }, v)));
    const sortSel = h('select', { 'aria-label': 'Sortering' }, [['name', 'Sortera på namn'], ['party', 'Sortera på parti'], ['valkrets', 'Sortera på valkrets'], ['rebels', 'Flest avvikande röster']].map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'name') === v }, l)));
    const partyChips = h('div.chips', SEAT_ORDER.filter((p) => members.some((m) => m.party === p)).map((p) => {
      const b = h('button.chip-btn', { type: 'button', 'aria-pressed': String(selected.has(p)) }, ui.partyBadge(p), partyInfo(p).name);
      b.addEventListener('click', () => { if (selected.has(p)) selected.delete(p); else selected.add(p); b.setAttribute('aria-pressed', String(selected.has(p))); draw(); });
      return b;
    }));
    const rebelsArea = h('div');
    const grid = h('div');
    const countEl = h('span.muted', { style: { fontSize: '.85rem' } });
    let counts = rebelCounts[rm] || null;

    const showRebelControls = () => {
      if (counts) {
        mount(rebelsArea, h('p.notice', `Avvikande röster räknas för riksmötet ${rm}: antalet gånger varje ledamot röstade mot sitt partis linje.`));
        return;
      }
      mount(rebelsArea, h('div.notice.row',
        h('span', `Vill du se vem som oftast bryter partilinjen? Hämta avvikande röster för ${rm} (går igenom alla voteringar där ett parti inte var enigt).`),
        h('span.spacer'),
        h('button.btn.small.primary', { type: 'button', onclick: async () => {
          try {
            counts = await loadRebelCounts(rm, (d, t) => { if (ctx.alive()) mount(rebelsArea, ui.progress(d, t, 'Går igenom partiernas röster')); });
            if (!ctx.alive()) return;
            sortSel.value = 'rebels';
            showRebelControls();
            draw();
          } catch (err) { if (ctx.alive()) mount(rebelsArea, ui.errorBox(err)); }
        } }, 'Hämta avvikande röster')));
    };

    const draw = () => {
      const term = norm(search.value.trim());
      let list = members.filter((m) => (!term || norm(`${m.name} ${m.valkrets}`).includes(term)) && (!selected.size || selected.has(m.party)) && (!vkSel.value || m.valkrets === vkSel.value));
      const sort = sortSel.value;
      const seat = (p) => SEAT_ORDER.indexOf(p);
      if (sort === 'party') list = list.slice().sort((a, b) => seat(a.party) - seat(b.party) || a.sort.localeCompare(b.sort, 'sv'));
      else if (sort === 'valkrets') list = list.slice().sort((a, b) => (a.valkrets || '').localeCompare(b.valkrets || '', 'sv') || a.sort.localeCompare(b.sort, 'sv'));
      else if (sort === 'rebels' && counts) list = list.slice().sort((a, b) => (counts.get(b.iid) || 0) - (counts.get(a.iid) || 0) || a.sort.localeCompare(b.sort, 'sv'));
      else list = list.slice().sort((a, b) => a.sort.localeCompare(b.sort, 'sv'));
      countEl.textContent = `${fmtNum(list.length)} av ${fmtNum(members.length)}`;
      if (!list.length) { mount(grid, ui.empty('Inga ledamöter matchar.')); }
      else {
        mount(grid, h('div.grid.cards', list.map((m) => {
          const n = counts ? counts.get(m.iid) || 0 : null;
          const special = m.status && !/^Tjänstgörande riksdagsledamot$/i.test(m.status) ? m.status.replace(/^Tjänstgörande /i, '') : null;
          return h('a.card.member-card', { href: `#/member/${m.iid}` },
            ui.avatar(m),
            h('div.t', { style: { flex: 1 } },
              h('b', m.name),
              h('small', m.valkrets),
              special || m.partyRoles.length ? h('small', { style: { color: 'var(--text-2)' } }, [m.partyRoles.map((r) => r.role).join(', '), special].filter(Boolean).join(' · ')) : null),
            h('div.stack', { style: { textAlign: 'right' } }, ui.partyBadge(m.party), n != null ? (n ? ui.rebelBadge(n, String(n)) : h('span.faint', { style: { fontSize: '.78rem' } }, '0')) : null));
        })));
      }
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      if (selected.size) params.set('parti', [...selected].join(','));
      if (vkSel.value) params.set('valkrets', vkSel.value);
      if (sort !== 'name') params.set('sort', sort);
      ctx.setQuery(params);
    };
    search.addEventListener('input', debounce(draw, 120));
    vkSel.addEventListener('change', draw);
    sortSel.addEventListener('change', () => {
      if (sortSel.value === 'rebels' && !counts) rebelsArea.querySelector('button') && rebelsArea.querySelector('button').click();
      draw();
    });

    mount(body,
      h('div.filters', search, vkSel, sortSel, h('span.spacer'), countEl),
      h('div', { style: { marginBottom: '12px' } }, partyChips),
      h('div', { style: { marginBottom: '12px' } }, rebelsArea),
      grid);
    showRebelControls();
    draw();
  };
})(window.RF);
