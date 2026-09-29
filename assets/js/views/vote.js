/* En votering: resultat, partiernas röster, avvikare, varje ledamots röst och dokumenten bakom beslutet. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, OPTIONS, fmtDate, int, norm, committee, explainCaption, rmSlug, partyInfo, SEAT_ORDER, debounce } = RF;
  RF.views = RF.views || {};

  const VOTES = ['Ja', 'Nej', 'Avstår', 'Frånvarande'];
  const tally = (rows) => {
    const c = [0, 0, 0, 0];
    for (const r of rows) c[VOTES.indexOf(r.vote)] += 1;
    return c;
  };

  function winnerText(point, c) {
    if (point && point.winner) {
      if (/^utskott/i.test(point.winner)) {
        const vil = RF.vilandeKind(point.forslag);
        if (vil === 'first') return 'Riksdagen antog grundlagsändringen som vilande – första av två beslut';
        if (vil === 'final') return 'Riksdagen antog slutligt grundlagsändringen – andra och sista beslutet';
        return 'Riksdagen biföll utskottets förslag';
      }
      if (/^reservation/i.test(point.winner)) return `Riksdagen biföll ${point.winner}`;
      return `Vinnare: ${point.winner}`;
    }
    const w = analysis.outcome(c);
    return w === 'Lika' ? 'Lika röstetal' : `${w} vann`;
  }

  const SECTIONS = [['Resultat', 'sec-result'], ['Partier', 'sec-parties'], ['Avvikare', 'sec-outliers'], ['Dokument', 'documents'], ['Ledamöter', 'sec-members']];

  RF.views.vote = async function (ctx, rm, id) {
    const { el } = ctx;
    mount(el, ui.loading('Hämtar voteringen…'));
    let index, members, v, rows, m;
    try {
      [index, members] = await Promise.all([api.voteIndex(rm), api.members().catch(() => [])]);
      v = index.find((x) => x.id === id);
      if (!v) throw new Error(`Voteringen ${id} hittades inte i riksmötet ${rm}.`);
      [rows, m] = await Promise.all([
        api.voteRows(rm, v.bet, v.punkt, id),
        v.bet ? api.matter(rm, v.bet, v.dokId).catch(() => null) : Promise.resolve(null),
      ]);
    } catch (err) {
      if (ctx.alive()) mount(el, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const byIid = new Map(members.map((p) => [p.iid, p]));
    const withPhoto = (r) => ({ ...r, ...(byIid.get(r.iid) ? { img: byIid.get(r.iid).img, imgSmall: byIid.get(r.iid).imgSmall } : {}) });
    const point = m ? m.points.find((p) => p.voteId === id) || m.points.find((p) => p.punkt === String(v.punkt)) : null;
    const caption = (point && point.caption) || v.caption;
    const cap = explainCaption(caption);
    const c = rows.length ? tally(rows) : v.c;

    // ----- partiernas röster, direkt från den här voteringens rader
    const byParty = RF.groupBy(rows, (r) => r.party);
    const parties = [...byParty.keys()].sort((a, b) => {
      const ia = RF.PARTY_ORDER.indexOf(a), ib = RF.PARTY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const partyStats = parties.map((p) => {
      const pc = tally(byParty.get(p));
      const pl = p === '-' ? { line: null, split: false, dev: 0, present: true, cast: 0 } : analysis.partyLine(pc);
      return { party: p, c: pc, ...pl };
    });
    const lineOf = Object.fromEntries(partyStats.map((x) => [x.party, x]));
    const isRebel = (r) => OPTIONS.includes(r.vote) && lineOf[r.party] && lineOf[r.party].line && r.vote !== lineOf[r.party].line;
    const rebels = rows.filter(isRebel).map(withPhoto);

    // ----- rubrik
    const com = committee(v.organ);
    const matterHref = v.bet ? `#/matter/${rmSlug(rm)}/${encodeURIComponent(v.bet)}` : null;
    const siblings = index.filter((x) => x.bet && x.bet === v.bet).sort((a, b) => int(a.punkt) - int(b.punkt));
    const noVotePoints = m ? m.points.filter((p) => !p.voteId) : [];
    const pointLabel = v.punkt && v.punkt !== '0' ? `Punkt ${v.punkt}` : 'Votering';
    document.title = `${(m && m.title) || v.title} – ${pointLabel} – Riksförande`;

    const header = h('div',
      h('div.crumbs', h('a', { href: '#/votes' }, 'Voteringar'), '›', matterHref ? h('a', { href: matterHref }, `${rm}:${v.bet}`) : h('span', rm), '›', h('span', pointLabel)),
      h('div.page-head',
        h('div',
          h('h1', (m && m.title) || v.title),
          h('p',
            point && point.rubrik ? h('b', `Punkt ${point.punkt}: ${point.rubrik}`) : h('b', pointLabel),
            ' · ', fmtDate(v.date), v.organ ? ` · ${com.sv}` : '')),
        h('nav.row', { 'aria-label': 'Avsnitt' },
          SECTIONS.map(([label, target]) => h('a.btn.small', { href: '#', onclick: (e) => { e.preventDefault(); const t = document.getElementById(target); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, label)))),
      siblings.length > 1 || noVotePoints.length
        ? h('div.points-nav', { style: { marginBottom: '16px' } },
          h('span.muted', { style: { fontSize: '.82rem', alignSelf: 'center' } }, 'Punkter i betänkandet:'),
          (m ? m.points : siblings.map((s) => ({ punkt: s.punkt, voteId: s.id }))).map((p) => {
            const sib = siblings.find((s) => s.id === p.voteId) || siblings.find((s) => s.punkt === p.punkt);
            return sib
              ? h('a', { href: `#/vote/${rmSlug(rm)}/${sib.id}`, class: sib.id === id ? 'active' : '', 'data-tip': p.rubrik || '' }, `${p.punkt}`)
              : h('a.novote', { href: matterHref, 'data-tip': `${p.rubrik || 'Punkt ' + p.punkt}\nAvgjordes utan votering` }, `${p.punkt}`);
          }))
        : null);

    // ----- resultat
    const onReasoning = v.avser === 'motiveringen' || (point && point.avser === 'motiveringen');
    const vilande = point ? RF.vilandeKind(point.forslag) : null;
    const propRef = m && m.refs.find((r) => r.type === 'behandlar' && r.doktyp === 'prop');
    const vilandeBox = vilande ? h('div.callout', { style: { marginBottom: '12px' } },
      h('b', vilande === 'first' ? 'Första av två beslut. ' : 'Andra och slutliga beslutet. '),
      'En grundlagsändring måste antas två gånger med ett riksdagsval emellan. ',
      vilande === 'first'
        ? `Här antogs förslaget som vilande – det gäller först om den riksdag som väljs ${RF.electionAfter(v.date) ? `i september ${RF.electionAfter(v.date).slice(0, 4)}` : 'vid nästa val'} antar det en gång till. `
        : 'Här antog den nyvalda riksdagen det vilande förslaget en andra gång, och ändringen kan därmed träda i kraft. ',
      propRef ? h('a', { href: `#/prop/${propRef.dokId}` }, 'Följ förslaget →') : null) : null;
    const resultCard = h('section.card#sec-result',
      h('div.hero-result',
        h('div',
          h('div.result-line', winnerText(point, c), point && point.majority && point.majority !== 'Enkel majoritet' ? h('span.tag', point.majority) : null),
          vilandeBox,
          h('div.explain',
            h('div', h('b', onReasoning ? 'Votering om motiveringen' : 'Votering i sakfrågan'), cap ? `: ${cap.text}` : ''),
            cap && cap.ja
              ? h('div', { style: { marginTop: '4px' } }, h('b', 'Ja'), ` = ${cap.ja} · `, h('b', 'Nej'), ` = ${cap.nej}`)
              : !cap ? h('div', { style: { marginTop: '4px' } }, h('b', 'Ja'), ' = utskottets förslag · ', h('b', 'Nej'), ' = alternativet som ställdes mot') : null),
          h('div.big-counts',
            [['ja', 'Ja'], ['nej', 'Nej'], ['avst', 'Avstår'], ['franv', 'Frånvarande']].map(([k, l], i) =>
              h('div', { class: k }, h('b', c[i]), h('span', l)))),
          ui.voteBar(c, { thick: true }),
          h('div', { style: { marginTop: '10px' } }, ui.voteLegend()),
          rebels.length ? h('p.muted', { style: { marginTop: '10px', fontSize: '.88rem' } },
            `Ringade platser: ${rebels.length} ${rebels.length === 1 ? 'ledamot' : 'ledamöter'} som röstade mot sitt parti.`) : null),
        h('div',
          ui.hemicycle(rows.map((r) => ({ ...r, line: lineOf[r.party] && lineOf[r.party].line, rebel: isRebel(r) })), {
            colorBy: 'vote', label: 'Platsdiagram över hur varje ledamot röstade',
            centerText: `${c[0]}–${c[1]}`, centerSub: 'Ja – Nej',
          }),
          h('p.faint', { style: { fontSize: '.78rem', textAlign: 'center', margin: '4px 0 0' } },
            'Platserna är grupperade efter parti, från vänster: ',
            SEAT_ORDER.filter((p) => byParty.has(p)).map((p) => (p === '-' ? 'vildar' : p)).join(' · '),
            '. Håll muspekaren över en plats för detaljer.'))));

    // ----- partitabell
    const partyTable = h('section.section#sec-parties',
      h('h2', 'Så röstade partierna', h('small.muted', 'Partilinje = det alternativ som flest av partiets röstande ledamöter valde')),
      h('div.table-wrap', h('table.data',
        h('thead', h('tr', h('th', 'Parti'), h('th', { style: { width: '32%' } }, 'Fördelning'), h('th.n', 'Ja'), h('th.n', 'Nej'), h('th.n', 'Avstår'), h('th.n', 'Frånv.'), h('th', 'Partilinje'), h('th.n', 'Avvikare'))),
        h('tbody', partyStats.map((x) => h('tr',
          h('td', h('div.row', { style: { flexWrap: 'nowrap' } }, ui.partyBadge(x.party, { link: true }), h('span.muted', { style: { fontSize: '.82rem' } }, partyInfo(x.party).name))),
          h('td', ui.voteBar(x.c, { tipPrefix: partyInfo(x.party).name })),
          h('td.n', x.c[0] || '·'), h('td.n', x.c[1] || '·'), h('td.n', x.c[2] || '·'), h('td.n.faint', x.c[3] || '·'),
          h('td', x.party === '-' ? h('span.faint', '–') : x.present && x.cast ? ui.votePill(x.line) : h('span.faint', 'Alla frånvarande')),
          h('td.n', x.dev ? ui.rebelBadge(x.dev, String(x.dev)) : h('span.faint', '0'))))))));

    // ----- avvikare
    const outliers = h('section.section#sec-outliers',
      h('h2', 'Avvikare', h('small.muted', 'Ledamöter som röstade annorlunda än sitt parti')),
      rebels.length
        ? h('div.outlier-list', rebels.map((r) => h('a.outlier', { href: `#/member/${r.iid}` },
          ui.avatar(r),
          h('div.who', h('b', r.name), h('small.muted', r.valkrets || '')),
          h('div.stack', { style: { textAlign: 'right' } },
            h('div', ui.partyBadge(r.party)),
            h('div', ui.votePill(r.vote)),
            h('div.faint', { style: { fontSize: '.75rem' } }, `partiet: ${lineOf[r.party].line}`)))))
        : ui.empty('Inga avvikare – alla ledamöter som röstade följde sitt partis linje.'));

    // ----- alla ledamöter
    const search = h('input', { type: 'search', placeholder: 'Sök ledamot eller valkrets', 'aria-label': 'Sök ledamot' });
    const partySel = h('select', { 'aria-label': 'Parti' }, h('option', { value: '' }, 'Alla partier'), parties.map((p) => h('option', { value: p }, `${p === '-' ? '–' : p} – ${partyInfo(p).name}`)));
    const voteSel = h('select', { 'aria-label': 'Röst' }, h('option', { value: '' }, 'Alla röster'),
      VOTES.map((o) => h('option', { value: o }, o)), h('option', { value: 'rebel' }, 'Endast avvikare'));
    const tableWrap = h('div');
    const allRows = rows.map((r) => ({ ...withPhoto(r), rebel: isRebel(r), key: norm(`${r.name} ${r.valkrets}`) }));
    const drawTable = () => {
      const term = norm(search.value.trim());
      const list = allRows.filter((r) => (!term || r.key.includes(term)) && (!partySel.value || r.party === partySel.value) &&
        (!voteSel.value || (voteSel.value === 'rebel' ? r.rebel : r.vote === voteSel.value)));
      mount(tableWrap, ui.sortableTable([
        { key: 'name', label: 'Ledamot', render: (r) => ui.personCell(r, r.valkrets), sort: (r) => r.last + ' ' + r.first },
        { key: 'party', label: 'Parti', render: (r) => ui.partyBadge(r.party), sort: (r) => SEAT_ORDER.indexOf(r.party) },
        { key: 'vote', label: 'Röst', render: (r) => ui.votePill(r.vote), sort: (r) => VOTES.indexOf(r.vote) },
        { key: 'line', label: 'Partilinje', render: (r) => (lineOf[r.party] && lineOf[r.party].line ? h('span.muted', lineOf[r.party].line) : h('span.faint', '—')) },
        { key: 'rebel', label: '', render: (r) => (r.rebel ? h('span.rebel-badge', 'Bröt linjen') : '') },
      ], list, { sortKey: 'party', pageSize: 60, rowClass: (r) => (r.rebel ? 'is-rebel' : ''), emptyText: 'Inga ledamöter matchar.' }));
    };
    search.addEventListener('input', debounce(drawTable, 120));
    partySel.addEventListener('change', drawTable);
    voteSel.addEventListener('change', drawTable);

    const membersSection = h('section.section#sec-members',
      h('h2', 'Så röstade varje ledamot', h('small.muted', `${rows.length} ledamöter`)),
      h('div.filters', search, partySel, voteSel),
      tableWrap);

    mount(el, header, resultCard, partyTable, outliers,
      h('section.section', docsPanelWithLink(m, v, rm)),
      membersSection);
    drawTable();
  };

  function docsPanelWithLink(m, v, rm) {
    const panel = RF.ui.docsPanel(m, { point: v.punkt });
    if (m && v.bet) {
      panel.querySelector('h2').appendChild(h('a.btn.small', { href: `#/matter/${rmSlug(rm)}/${encodeURIComponent(v.bet)}`, style: { marginLeft: '10px', verticalAlign: 'middle' } }, 'Alla punkter i betänkandet →'));
    }
    return panel;
  }
})(window.RF);
