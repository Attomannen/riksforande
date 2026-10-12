/* Ett ärende: ett betänkande med alla beslutspunkter, partiernas linjer och alla dokument. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, fmtDate, int, committee, explainCaption, rmSlug, safeHtml, PARTY_ORDER } = RF;
  RF.views = RF.views || {};

  function partyLineChips(pc, id) {
    const lines = analysis.linesForVote(pc, id);
    return h('div.party-lines', PARTY_ORDER.filter((p) => lines[p]).map((p) => {
      const pl = lines[p];
      return h('span.party-line-chip', { 'data-tip': `${RF.partyInfo(p).name}: ${pl.split ? 'delade sig' : pl.line}${pl.dev ? `\n${pl.dev} avvikare` : ''}` },
        ui.partyBadge(p), ui.votePill(pl.split ? null : pl.line), pl.dev ? h('span.rebel-badge', `${pl.dev}`) : null);
    }));
  }

  function pointCard(p, vote, pc, rm, reservations) {
    const cap = explainCaption(p.caption || (vote && vote.caption));
    const res = reservations.filter((r) => r.punkt === p.punkt);
    const rebels = vote ? analysis.rebelsForVote(pc, vote.id) : 0;
    const result = vote ? analysis.outcome(vote.c) : null;
    const vil = RF.vilandeKind(p.forslag);
    return h('article.card.point-card', { id: `point-${p.punkt}` },
      h('header',
        h('h3', { style: { margin: 0 } }, `Punkt ${p.punkt}`, p.rubrik ? `: ${p.rubrik}` : ''),
        vil ? h('span.tag', { 'data-tip': 'Grundlagsändringar kräver två beslut med ett riksdagsval emellan' }, vil === 'first' ? 'Grundlag: första beslutet (vilande)' : 'Grundlag: slutligt beslut') : null,
        h('span.spacer'),
        vote ? ui.votePill(result === 'Lika' ? null : result, h('span.num.faint', { style: { fontWeight: 400 } }, `${vote.c[0]}–${vote.c[1]}`))
          : h('span.tag', { 'data-tip': 'Beslutades utan votering (med acklamation)' }, 'Utan votering'),
        rebels ? ui.rebelBadge(rebels) : null),
      vote ? h('div.stack',
        cap ? h('div.muted', { style: { fontSize: '.88rem' } }, cap.text, cap.ja ? ` — Ja = ${cap.ja}, Nej = ${cap.nej}` : '') : null,
        ui.voteBar(vote.c, { thick: true }),
        partyLineChips(pc, vote.id),
        h('div', h('a.btn.small', { href: `#/vote/${rmSlug(rm)}/${vote.id}` }, 'Så röstade varje ledamot, avvikare och detaljer →'))) : null,
      h('details.more', { style: { marginTop: '8px' } },
        h('summary', 'Utskottets förslag' + (res.length ? ` och ${res.length} ${res.length === 1 ? 'motförslag' : 'motförslag'}` : '')),
        h('div.forslag', safeHtml(p.forslag)),
        res.length ? h('p.muted', { style: { marginTop: '8px', fontSize: '.88rem' } },
          res.map((r, i) => [i ? h('br') : null, `${r.typ === 'reservation' ? 'Reservation' : r.typ} ${r.nummer}${r.rubrik ? ` ”${r.rubrik}”` : ''}: `, r.parties.map((x, j) => [j ? ' ' : '', ui.partyBadge(x)])])) : null));
  }

  RF.views.matter = async function (ctx, rm, bet) {
    const { el } = ctx;
    mount(el, ui.loading('Hämtar betänkandet…'));
    let index, pc, m;
    try {
      [index, pc] = await Promise.all([api.voteIndex(rm), api.partyCounts(rm)]);
      const any = index.find((v) => v.bet === bet);
      m = await api.matter(rm, bet, any && any.dokId);
    } catch (err) {
      if (ctx.alive()) mount(el, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const votes = index.filter((v) => v.bet === bet).sort((a, b) => int(a.punkt) - int(b.punkt));
    if (!m && !votes.length) {
      mount(el, ui.errorBox(new Error(`Betänkande ${rm}:${bet} hittades inte.`)));
      return;
    }
    const com = committee((m && m.organ) || (votes[0] && votes[0].organ));
    document.title = `${(m && m.title) || (votes[0] && votes[0].title)} (${bet}) – Riksförande`;
    const byVoteId = new Map(votes.map((v) => [v.id, v]));
    const points = m && m.points.length
      ? m.points
      : votes.map((v) => ({ punkt: String(v.punkt), rubrik: '', voteId: v.id, forslag: '' }));

    const voted = points.filter((p) => p.voteId);
    const totalRebels = votes.reduce((n, v) => n + analysis.rebelsForVote(pc, v.id), 0);
    const props = m ? m.refs.filter((r) => r.type === 'behandlar' && r.doktyp === 'prop') : [];
    const mots = m ? m.refs.filter((r) => r.type === 'behandlar' && r.doktyp === 'mot') : [];
    const vilande = points.map((p) => RF.vilandeKind(p.forslag)).find(Boolean);
    const decided = m && m.decidedAt ? m.decidedAt : votes[0] && votes[0].date;
    const nextElection = RF.electionAfter(decided);
    const vilandeBox = vilande ? h('div.callout', { style: { marginTop: '16px' } },
      h('b', vilande === 'first' ? 'Grundlagsändring – första av två beslut. ' : 'Grundlagsändring – andra och slutliga beslutet. '),
      'En ändring av grundlagen måste antas två gånger med ett riksdagsval emellan. ',
      vilande === 'first'
        ? `Riksdagen antog här förslaget som vilande. Det blir gällande först om den riksdag som väljs${nextElection ? ` ${fmtDate(nextElection)}` : ' vid nästa val'} antar det en gång till. `
        : 'Här fattade den nyvalda riksdagen det andra beslutet om det vilande förslaget. ',
      props.map((p, i) => [i ? ' · ' : '', h('a', { href: `#/prop/${p.dokId}` }, `Följ prop. ${p.rm}:${p.bet} →`)])) : null;

    mount(el,
      h('div.crumbs', h('a', { href: '#/votes' }, 'Voteringar'), '›', h('span', `${rm}:${bet}`)),
      h('div.page-head',
        h('div',
          h('h1', (m && m.title) || (votes[0] && votes[0].title)),
          h('p', `${(m && m.typrubrik) || 'Betänkande ' + rm + ':' + bet} · ${com.sv}`, m && m.decidedAt ? ` · beslutat ${fmtDate(m.decidedAt)}` : '')),
        h('div.row',
          h('a.btn.small', { href: '#documents', onclick: (e) => { e.preventDefault(); document.getElementById('documents').scrollIntoView({ behavior: 'smooth' }); } }, 'Dokument ↓'))),
      h('div.tiles',
        ui.tile('Beslutspunkter', points.length, `${voted.length} avgjordes genom votering`),
        ui.tile('Avvikande röster', totalRebels, 'ledamöter mot partilinjen'),
        ui.tile('Propositioner', props.length, props.map((p) => `prop. ${p.rm}:${p.bet}`).join(', ') || 'inga'),
        ui.tile('Motioner som behandlades', mots.length, 'från ledamöter')),
      vilandeBox,
      m && m.decisionSummary ? h('div.card', { style: { marginTop: '16px' } },
        h('h2', 'Beslut i korthet'),
        h('div.doc-text', safeHtml(m.decisionSummary)),
        m.chamberDecision ? h('span.tag.good', m.chamberDecision) : null) : null,
      h('section.section',
        h('h2', 'Beslutspunkter', h('small.muted', 'Varje punkt beslutas för sig – de flesta utan votering')),
        points.length ? null : ui.empty('Beslutspunkterna har inte publicerats ännu – de visas här när betänkandet är klart.'),
        points.map((p) => pointCard(p, p.voteId ? byVoteId.get(p.voteId) || votes.find((v) => String(v.punkt) === p.punkt) : null, pc, rm, m ? m.reservations : []))),
      h('section.section', ui.docsPanel(m, { skipSummary: !!(m && m.decisionSummary) })));
  };
})(window.RF);
