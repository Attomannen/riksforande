/* Partier & partiledare: sammansättning, varje partis ledare, sammanhållning och hur ofta partierna röstar lika. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, pct, fmtNum, partyInfo, inkOn, PARTY_ORDER, SEAT_ORDER } = RF;
  RF.views = RF.views || {};

  const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  function rampColor(t) { return RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))]; }

  function leaderLine(entry, sittingIids) {
    const p = entry.person;
    const sitting = sittingIids.has(p.iid);
    return h('div.leader-mini',
      ui.avatar(p),
      h('div',
        h('b', p.name),
        h('small', `${entry.role}${entry.since ? ' sedan ' + entry.since.slice(0, 4) : ''}`),
        h('small', sitting ? 'Sitter i riksdagen' : p.status && !/ersättare/i.test(p.status) ? `${p.status} · röstar inte i kammaren` : 'Inte tjänstgörande ledamot')));
  }

  function heatmap(pc) {
    const { parties, m } = analysis.agreementMatrix(pc);
    if (parties.length < 2) return ui.empty('För lite data.');
    let min = 1;
    for (const a of parties) for (const b of parties) if (a !== b && m[a][b].rate != null) min = Math.min(min, m[a][b].rate);
    const lo = Math.floor(min * 10) / 10;
    const table = h('table.heatmap', { role: 'grid', 'aria-label': 'Andel voteringar där två partier hade samma linje' },
      h('thead', h('tr', h('th'), parties.map((p) => h('th', ui.partyBadge(p))))),
      h('tbody', parties.map((a) => h('tr',
        h('th', ui.partyBadge(a)),
        parties.map((b) => {
          if (a === b) return h('td.self', '—');
          const x = m[a][b];
          if (x.rate == null) return h('td.self', '·');
          const col = rampColor((x.rate - lo) / (1 - lo || 1));
          return h('td', {
            style: { background: col, color: inkOn(col) },
            'data-tip': `${a} och ${b}\nSamma linje i ${pct(x.rate)} av voteringarna\n(${fmtNum(x.same)} av ${fmtNum(x.both)} där båda hade en linje)`,
          }, Math.round(x.rate * 100));
        })))));
    const legend = h('div.row', { style: { justifyContent: 'center', fontSize: '.78rem', marginTop: '10px' } },
      h('span.muted', `${Math.round(lo * 100)} %`),
      h('span', { style: { display: 'inline-flex', gap: '2px' } }, RAMP.map((c) => h('span', { style: { width: '22px', height: '10px', background: c, borderRadius: '2px' } }))),
      h('span.muted', '100 % samstämmighet'));
    return h('div', h('div', { style: { overflowX: 'auto' } }, table), legend);
  }

  RF.views.parties = async function (ctx) {
    const { el, rm } = ctx;
    const body = h('div', ui.loading('Hämtar partierna…'));
    mount(el,
      h('div.page-head', h('div',
        h('h1', 'Partier & partiledare'),
        h('p', `Vem som leder varje parti, hur enigt partierna röstar och vilka partier som röstar lika. Siffrorna gäller riksmötet ${rm}.`))),
      body);

    let members, leaders, pc, index;
    try {
      [members, leaders, pc, index] = await Promise.all([api.members(), api.partyLeaders(), api.partyCounts(rm), api.voteIndex(rm)]);
    } catch (err) {
      if (ctx.alive()) mount(body, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const sittingIids = new Set(members.map((m) => m.iid));
    const seats = RF.groupBy(members, (m) => m.party);
    const active = analysis.activeParties(pc);

    const cards = PARTY_ORDER.map((p) => {
      const info = partyInfo(p);
      const sum = active.includes(p) ? analysis.partySummary(pc, p, index) : null;
      const L = leaders[p] || { leaders: [], groupLeaders: [] };
      return h('a.card.party-card', { href: `#/party/${p}` },
        h('span.stripe', { style: { background: info.color } }),
        h('div.head', ui.partyBadge(p, { lg: true }), h('h3', info.name)),
        L.leaders.length ? h('div.stack', L.leaders.map((x) => leaderLine(x, sittingIids))) : h('small.faint', 'Partiledaren finns inte i riksdagens öppna data'),
        h('dl.kv',
          h('dt', 'Mandat i dag'), h('dd', seats.has(p) ? seats.get(p).length : 0),
          sum ? [h('dt', { 'data-tip': 'Andel voteringar där alla partiets röstande ledamöter följde partilinjen' }, `Helt enigt (${rm})`), h('dd', pct(sum.cohesion))] : null,
          sum ? [h('dt', 'Avvikande röster'), h('dd', fmtNum(sum.devTotal))] : null,
          sum ? [h('dt', { 'data-tip': 'Andel voteringar där partilinjen stämde med utfallet' }, 'På vinnande sida'), h('dd', pct(sum.winRate))] : null));
    });

    const seatData = members.map((m) => ({ iid: m.iid, name: m.name, party: m.party, valkrets: m.valkrets }));
    const seatLegend = h('div.legend', { style: { justifyContent: 'center', marginTop: '8px' } },
      SEAT_ORDER.filter((p) => seats.has(p)).map((p) => h('span', h('span.sw', { style: { background: partyInfo(p).color } }), `${p === '-' ? 'Vildar' : p} ${seats.get(p).length}`)));

    mount(body,
      h('div.grid.two',
        h('div.card',
          h('h2', 'Riksdagen i dag'),
          h('p.muted', { style: { fontSize: '.88rem' } }, `${members.length} tjänstgörande ledamöter. Håll muspekaren över en plats för att se vem som sitter där – klicka för att öppna ledamotens röster.`),
          ui.hemicycle(seatData, { colorBy: 'party', label: 'Mandat per parti', centerText: String(members.length), centerSub: 'mandat' }),
          seatLegend),
        h('div.card',
          h('h2', 'Hur ofta partierna röstar lika'),
          h('p.muted', { style: { fontSize: '.88rem' } }, `Andel voteringar under ${rm} där båda partierna hade samma linje (Ja, Nej eller Avstår).`),
          heatmap(pc))),
      h('section.section',
        h('h2', 'Partiledare', h('small.muted', 'Klicka på ett parti för partilinjen och avvikarna')),
        h('div.grid.cards', cards)));
  };
})(window.RF);
