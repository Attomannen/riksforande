/* Voteringar & propositioner: every vote in a riksmöte, grouped by the committee report (ärende) it belongs to. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, analysis, fmtDate, fmtNum, plural, int, norm, committee, explainCaption, rmSlug, debounce } = RF;
  RF.views = RF.views || {};

  function matterCard(m, rm) {
    const com = committee(m.organ);
    return h('article.card.matter',
      h('div.matter-head',
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('h3', h('a', { href: m.bet ? `#/matter/${rmSlug(rm)}/${encodeURIComponent(m.bet)}` : `#/vote/${rmSlug(rm)}/${m.votes[0].id}` }, m.title)),
          h('div.matter-meta',
            m.bet ? h('span', { class: 'nowrap' }, `${rm}:${m.bet}`) : null,
            m.organ ? h('span', com.sv) : null,
            h('span', fmtDate(m.date)),
            h('span', plural(m.votes.length, 'votering', 'voteringar')))),
        m.rebels ? ui.rebelBadge(m.rebels) : null),
      m.votes.map((v) => {
        const cap = explainCaption(v.caption);
        const [ja, nej] = v.c;
        const winner = ja > nej ? 'Ja' : nej > ja ? 'Nej' : null;
        return h('a.point-row', { href: `#/vote/${rmSlug(rm)}/${v.id}` },
          h('span.pt', v.punkt && v.punkt !== '0' ? `Punkt ${v.punkt}` : 'Votering'),
          h('span.cap', cap ? cap.text : v.avser === 'motiveringen' ? 'Votering om motiveringen' : 'Votering i sakfrågan'),
          ui.voteBar(v.c),
          h('span.res',
            v.rebels ? ui.rebelBadge(v.rebels, `${v.rebels}`) : null,
            winner ? ui.votePill(winner, h('span.num.faint', { style: { fontWeight: 400 } }, `${Math.max(ja, nej)}–${Math.min(ja, nej)}`)) : h('span.tag', 'Lika')));
      }));
  }

  function reportCard(r) {
    return h('article.card', { style: { padding: '12px 16px' } },
      h('div.row', { style: { alignItems: 'baseline' } },
        h('a', { href: `#/matter/${rmSlug(r.rm)}/${encodeURIComponent(r.bet)}`, style: { fontWeight: 600, flex: 1, minWidth: '200px' } }, r.title),
        r.decisionDay ? h('span.tag.good', `Planerat beslut ${fmtDate(r.decisionDay)}`) : h('span.tag', 'Under beredning')),
      h('div.matter-meta', h('span.nowrap', `${r.rm}:${r.bet}`), h('span', committee(r.organ).sv)));
  }

  /** A riksmöte that has opened but not voted yet: say when voting starts and what is on its way. */
  async function renderNoVotesYet(ctx, body, rm) {
    mount(body, ui.loading('Hämtar kammarens planering…'));
    const [cal, reports] = await Promise.all([
      api.chamberCalendar(rm).catch(() => null),
      api.pendingReports(rm).catch(() => []),
    ]);
    if (!ctx.alive()) return;
    const today = new Date().toISOString().slice(0, 10);
    const next = cal && cal.decisionDays.find((d) => d >= today);
    const planned = reports.filter((r) => r.decisionDay).sort((a, b) => a.decisionDay.localeCompare(b.decisionDay) || a.title.localeCompare(b.title, 'sv'));
    const preparing = reports.filter((r) => !r.decisionDay).sort((a, b) => b.date.localeCompare(a.date));
    const fallback = RF.state.latestRm && RF.state.latestRm !== rm ? RF.state.latestRm : RF.prevRm(rm);
    const preparingEl = h('div');

    mount(body,
      h('div.card',
        h('h2', `Kammaren har inte röstat ännu under riksmötet ${rm}`),
        h('p',
          cal && cal.opening ? `Riksmötet öppnades ${fmtDate(cal.opening)}. ` : '',
          next ? ['Första planerade beslutsdag är ', h('b', fmtDate(next)), ' – voteringarna visas här samma dag eller dagen efter.'] : 'Inga beslutsdagar är planerade ännu.'),
        h('p.muted', { style: { fontSize: '.9rem' } }, 'Efter ett val börjar riksmötet med att riksdagen väljer talman och utskott och håller den allmänpolitiska debatten. Voteringar kommer först när utskotten har lämnat sina betänkanden.'),
        h('div.row',
          h('button.btn.primary', { type: 'button', onclick: () => ctx.setRm(fallback) }, `Visa voteringarna från ${fallback}`),
          h('a.btn', { href: '#/props' }, 'Propositioner som väntar på beslut'))),
      planned.length ? h('section.section',
        h('h2', 'Planerade beslut', h('small.muted', 'Betänkanden som har fått en beslutsdag i kammaren')),
        h('div.stack', planned.map(reportCard))) : null,
      preparing.length ? h('section.section',
        h('h2', `Under beredning i utskotten (${preparing.length})`, h('small.muted', 'Betänkanden som ännu inte har fått en beslutsdag')),
        preparingEl) : null);
    if (preparing.length) ui.pagedList(preparingEl, preparing, reportCard, 15);
  }

  RF.views.votes = async function (ctx) {
    const { el, rm } = ctx;
    const head = h('div.page-head',
      h('div',
        h('h1', `Voteringar ${rm}`),
        h('p', 'Alla voteringar i kammaren, grupperade efter betänkandet som beslutades. Öppna ett ärende för att se propositionen, motionerna och dokumenten bakom det – eller en enskild votering för att se hur varje ledamot röstade.')));
    const body = h('div', ui.loading('Hämtar voteringar från riksdagen…'));
    mount(el, head, body);

    let index, pc;
    try {
      [index, pc] = await Promise.all([
        api.voteIndex(rm, (d, t) => { if (ctx.alive() && t > 1) mount(body, ui.progress(d, t, 'Hämtar voteringslistan')); }),
        api.partyCounts(rm),
      ]);
    } catch (err) {
      if (ctx.alive()) mount(body, ui.errorBox(err, () => ctx.reload()));
      return;
    }
    if (!ctx.alive()) return;

    if (!index.length) {
      await renderNoVotesYet(ctx, body, rm);
      return;
    }

    const votes = index.map((v) => ({ ...v, rebels: analysis.rebelsForVote(pc, v.id) }));
    const groups = new Map();
    for (const v of votes) {
      const key = v.bet || v.id;
      if (!groups.has(key)) groups.set(key, { bet: v.bet, title: v.title, organ: v.organ, date: v.date, votes: [], rebels: 0, text: '' });
      const g = groups.get(key);
      g.votes.push(v);
      g.rebels += v.rebels;
      if ((v.date || '') > (g.date || '')) g.date = v.date;
    }
    const matters = [...groups.values()];
    for (const m of matters) {
      m.votes.sort((a, b) => int(a.punkt) - int(b.punkt));
      m.text = norm(`${m.title} ${m.bet} ${committee(m.organ).sv}`);
      m.closest = Math.min(...m.votes.map((v) => Math.abs(v.c[0] - v.c[1])));
    }

    const withRebels = votes.filter((v) => v.rebels > 0).length;
    const organs = [...new Set(matters.map((m) => m.organ).filter(Boolean))].sort((a, b) => committee(a).sv.localeCompare(committee(b).sv, 'sv'));

    // ----- filters (kept in the URL so Back restores them)
    const q = ctx.query;
    const search = h('input', { type: 'search', placeholder: 'Sök titel eller betänkande, t.ex. ”skola” eller ”FiU”', value: q.get('q') || '', 'aria-label': 'Sök voteringar' });
    const organSel = h('select', { 'aria-label': 'Utskott' },
      h('option', { value: '' }, 'Alla utskott'),
      organs.map((o) => h('option', { value: o, selected: q.get('organ') === o }, `${committee(o).sv} (${o})`)));
    const sortSel = h('select', { 'aria-label': 'Sortering' },
      [['new', 'Nyast först'], ['old', 'Äldst först'], ['rebels', 'Flest avvikare'], ['close', 'Jämnast resultat']]
        .map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'new') === v }, l)));
    const rebelsOnly = h('input', { type: 'checkbox', checked: q.get('rebels') === '1' });
    const countEl = h('span.muted', { style: { fontSize: '.85rem' } });
    const listEl = h('div');

    const apply = () => {
      const term = norm(search.value.trim());
      const organ = organSel.value;
      let list = matters.filter((m) => (!term || m.text.includes(term)) && (!organ || m.organ === organ) && (!rebelsOnly.checked || m.rebels > 0));
      const sort = sortSel.value;
      if (sort === 'old') list = list.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      else if (sort === 'rebels') list = list.slice().sort((a, b) => b.rebels - a.rebels || (b.date || '').localeCompare(a.date || ''));
      else if (sort === 'close') list = list.slice().sort((a, b) => a.closest - b.closest);
      countEl.textContent = `${plural(list.length, 'ärende', 'ärenden')} · ${plural(list.reduce((n, m) => n + m.votes.length, 0), 'votering', 'voteringar')}`;
      if (!list.length) mount(listEl, ui.empty('Inga voteringar matchar filtren.'));
      else ui.pagedList(listEl, list, (m) => matterCard(m, rm), 25);
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      if (organ) params.set('organ', organ);
      if (sort !== 'new') params.set('sort', sort);
      if (rebelsOnly.checked) params.set('rebels', '1');
      ctx.setQuery(params);
    };
    search.addEventListener('input', debounce(apply, 150));
    [organSel, sortSel, rebelsOnly].forEach((x) => x.addEventListener('change', apply));

    mount(body,
      h('div.tiles', { style: { marginBottom: '16px' } },
        ui.tile('Voteringar', fmtNum(votes.length), `${fmtDate(votes[votes.length - 1].date)} – ${fmtDate(votes[0].date)}`),
        ui.tile('Ärenden avgjorda genom votering', fmtNum(matters.length), 'betänkanden'),
        ui.tile('Voteringar med avvikare', fmtNum(withRebels), `${Math.round((withRebels / votes.length) * 100)} % av alla voteringar`),
        ui.tile('Avvikande röster', fmtNum(votes.reduce((n, v) => n + v.rebels, 0)), 'ledamöter som röstade mot partilinjen')),
      h('div.filters',
        search, organSel, sortSel,
        h('label.check', rebelsOnly, 'Endast med avvikare'),
        h('span.spacer'), countEl),
      h('div.row', { style: { marginBottom: '10px' } }, ui.voteLegend(false)),
      listEl);
    apply();
  };
})(window.RF);
