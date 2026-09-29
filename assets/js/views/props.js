/* Propositioner: government bills and communications that have reached the Riksdag but not yet been decided. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, fmtDate, fmtNum, plural, norm, debounce, rmSlug, normParty } = RF;
  RF.views = RF.views || {};

  const TTL = 6 * 3600e3; // pending matters move quickly; refresh their status a few times a day
  const today = () => new Date().toISOString().slice(0, 10);

  function actDate(list, code) {
    const a = (list || []).find((x) => x.code === code);
    return a && a.date ? a.date : null;
  }
  /** Committee reports handling a bill, oldest first. A constitutional amendment gets one for each of its two votes. */
  function betRefs(info) {
    const seen = new Set();
    return (info ? info.refs : [])
      .filter((r) => r.type === 'behandlas_i' && r.doktyp === 'bet' && !seen.has(r.dokId) && seen.add(r.dokId))
      .sort((a, b) => (a.rm || '').localeCompare(b.rm || '') || a.dokId.localeCompare(b.dokId));
  }
  const betRef = (info) => betRefs(info).slice(-1)[0]; // the latest report

  /** Load the status of every committee report linked to a bill. */
  async function loadBets(item) {
    item.bets = await Promise.all(betRefs(item.info).map((r) => api.docStatus(r.dokId, TTL).catch(() => null)));
    item.betInfo = item.bets.length ? item.bets[item.bets.length - 1] : null;
  }

  const isDecided = (b) => b && (/avslutat/i.test(b.status || '') || (actDate(b.activity, 'BES') || '9999') < today());

  /**
   * Constitutional amendments must be adopted twice, with a general election in between.
   * Returns null for ordinary bills, otherwise where the amendment is in that two-vote process.
   */
  function amendment(item) {
    const bets = (item.bets || []).filter(Boolean);
    const says = (b, kind) => b.points.some((p) => RF.vilandeKind(p.forslag) === kind) || RF.vilandeKind(b.committeeProposal) === kind;
    const first = bets.find((b) => says(b, 'first'));
    const final = bets.find((b) => says(b, 'final'));
    const proposed = item.info && item.info.proposals.some((p) => RF.vilandeKind(p.text) === 'first');
    if (!first && !final && !proposed) return null;
    const firstDone = isDecided(first);
    const firstDate = first ? actDate(first.activity, 'BES') || first.decidedAt : null;
    return {
      first,
      firstDone,
      firstDate,
      election: RF.electionAfter(firstDone && firstDate ? firstDate : today()),
      second: final || bets.find((b) => b !== first) || null,
    };
  }

  /** Motions filed in response ("följdmotioner"); the subtitle reads like "av Karin Rågsjö m.fl. (V)". */
  function followUpMotions(info) {
    const seen = new Set();
    return (info ? info.refs : []).filter((r) => r.type === 'följdmotion' && !seen.has(r.dokId) && seen.add(r.dokId)).map((r) => {
      const m = /^av\s+(.+?)\s*\(([^)]*)\)\s*$/.exec(r.subtitle || '');
      return { ...r, author: m ? m[1] : r.subtitle || '', parties: m ? m[2].split(/\s*,\s*/).map(normParty) : [] };
    });
  }

  /** Where in the process a bill is; step indexes the steps from stepsFor(). */
  function stageOf(item) {
    const { info, betInfo } = item;
    // step 99 = past the last step, so every step shows as completed
    if (item.done || (info && (info.state === 'Klar' || /avslutat/i.test(info.status || '')))) return { step: 99, key: 'done', label: 'Beslutad' };
    if (!info) return { step: 0, key: 'loading', label: 'Hämtar status…' };
    const t = today();
    const mot = actDate(info.activity, 'MOT');
    const bes = betInfo && actDate(betInfo.activity, 'BES');
    const jus = betInfo && actDate(betInfo.activity, 'JUS');
    const tryck = betInfo && actDate(betInfo.activity, 'TRY');

    // Constitutional amendment past its first vote: it now rests ("vilande") until after an election.
    const a = amendment(item);
    if (a && a.firstDone) {
      if (a.election && a.election > t) {
        return { step: 4, key: 'vilande', label: `Vilande sedan ${fmtDate(a.firstDate)} – väntar på riksdagsvalet ${fmtDate(a.election)}` };
      }
      const s = a.second;
      const bes2 = s && actDate(s.activity, 'BES');
      const jus2 = s && actDate(s.activity, 'JUS');
      const try2 = s && actDate(s.activity, 'TRY');
      let label = 'Vilande – väntar på det andra, slutliga beslutet i den nyvalda riksdagen';
      if (bes2 && bes2 >= t) label = `Slutligt beslut planerat ${fmtDate(bes2)}`;
      else if (jus2 && jus2 <= t) label = 'Betänkandet inför det slutliga beslutet är klart';
      else if (s) label = `Den nya riksdagen bereder det slutliga beslutet${try2 && try2 >= t ? ` – betänkande väntas ${fmtDate(try2)}` : ''}`;
      return { step: 5, key: 'vilande', label };
    }

    // The report was decided but the bill is still open, e.g. part of it deferred ("uppskov").
    if (betInfo && isDecided(betInfo)) return { step: 4, key: 'partial', label: 'Delvis beslutad – en del av förslaget återstår' };
    if (bes) return { step: 3, key: 'report', label: `Planerat beslut i kammaren ${fmtDate(bes)}` };
    if (jus && jus <= t) return { step: 3, key: 'report', label: 'Betänkandet är klart – väntar på debatt och beslut' };
    if (mot && mot >= t) return { step: 1, key: 'motion', label: `Motionstid pågår till ${fmtDate(mot)}` };
    if (betRef(info) || /bereds/i.test(info.status || '')) {
      return { step: 2, key: 'committee', label: tryck && tryck >= t ? `Utskottet bereder – betänkandet väntas ${fmtDate(tryck)}` : 'Utskottet bereder ärendet' };
    }
    return { step: 0, key: 'submitted', label: info.status || 'Inlämnad till riksdagen' };
  }

  const STAGE_FILTERS = [['motion', 'Motionstid pågår'], ['committee', 'Utskottet bereder'], ['report', 'Betänkande klart'], ['vilande', 'Vilande grundlagsändring'], ['partial', 'Delvis beslutad'], ['submitted', 'Nyss inlämnad']];

  function stepsFor(item, st) {
    const info = item.info, bi = item.betInfo;
    const mot = info && actDate(info.activity, 'MOT');
    const bref = betRef(info);
    const tryck = bi && actDate(bi.activity, 'TRY');
    const bes = bi && actDate(bi.activity, 'BES');
    const a = amendment(item);
    if (a) {
      const s = a.second;
      const bes2 = s && actDate(s.activity, 'BES');
      const try2 = s && actDate(s.activity, 'TRY');
      return [
        { label: 'Inlämnad', sub: fmtDate(item.date) },
        { label: 'Motionstid', sub: mot ? `till ${fmtDate(mot)}` : '' },
        { label: 'Utskottet bereder', sub: info && info.assignedTo ? info.assignedTo : '' },
        { label: 'Första beslutet', sub: a.firstDone ? `vilande ${fmtDate(a.firstDate)}` : a.first ? `${a.first.rm}:${a.first.bet}` : '' },
        { label: 'Riksdagsval', sub: a.election ? fmtDate(a.election) : '' },
        { label: 'Slutligt beslut', sub: bes2 ? fmtDate(bes2) : s ? `${s.rm}:${s.bet}${try2 ? ` · väntas ${fmtDate(try2)}` : ''}` : 'i nya riksdagen' },
      ];
    }
    return [
      { label: 'Inlämnad', sub: fmtDate(item.date) },
      { label: 'Motionstid', sub: mot ? `till ${fmtDate(mot)}` : '' },
      { label: 'Utskottet bereder', sub: info && info.assignedTo ? info.assignedTo : '' },
      { label: 'Betänkande', sub: bref ? `${bref.rm}:${bref.bet}${tryck && st.step < 3 ? ` · väntas ${fmtDate(tryck)}` : ''}` : '' },
      { label: 'Beslut', sub: bes ? fmtDate(bes) : '' },
    ];
  }

  const kindLabel = (k) => (k === 'skr' ? 'Skrivelse' : 'Proposition');
  const shortRef = (item) => `${item.kind === 'skr' ? 'Skr.' : 'Prop.'} ${item.rm}:${item.nr}`;

  function motionBadges(mots) {
    const parties = [...new Set(mots.flatMap((m) => m.parties))];
    return parties.map((p) => ui.partyBadge(p));
  }

  function propCard(item) {
    const st = stageOf(item);
    const info = item.info;
    const mots = followUpMotions(info);
    const bref = betRef(info);
    return h('article.card.prop-card',
      h('div.row', { style: { alignItems: 'baseline', flexWrap: 'nowrap' } },
        h('span.kind-tag', kindLabel(item.kind)),
        h('h3', { style: { flex: 1, minWidth: 0 } }, h('a', { href: `#/prop/${item.dokId}` }, item.title))),
      h('div.meta', h('span', shortRef(item)), h('span', item.dep), h('span', `Inlämnad ${fmtDate(item.date)}`)),
      h('div.stage', ui.stepper(stepsFor(item, st), st.step, { compact: true })),
      h('div.prop-facts',
        h('span.row', { style: { gap: '6px' } }, st.key === 'loading' ? h('span.spinner') : null, h('b', st.label)),
        info && info.assignedTo ? h('span', info.assignedTo) : null,
        info ? h('span.row', { style: { gap: '4px' } }, mots.length ? plural(mots.length, 'motion', 'motioner') : 'Inga motioner', mots.length ? ':' : '', motionBadges(mots)) : null,
        bref ? h('span', `Betänkande ${bref.rm}:${bref.bet}`) : null));
  }

  // ---------------------------------------------------------------- list
  RF.views.props = async function (ctx) {
    const { el } = ctx;
    const body = h('div', ui.loading('Hämtar propositioner…'));
    mount(el,
      h('div.page-head', h('div',
        h('h1', 'Propositioner som väntar på beslut'),
        h('p', 'Förslag från regeringen som har lämnats till riksdagen men ännu inte avgjorts i kammaren – och var i processen de befinner sig: motionstid, utskottsberedning, betänkande och beslut. Visar pågående ärenden oavsett valt riksmöte.'))),
      body);

    let all;
    try {
      all = await api.propositions((d, t) => { if (ctx.alive()) mount(body, ui.progress(d, t, 'Hämtar propositioner')); });
    } catch (err) {
      if (ctx.alive()) mount(body, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const items = all.map((p) => ({ ...p, info: null, bets: [], betInfo: null, key: norm(`${p.title} ${p.rm}:${p.nr} ${p.dep}`) }));
    const pending = items.filter((x) => !x.done);
    const cards = new Map(); // item -> rendered card, so enriched items can be swapped in place

    // ----- filters (kept in the URL)
    const q = ctx.query;
    const search = h('input', { type: 'search', placeholder: 'Sök titel, nummer eller departement', value: q.get('q') || '', 'aria-label': 'Sök propositioner' });
    const statusSel = h('select', { 'aria-label': 'Status' },
      [['pending', 'Väntar på beslut'], ['done', 'Beslutade'], ['all', 'Alla']].map(([v, l]) => h('option', { value: v, selected: (q.get('status') || 'pending') === v }, l)));
    const kindSel = h('select', { 'aria-label': 'Typ' },
      [['prop', 'Propositioner'], ['skr', 'Skrivelser'], ['all', 'Propositioner och skrivelser']].map(([v, l]) => h('option', { value: v, selected: (q.get('typ') || 'prop') === v }, l)));
    const stageSel = h('select', { 'aria-label': 'Steg' }, h('option', { value: '' }, 'Alla steg'),
      STAGE_FILTERS.map(([v, l]) => h('option', { value: v, selected: q.get('steg') === v }, l)));
    const depSel = h('select', { 'aria-label': 'Departement' }, h('option', { value: '' }, 'Alla departement'),
      [...new Set(items.map((x) => x.dep).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv')).map((d) => h('option', { value: d, selected: q.get('dep') === d }, d)));
    const sortSel = h('select', { 'aria-label': 'Sortering' },
      [['new', 'Senast inlämnad'], ['old', 'Äldst först'], ['motion', 'Motionstiden går ut snart']].map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'new') === v }, l)));
    const countEl = h('span.muted', { style: { fontSize: '.85rem' } });
    const tilesEl = h('div.tiles', { style: { marginBottom: '16px' } });
    const statusEl = h('div', { style: { marginBottom: '12px' } });
    const listEl = h('div');

    const drawTiles = () => {
      const pp = pending.filter((x) => x.kind === 'prop');
      const count = (key) => pending.filter((x) => stageOf(x).key === key).length;
      const ready = pending.every((x) => x.info);
      mount(tilesEl,
        ui.tile('Väntar på beslut', fmtNum(pp.length), `propositioner (+ ${pending.length - pp.length} skrivelser)`),
        ui.tile('Motionstid pågår', ready ? fmtNum(count('motion')) : '…', 'partierna kan lämna motförslag'),
        ui.tile('Utskottet bereder', ready ? fmtNum(count('committee')) : '…', 'ärendet förbereds i utskott'),
        ui.tile('Betänkande klart', ready ? fmtNum(count('report')) : '…', 'väntar på debatt och votering'));
    };

    const motDate = (x) => (x.info && actDate(x.info.activity, 'MOT')) || '9999';
    const apply = () => {
      const term = norm(search.value.trim());
      const status = statusSel.value, kind = kindSel.value, stage = stageSel.value, dep = depSel.value;
      let list = items.filter((x) =>
        (status === 'all' || (status === 'done' ? x.done : !x.done)) &&
        (kind === 'all' || x.kind === kind) &&
        (!term || x.key.includes(term)) &&
        (!dep || x.dep === dep) &&
        (!stage || stageOf(x).key === stage));
      const sort = sortSel.value;
      if (sort === 'old') list = list.slice().sort((a, b) => a.date.localeCompare(b.date));
      else if (sort === 'motion') list = list.slice().sort((a, b) => motDate(a).localeCompare(motDate(b)) || b.date.localeCompare(a.date));
      else list = list.slice().sort((a, b) => b.date.localeCompare(a.date));
      countEl.textContent = `${fmtNum(list.length)} ${list.length === 1 ? 'ärende' : 'ärenden'}`;
      cards.clear();
      if (!list.length) mount(listEl, ui.empty(status === 'pending' ? 'Inga ärenden som väntar på beslut matchar filtren.' : 'Inga ärenden matchar filtren.'));
      else ui.pagedList(listEl, list, (x) => { const c = propCard(x); cards.set(x, c); return c; }, 25);
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      if (status !== 'pending') params.set('status', status);
      if (kind !== 'prop') params.set('typ', kind);
      if (stage) params.set('steg', stage);
      if (dep) params.set('dep', dep);
      if (sort !== 'new') params.set('sort', sort);
      ctx.setQuery(params);
    };
    search.addEventListener('input', debounce(apply, 150));
    [statusSel, kindSel, stageSel, depSel, sortSel].forEach((s) => s.addEventListener('change', apply));

    mount(body,
      tilesEl,
      h('div.filters', search, statusSel, kindSel, stageSel, depSel, sortSel, h('span.spacer'), countEl),
      statusEl,
      listEl);
    drawTiles();
    apply();

    // ----- look up each pending item's stage (bill status + its committee report, if any)
    let done = 0;
    const refresh = (x) => {
      const old = cards.get(x);
      if (old && old.isConnected) { const c = propCard(x); old.replaceWith(c); cards.set(x, c); }
    };
    mount(statusEl, ui.progress(0, pending.length, 'Hämtar status för varje ärende'));
    await Promise.all(pending.map(async (x) => {
      try {
        x.info = await api.docStatus(x.dokId, TTL);
        await loadBets(x);
      } catch (e) {
        x.info = x.info || { refs: [], activity: [], status: 'Status kunde inte hämtas' };
      }
      done++;
      if (!ctx.alive()) return;
      refresh(x);
      mount(statusEl, done < pending.length ? ui.progress(done, pending.length, 'Hämtar status för varje ärende') : null);
    }));
    if (!ctx.alive()) return;
    drawTiles();
    if (stageSel.value || sortSel.value === 'motion') apply();
  };

  // ---------------------------------------------------------------- detail
  RF.views.prop = async function (ctx, dokId) {
    const { el } = ctx;
    mount(el, ui.loading('Hämtar propositionen…'));
    let info;
    const kindOf = (i) => (i.subtyp === 'skr' || i.doktyp === 'skr' ? 'skr' : 'prop');
    const item = { dokId, bets: [], betInfo: null };
    try {
      info = await api.docStatus(dokId, TTL);
      if (!info) throw new Error('Dokumentet hittades inte i riksdagens öppna data.');
      Object.assign(item, { rm: info.rm, nr: info.bet, title: info.title, date: info.date, dep: info.submittedBy || info.organ, kind: kindOf(info), done: info.state === 'Klar', info });
      await loadBets(item);
    } catch (err) {
      if (ctx.alive()) mount(el, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    const kind = item.kind;
    const st = stageOf(item);
    const amend = amendment(item);
    const refs = betRefs(info);
    const bref = betRef(info);
    const mots = followUpMotions(info);
    const signers = info.people.filter((p) => /statsråd/i.test(p.role || ''));
    const hrefFor = (r) => (r ? `#/matter/${rmSlug(r.rm)}/${encodeURIComponent(r.bet)}` : null);
    // For an amendment the vote to show is the first one until the final vote has happened.
    const decidedRef = amend && amend.firstDone && !isDecided(amend.second)
      ? refs.find((r) => r.dokId === amend.first.dokId)
      : bref;
    const matterHref = hrefFor(decidedRef);
    document.title = `${info.title} – Riksförande`;

    // Timeline: the bill's own steps plus every committee report's, planned ones marked as such.
    const t = today();
    const ORDER = ['INL', 'B', 'HÄN', 'MOT', 'UBE', 'JUS', 'TRY', 'BEH', 'BES'];
    const rank = (a) => { const i = ORDER.indexOf(a.code); return i < 0 ? 50 : i; };
    const timeline = [...info.activity, ...item.bets.filter(Boolean).flatMap((b) => b.activity.map((a) => ({ ...a, bet: b })))]
      .filter((a) => a.date)
      .sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
    const eventName = (a) => {
      if (!amend || !a.bet || a.code !== 'BES') return a.name;
      return a.bet === amend.first ? 'Första beslutet (antogs som vilande)' : 'Slutligt beslut';
    };
    if (amend && amend.election) timeline.push({ date: amend.election, name: 'Riksdagsval', code: 'VAL', status: amend.election > t ? 'planerat' : '' });
    timeline.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));

    const amendBox = amend ? h('div.callout', { style: { marginTop: '14px' } },
      h('b', 'Grundlagsändring – kräver två beslut. '),
      'En ändring av grundlagen måste antas två gånger med ett riksdagsval emellan. Det första beslutet gör förslaget vilande; först när den nyvalda riksdagen har antagit det en andra gång gäller ändringen. ',
      amend.firstDone
        ? h('span', `Riksdagen fattade det första beslutet ${fmtDate(amend.firstDate)}. `,
          amend.election && amend.election > t ? `Förslaget vilar nu till efter valet ${fmtDate(amend.election)}.` : 'Nu återstår det slutliga beslutet i den nyvalda riksdagen.')
        : 'Inget av besluten är fattat ännu.') : null;

    const otherRefs = info.refs.filter((r) => !['behandlas_i', 'följdmotion'].includes(r.type) && r.dokId);

    mount(el,
      h('div.crumbs', h('a', { href: '#/props' }, 'Propositioner'), '›', h('span', shortRef(item))),
      h('div.page-head',
        h('div',
          h('div', { style: { marginBottom: '4px' } }, h('span.kind-tag', kindLabel(kind))),
          h('h1', info.title),
          h('p', `${info.typrubrik} · ${item.dep || ''} · inlämnad ${fmtDate(info.date)}`))),

      h('section.card',
        h('div.stage-line', st.key === 'done' ? h('span.tag.good', 'Beslutad') : h('span.tag', amend ? 'Ej slutligt beslutad' : 'Väntar på beslut'), st.label !== 'Beslutad' ? st.label : ''),
        ui.stepper(stepsFor(item, st), st.step),
        amendBox,
        ['done', 'partial', 'vilande'].includes(st.key) && matterHref ? h('div', { style: { marginTop: '14px' } },
          h('a.btn.primary', { href: matterHref }, st.key === 'done' ? 'Se beslutet och hur riksdagen röstade →' : 'Se det första beslutet och hur riksdagen röstade →')) : null,
        info.status ? h('p.muted', { style: { margin: '12px 0 0', fontSize: '.88rem' } }, `Status enligt riksdagen: ${info.status}`) : null),

      h('div.grid.two', { style: { marginTop: '16px' } },
        h('div.card',
          h('h2', 'Fakta'),
          h('dl.kv',
            h('dt', 'Från'), h('dd', item.dep || '—'),
            h('dt', 'Inlämnad'), h('dd', fmtDate(info.date)),
            h('dt', 'Utskott'), h('dd', info.assignedTo || '—'),
            h('dt', 'Motionstiden slutar'), h('dd', fmtDate(actDate(info.activity, 'MOT'))),
            h('dt', 'Motioner'), h('dd', mots.length),
            h('dt', refs.length > 1 ? 'Betänkanden' : 'Betänkande'), h('dd', refs.length ? refs.map((r) => `${r.rm}:${r.bet}`).join(', ') : 'Inte ännu')),
          signers.length ? h('div', { style: { marginTop: '12px' } },
            h('small.faint', 'Undertecknad av'),
            h('ul.roles', signers.map((p) => h('li', p.iid ? h('a', { href: `#/member/${p.iid}` }, p.name) : p.name, p.party && p.party !== '-' ? [' ', ui.partyBadge(p.party)] : null)))) : null),
        h('div.card',
          h('h2', 'Ärendets gång'),
          timeline.length
            ? h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px', fontSize: '.9rem' } }, timeline.map((a) =>
              h('li.row', { style: { flexWrap: 'nowrap' } },
                h('span.muted.nowrap', { style: { width: '110px', flexShrink: 0 } }, fmtDate(a.date)),
                h('span', eventName(a), a.date > t || a.status === 'planerat' ? h('span.tag', { style: { marginLeft: '6px' } }, 'planerat') : null))))
            : ui.empty('Inga händelser registrerade ännu.'))),

      info.proposals.some((p) => p.text) ? h('section.section',
        h('div.card', h('h2', 'Regeringens förslag till riksdagsbeslut'),
          h('ol', { style: { margin: 0, paddingLeft: '20px' } }, info.proposals.filter((p) => p.text).map((p) => h('li', RF.safeHtml(p.text)))))) : null,

      h('section.section',
        h('div.card', { id: 'documents' },
          h('h2', 'Dokument'),
          h('div.docs',
            h('div.doc-block', h('h3', kindLabel(kind)),
              h('ul.doc-list', ui.docItem({ doktyp: kind === 'skr' ? 'skr' : 'prop', dokId, title: info.title, label: info.typrubrik, files: info.files, meta: item.dep }))),
            refs.length ? h('div.doc-block', h('h3', refs.length > 1 ? 'Utskottets betänkanden' : 'Utskottets betänkande'),
              h('ul.doc-list', refs.map((r, i) => {
                const b = item.bets[i];
                const decided = isDecided(b);
                const role = amend ? (b && b === amend.first ? 'Första beslutet (vilande)' : 'Slutligt beslut') : null;
                return ui.docItem({
                  doktyp: 'bet', dokId: r.dokId, title: r.title, label: `Betänkande ${r.rm}:${r.bet}`,
                  href: decided ? hrefFor(r) : null, files: b ? b.files : [],
                  noRead: !b || b.state === 'planerat',
                  meta: [role, !b || b.state === 'planerat' ? 'Under beredning i utskottet' : decided ? `Beslutat ${fmtDate(actDate(b.activity, 'BES') || b.decidedAt)}` : null].filter(Boolean).join(' · '),
                });
              }))) : null,
            h('div.doc-block', h('h3', 'Motioner med anledning av förslaget', h('span.faint', { style: { fontWeight: 400 } }, ` (${mots.length})`)),
              mots.length
                ? h('ul.doc-list', mots.map((m) => {
                  const li = ui.docItem({ doktyp: 'mot', dokId: m.dokId, title: m.author ? `Motion av ${m.author}` : m.title, label: `Motion ${m.rm}:${m.bet}` });
                  m.parties.forEach((p) => li.querySelector('.t b').append(' ', ui.partyBadge(p)));
                  return li;
                }))
                : h('p.muted', { style: { fontSize: '.9rem', margin: 0 } }, st.key === 'motion' ? 'Inga motioner ännu – motionstiden pågår.' : 'Inga motioner lämnades.')),
            otherRefs.length ? h('div.doc-block', h('h3', 'Övriga dokument'),
              h('ul.doc-list', otherRefs.map((r) => ui.docItem({ doktyp: r.doktyp, dokId: r.dokId, title: r.title, label: `${r.name || RF.docType(r.doktyp).sv} ${r.rm}:${r.bet}` })))) : null))));
  };
})(window.RF);
