/* Ett parti: partiledare, partilinjen i varje votering och ledamöter som har brutit mot den. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, pct, fmtNum, fmtDate, plural, norm, partyInfo, rmSlug, PARTY_ORDER, debounce } = RF;
  RF.views = RF.views || {};

  function leaderCard(entry, comp, served, rm) {
    const p = entry.person;
    const sat = served.has(p.iid);
    let seat;
    if (comp.live) seat = sat ? `Riksdagsledamot${p.valkrets ? ' · ' + p.valkrets : ''}` : `${p.status || 'Inte tjänstgörande ledamot'} – röstar inte i kammaren under uppdraget; en ersättare har platsen.`;
    else seat = sat ? `Satt i riksdagen under riksmötet ${rm}` : `Röstade inte i kammaren under riksmötet ${rm} – till exempel som statsråd, då en ersättare har platsen.`;
    const record = h('div.stack', { style: { marginTop: '8px' } }, ui.loading('Hämtar röstningshistorik…'));
    const card = h('div.card.leader-hero',
      ui.avatar(p, 'xl'),
      h('div.info',
        h('div.role', `${entry.role} ${ui.tenure(entry, rm)}`.trim()),
        h('h2', { style: { margin: '2px 0 4px', fontSize: '1.4rem' } }, h('a', { href: `#/member/${p.iid}` }, p.name)),
        h('div.muted', { style: { fontSize: '.9rem' } }, seat),
        record,
        h('div.row', { style: { marginTop: '8px' } },
          h('a.btn.small', { href: `#/member/${p.iid}` }, 'Profil och alla röster'),
          h('a.btn.small', { href: RF.memberUrl(p.iid), target: '_blank', rel: 'noopener' }, 'riksdagen.se ↗'))));
    return { card, record };
  }

  async function fillLeaderRecord(target, p, rm, pc, indexById, alive) {
    try {
      const votes = await api.memberVotes(p.iid, rm);
      if (!alive()) return;
      if (!votes.length) { mount(target, h('span.faint', `Inga registrerade röster under ${rm}.`)); return; }
      const rec = analysis.memberRecord(votes, pc, indexById);
      mount(target, h('div.row',
        h('span.tag', `${rm}: ${plural(rec.total, 'votering', 'voteringar')}`),
        h('span.tag', `Närvaro ${pct(rec.attendance)}`),
        h('span.tag', { 'data-tip': 'Andel avlagda röster som följde partilinjen' }, `Med partiet ${pct(rec.loyalty)}`),
        rec.deviations.length ? ui.rebelBadge(rec.deviations.length, `Bröt linjen ${rec.deviations.length} ${rec.deviations.length === 1 ? 'gång' : 'gånger'}`) : h('span.tag.good', 'Har aldrig brutit partilinjen')));
    } catch (e) {
      mount(target, h('span.faint', 'Röstningshistoriken kunde inte hämtas.'));
    }
  }

  function lineTable(el, votes, party, rm) {
    const search = h('input', { type: 'search', placeholder: 'Sök voteringar', 'aria-label': 'Sök voteringar' });
    const show = h('select', { 'aria-label': 'Filter' },
      [['', 'Alla voteringar'], ['rebels', 'Voteringar med avvikare'], ['lost', 'Partiet förlorade'], ['split', 'Partiet delat eller avstod'],
        ['Ja', 'Partilinje Ja'], ['Nej', 'Partilinje Nej']].map(([v, l]) => h('option', { value: v }, l)));
    const wrap = h('div');
    const draw = () => {
      const term = norm(search.value.trim());
      const f = show.value;
      const list = votes.filter((x) => (!term || x.key.includes(term)) &&
        (!f || (f === 'rebels' ? x.pl.dev > 0 : f === 'lost' ? x.lost : f === 'split' ? x.pl.split || x.pl.line === 'Avstår' : x.pl.line === f)));
      mount(wrap, ui.sortableTable([
        { key: 'date', label: 'Datum', render: (x) => h('span.nowrap.muted', fmtDate(x.v.date)), sort: (x) => x.v.date },
        { key: 'title', label: 'Votering', render: (x) => h('a', { href: `#/vote/${rmSlug(rm)}/${x.v.id}` }, x.v.title, h('span.faint', ` · ${x.v.bet} p. ${x.v.punkt}`)), sort: (x) => x.v.title },
        { key: 'line', label: `${party}:s linje`, render: (x) => ui.votePill(x.pl.split ? null : x.pl.line), sort: (x) => x.pl.line || 'zz' },
        { key: 'party', label: `${party}:s röster`, render: (x) => h('div', { style: { minWidth: '110px' } }, ui.voteBar(x.c)) },
        { key: 'result', label: 'Utfall', render: (x) => (x.lost ? h('span.tag.bad', 'Förlorade') : x.won ? h('span.tag.good', 'Vann') : h('span.faint', '—')), sort: (x) => (x.lost ? 0 : x.won ? 2 : 1) },
        { key: 'dev', label: 'Avvikare', num: true, render: (x) => (x.pl.dev ? ui.rebelBadge(x.pl.dev, String(x.pl.dev)) : h('span.faint', '0')), sort: (x) => x.pl.dev },
      ], list, { sortKey: 'date', dir: -1, pageSize: 50, emptyText: 'Inga voteringar matchar.' }));
    };
    search.addEventListener('input', debounce(draw, 150));
    show.addEventListener('change', draw);
    mount(el, h('div.filters', search, show), wrap);
    draw();
  }

  function outliersSection(el, rm, party, members, alive) {
    mount(el, ui.progress(0, 1, 'Letar efter ledamöter som brutit partilinjen'));
    analysis.partyOutliers(rm, party, (d, t) => { if (alive()) mount(el, ui.progress(d, t, 'Går igenom voteringar där partiet inte var enigt')); })
      .then((res) => {
        if (!alive()) return;
        if (!res.members.length) {
          mount(el, ui.empty(`Ingen i ${party} röstade mot partilinjen under ${rm}.`));
          return;
        }
        const byIid = new Map(members.map((m) => [m.iid, m]));
        const voteById = new Map(res.votes.map((x) => [x.vote.id, x]));
        const rows = res.members.map((m) => ({ ...m, ...(byIid.get(m.iid) || {}), name: m.name, count: m.items.length }));
        const memberTable = ui.sortableTable([
          { key: 'name', label: 'Ledamot', render: (r) => ui.personCell(r, r.valkrets), sort: (r) => r.name },
          { key: 'count', label: 'Bröt linjen', num: true, render: (r) => h('b', r.count), sort: (r) => r.count },
          {
            key: 'how', label: 'Röstade i stället', render: (r) => {
              const t = { Ja: 0, Nej: 0, 'Avstår': 0 };
              r.items.forEach((i) => { t[i.vote]++; });
              return h('div.row', Object.entries(t).filter(([, n]) => n).map(([k, n]) => ui.votePill(k, h('span.faint', { style: { fontWeight: 400 } }, `×${n}`))));
            },
          },
          {
            key: 'latest', label: 'Voteringar', render: (r) => h('details.more',
              h('summary', `Visa ${r.items.length}`),
              h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '.85rem' } }, r.items.map((i) => {
                const x = voteById.get(i.id);
                return h('li', h('a', { href: `#/vote/${rmSlug(rm)}/${i.id}` }, x ? `${x.vote.title} (${x.vote.bet} p. ${x.vote.punkt})` : i.id),
                  ' – röstade ', h('b', i.vote), `, partiet ${i.line}`);
              }))),
          },
        ], rows, { sortKey: 'count', dir: -1, pageSize: 50 });

        const voteList = h('div');
        ui.pagedList(voteList, res.votes.slice().sort((a, b) => (b.vote.date || '').localeCompare(a.vote.date || '')), (x) =>
          h('div.card', { style: { padding: '12px 14px' } },
            h('div.row',
              h('a', { href: `#/vote/${rmSlug(rm)}/${x.vote.id}`, style: { fontWeight: 600 } }, x.vote.title),
              h('span.faint', { style: { fontSize: '.82rem' } }, `${x.vote.bet} punkt ${x.vote.punkt} · ${fmtDate(x.vote.date)}`),
              h('span.spacer'),
              h('span.muted', { style: { fontSize: '.82rem' } }, 'Partilinje '), ui.votePill(x.line)),
            h('div.row', { style: { marginTop: '6px' } }, x.rebels.map((r) =>
              h('a.party-line-chip', { href: `#/member/${r.iid}`, style: { color: 'var(--text)' } }, ui.votePill(r.vote), r.name)))), 20);

        mount(el,
          h('p.muted', { style: { fontSize: '.88rem' } }, `${plural(res.members.length, 'ledamot', 'ledamöter')} bröt partilinjen i ${plural(res.votes.length, 'votering', 'voteringar')}.`),
          memberTable,
          h('h3', { style: { marginTop: '20px' } }, 'Voteringar där ledamöter bröt mot partiet'),
          voteList);
      })
      .catch((err) => { if (alive()) mount(el, ui.errorBox(err, () => outliersSection(el, rm, party, members, alive))); });
  }

  RF.views.party = async function (ctx, code) {
    const { el, rm } = ctx;
    const party = RF.normParty(code);
    const info = partyInfo(party);
    document.title = `${info.name} – Riksförande`;
    mount(el, ui.loading(`Hämtar ${info.name}…`));
    let comp, leaders, pc, index;
    try {
      [comp, leaders, pc, index] = await Promise.all([api.composition(rm), api.leadersForRm(rm), api.partyCounts(rm), api.voteIndex(rm)]);
    } catch (err) {
      if (ctx.alive()) mount(el, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const members = comp.all;
    const indexById = new Map(index.map((v) => [v.id, v]));
    const served = new Set(comp.all.map((m) => m.iid));
    const seatCount = comp.seats.filter((m) => m.party === party).length;
    const partyMembers = comp.all.filter((m) => m.party === party).sort((a, b) => (a.partYear ? 1 : 0) - (b.partYear ? 1 : 0) || (a.sort || a.name).localeCompare(b.sort || b.name, 'sv'));
    const partYear = partyMembers.filter((m) => m.partYear).length;
    const L = leaders[party] || { leaders: [], groupLeaders: [] };
    const tallies = pc[party] || {};
    const sum = analysis.partySummary(pc, party, index);

    // Partilinjen i varje votering
    const lineVotes = index.filter((v) => tallies[v.id]).map((v) => {
      const pl = analysis.partyLine(tallies[v.id]);
      const res = analysis.outcome(v.c);
      const decisive = pl.line === 'Ja' || pl.line === 'Nej';
      return { v, c: tallies[v.id], pl, won: decisive && pl.line === res, lost: decisive && (res === 'Ja' || res === 'Nej') && pl.line !== res, key: norm(`${v.title} ${v.bet}`) };
    }).filter((x) => x.pl.present);

    // Samstämmighet med andra partier
    const others = analysis.activeParties(pc).filter((p) => p !== party)
      .map((p) => ({ p, ...analysis.agreement(pc, party, p) })).filter((x) => x.rate != null).sort((a, b) => b.rate - a.rate);

    const leaderBlocks = L.leaders.map((x) => leaderCard(x, comp, served, rm));
    const lineEl = h('div');
    const outEl = h('div');

    const lc = sum.lineCount;
    mount(el,
      h('div.crumbs', h('a', { href: '#/parties' }, 'Partier'), '›', h('span', party)),
      h('div.page-head',
        h('div.row', { style: { gap: '14px' } },
          ui.partyBadge(party, { lg: true }),
          h('div', h('h1', RF.partyNameIn(party, rm)), h('p', { style: { margin: 0 } },
            comp.live ? `${seatCount} mandat i riksdagen i dag` : `${seatCount} mandat vid slutet av riksmötet ${rm}`))),
        h('div.chips', PARTY_ORDER.filter((p) => p !== party).map((p) => h('a', { href: `#/party/${p}`, 'aria-label': partyInfo(p).name }, ui.partyBadge(p))))),

      h('section',
        h('h2', party === 'MP' ? 'Språkrör' : comp.live ? 'Partiledare' : `Partiledare under ${rm}`),
        L.leaders.length ? h('div.leaders', leaderBlocks.map((b) => b.card)) : ui.empty('Ingen partiledare finns angiven i riksdagens öppna data för den här perioden.'),
        L.groupLeaders.length ? h('p.muted', { style: { marginTop: '10px', fontSize: '.9rem' } }, 'Gruppledare i riksdagen: ',
          L.groupLeaders.map((g, i) => [i ? ', ' : '', h('a', { href: `#/member/${g.person.iid}` }, g.person.name),
            comp.live ? null : h('span.faint', ` (${ui.tenure(g, rm)})`)])) : null),

      h('section.section',
        h('h2', `Partilinjen ${rm}`),
        sum.votes ? h('div.tiles',
          ui.tile('Voteringar', fmtNum(sum.votes), `${lc.Ja} Ja · ${lc.Nej} Nej · ${lc['Avstår']} Avstår`),
          ui.tile('Helt enigt', pct(sum.cohesion), 'alla röstande ledamöter följde linjen'),
          ui.tile('Voteringar med avvikare', fmtNum(sum.devVotes), `${fmtNum(sum.devTotal)} avvikande röster totalt`),
          ui.tile('På vinnande sida', pct(sum.winRate), 'partilinjen stämde med utfallet'),
          sum.split ? ui.tile('Delade voteringar', fmtNum(sum.split), 'ingen tydlig majoritet i partiet') : null)
          : ui.empty(`${info.name} har inga registrerade voteringar under ${rm}.`)),

      others.length ? h('section.section',
        h('div.grid.two',
          h('div.card',
            h('h3', `Hur ofta ${party} röstar som andra partier`),
            h('div.agree-bars', others.map((x) => h('div.agree-row', { 'data-tip': `${party} och ${x.p}: samma linje i ${fmtNum(x.same)} av ${fmtNum(x.both)} voteringar` },
              ui.partyBadge(x.p, { link: true }),
              h('div.track', h('div.fill', { style: { width: (x.rate * 100).toFixed(1) + '%' } })),
              h('span.num', { style: { textAlign: 'right' } }, pct(x.rate, 0)))))),
          h('div.card',
            h('h3', 'Vad partilinjen betyder'),
            h('p.muted', { style: { fontSize: '.9rem' } }, 'I varje votering är partilinjen det alternativ som flest av partiets närvarande ledamöter röstade för. Frånvarande räknas inte – frånvaro beror oftast på kvittning mellan blocken, inte på att man tycker annorlunda.'),
            h('p.muted', { style: { fontSize: '.9rem' } }, 'En avvikare är en ledamot som röstade Ja, Nej eller Avstår på ett annat sätt än partilinjen. Om partiets största alternativ får lika många röster räknas voteringen som delad och ingen markeras som avvikare.')))) : null,

      h('section.section',
        h('h2', 'Avvikare', h('small.muted', `Ledamöter i ${party} som röstade mot partilinjen under ${rm}`)),
        outEl),

      h('section.section',
        h('h2', 'Partilinjen votering för votering'),
        lineEl),

      partyMembers.length ? h('section.section',
        h('h2', comp.live ? `Ledamöter (${partyMembers.length})` : `Ledamöter under ${rm} (${partyMembers.length})`,
          partYear ? h('small.muted', `varav ${partYear} under en del av riksmötet, t.ex. ersättare`) : null),
        h('div.grid.cards', partyMembers.map((m) => h('a.card.member-card', { href: `#/member/${m.iid}` },
          ui.avatar(m), h('div.t', h('b', m.name), h('small', m.valkrets), m.partYear ? h('small', 'Del av riksmötet') : null))))) : null);

    // Partiledare som är statsråd kan ha röster från tidigare år, så vi letar alltid.
    leaderBlocks.forEach((b, i) => fillLeaderRecord(b.record, L.leaders[i].person, rm, pc, indexById, ctx.alive));
    lineTable(lineEl, lineVotes, party, rm);
    if (sum.votes) outliersSection(outEl, rm, party, members, ctx.alive);
    else mount(outEl, ui.empty('Inga voteringar att analysera.'));
  };
})(window.RF);
