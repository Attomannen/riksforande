/* En ledamot: profil, uppdrag, varje röst under valt riksmöte och varje gång hen bröt mot partiet. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, pct, fmtNum, fmtDate, plural, norm, partyInfo, rmSlug, debounce } = RF;
  RF.views = RF.views || {};

  const ROLE_TYPES = { kammaruppdrag: 'Kammaren', Riksdagsorgan: 'Utskott och organ', partiuppdrag: 'Partiet', Departement: 'Regeringen', Europaparlamentet: 'Europaparlamentet', talmansuppdrag: 'Talmanskap', uppdrag: 'Övriga uppdrag' };

  function rolesBlock(p) {
    const current = (p.roles || []).filter((r) => r.current && r.type !== 'kammaruppdrag');
    const groups = RF.groupBy(current, (r) => r.type);
    if (!current.length) return null;
    return h('div', { style: { marginTop: '10px' } },
      [...groups].map(([type, list]) => h('div', { style: { marginTop: '6px' } },
        h('small.faint', ROLE_TYPES[type] || type),
        h('ul.roles', list.map((r) => h('li', { 'data-tip': r.from ? `Sedan ${fmtDate(r.from)}${r.to ? `\nTill ${fmtDate(r.to)}` : ''}` : null }, `${r.role}${r.name ? ' – ' + r.name : r.organ ? ' – ' + r.organ : ''}`))))));
  }

  RF.views.member = async function (ctx, iid) {
    const { el, rm } = ctx;
    mount(el, ui.loading('Hämtar ledamoten…'));
    let p;
    try { p = await api.person(iid); } catch (err) {
      if (ctx.alive()) mount(el, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;
    if (!p) { mount(el, ui.errorBox(new Error('Ledamoten finns inte i riksdagens öppna data.'))); return; }
    document.title = `${p.name} (${p.party}) – Riksförande`;

    const info = partyInfo(p.party);
    const recordEl = h('div', ui.loading(`Hämtar röster för ${rm}…`));
    const pastRoles = (p.roles || []).filter((r) => !r.current && r.type !== 'kammaruppdrag');
    const firstName = p.first || p.name;

    mount(el,
      h('div.crumbs', h('a', { href: '#/members' }, 'Ledamöter'), '›', h('span', p.name)),
      h('div.card.profile',
        ui.avatar(p, 'xl'),
        h('div.info',
          h('div.row', ui.partyBadge(p.party, { link: true }), h('span.muted', info.name)),
          h('h1', { style: { margin: '6px 0 2px' } }, p.name),
          h('div.muted', [p.status, p.valkrets, p.born ? `född ${p.born}` : null].filter(Boolean).join(' · ')),
          rolesBlock(p),
          h('div.row', { style: { marginTop: '12px' } },
            h('a.btn.small', { href: RF.memberUrl(p.iid), target: '_blank', rel: 'noopener' }, 'Profil på riksdagen.se ↗'),
            p.email ? h('a.btn.small', { href: `mailto:${p.email}` }, p.email) : null,
            (p.web || []).slice(0, 2).map((w) => h('a.btn.small', { href: /^https?:/.test(w) ? w : 'https://' + w, target: '_blank', rel: 'noopener' }, 'Webbplats ↗'))))),
      h('section.section', h('h2', `Röster under ${rm}`), recordEl),
      p.bio && p.bio.length ? h('section.section',
        h('details.card.more', h('summary', 'Biografi'),
          h('dl.bio', p.bio.map((b) => [h('dt', b.label), h('dd', b.text)])))) : null,
      pastRoles.length ? h('section.section',
        h('details.card.more', h('summary', `Tidigare uppdrag (${pastRoles.length})`),
          h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '.88rem' } }, pastRoles.slice(0, 200).map((r) =>
            h('li', `${r.role}${r.name ? ' – ' + r.name : ''} `, h('span.faint', `${r.from ? r.from.slice(0, 4) : ''}–${r.to ? r.to.slice(0, 4) : ''}`)))))) : null);

    let votes, index, pc;
    try {
      [votes, index, pc] = await Promise.all([api.memberVotes(iid, rm), api.voteIndex(rm), api.partyCounts(rm)]);
    } catch (err) {
      if (ctx.alive()) mount(recordEl, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;
    if (!votes.length) {
      mount(recordEl, ui.empty(`${p.name} har inga registrerade röster under ${rm}. Statsråd, talmannen och tjänstlediga ledamöter röstar inte – välj ett annat riksmöte i menyn högst upp.`));
      return;
    }

    const indexById = new Map(index.map((v) => [v.id, v]));
    const rec = analysis.memberRecord(votes, pc, indexById);
    const partiesUsed = [...new Set(votes.map((v) => v.party))];
    const rows = rec.rows
      .map((r) => ({ ...r, date: r.meta ? r.meta.date : '', title: r.meta ? r.meta.title : `${r.bet} p. ${r.punkt}`, key: norm(`${r.meta ? r.meta.title : ''} ${r.bet}`) }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const devs = rows.filter((r) => r.status === 'rebel');

    const search = h('input', { type: 'search', placeholder: 'Sök voteringar', 'aria-label': 'Sök voteringar' });
    const filter = h('select', { 'aria-label': 'Filter' },
      [['', 'Alla voteringar'], ['rebel', 'Bröt partilinjen'], ['Ja', 'Röstade Ja'], ['Nej', 'Röstade Nej'], ['Avstår', 'Avstod'], ['Frånvarande', 'Frånvarande']].map(([v, l]) => h('option', { value: v }, l)));
    const tableEl = h('div');
    const draw = () => {
      const term = norm(search.value.trim());
      const f = filter.value;
      const list = rows.filter((r) => (!term || r.key.includes(term)) && (!f || (f === 'rebel' ? r.status === 'rebel' : r.vote === f)));
      mount(tableEl, ui.sortableTable([
        { key: 'date', label: 'Datum', render: (r) => h('span.nowrap.muted', fmtDate(r.date)), sort: (r) => r.date },
        { key: 'title', label: 'Votering', render: (r) => h('a', { href: `#/vote/${rmSlug(rm)}/${r.id}` }, r.title, h('span.faint', ` · ${r.bet} p. ${r.punkt}`)), sort: (r) => r.title },
        { key: 'vote', label: 'Röst', render: (r) => ui.votePill(r.vote), sort: (r) => r.vote },
        { key: 'line', label: 'Partilinje', render: (r) => (r.line ? h('span.muted', r.line) : r.split ? h('span.faint', 'delad') : h('span.faint', '—')) },
        { key: 'status', label: '', render: (r) => (r.status === 'rebel' ? h('span.rebel-badge', 'Bröt linjen') : ''), sort: (r) => (r.status === 'rebel' ? 0 : 1) },
      ], list, { sortKey: 'date', dir: -1, pageSize: 50, rowClass: (r) => (r.status === 'rebel' ? 'is-rebel' : ''), emptyText: 'Inga voteringar matchar.' }));
    };
    search.addEventListener('input', debounce(draw, 150));
    filter.addEventListener('change', draw);

    mount(recordEl,
      h('div.tiles',
        ui.tile('Voteringar', fmtNum(rec.total), `${rec.tally.Ja} Ja · ${rec.tally.Nej} Nej · ${rec.tally['Avstår']} Avstår`),
        ui.tile('Närvaro', pct(rec.attendance), plural(rec.tally['Frånvarande'], 'gång frånvarande', 'gånger frånvarande')),
        ui.tile('Röstade med partiet', pct(rec.loyalty), 'av avlagda röster där partiet hade en linje'),
        ui.tile('Bröt partilinjen', fmtNum(devs.length), devs.length ? `senast ${fmtDate(devs[0].date)}` : 'aldrig under riksmötet')),
      partiesUsed.length > 1 ? h('p.notice', { style: { marginTop: '12px' } }, `Röstade som ledamot för ${partiesUsed.join(' och ')} under riksmötet; varje röst jämförs med det parti hen tillhörde vid tillfället.`) : null,
      h('div', { style: { marginTop: '16px' } },
        h('h3', `Gånger ${firstName} bröt partilinjen`),
        devs.length
          ? h('div.stack', devs.map((r) => h('a.card', { href: `#/vote/${rmSlug(rm)}/${r.id}`, style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 14px', color: 'var(--text)', flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', r.title), h('div.faint', { style: { fontSize: '.8rem' } }, `${fmtDate(r.date)} · ${r.bet} punkt ${r.punkt}`)),
            h('div.row', { style: { flexWrap: 'nowrap' } }, h('span.faint', { style: { fontSize: '.8rem' } }, 'röstade'), ui.votePill(r.vote), h('span.faint', { style: { fontSize: '.8rem' } }, `· ${r.party}:s linje`), ui.votePill(r.line)))))
          : ui.empty(`${firstName} följde partilinjen i varje votering under ${rm}.`)),
      h('div', { style: { marginTop: '20px' } },
        h('h3', 'Alla voteringar'),
        h('div.filters', search, filter),
        tableEl));
    draw();
  };
})(window.RF);
