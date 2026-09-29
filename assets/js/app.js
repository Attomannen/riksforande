/* App shell: hash router, riksmöte selector, theme toggle. */
(function (RF) {
  'use strict';
  const { h, mount, api, ui, rmFromSlug } = RF;

  const app = document.getElementById('app');
  const rmSelect = document.getElementById('rm-select');
  RF.state = { rm: null, latestRm: null };

  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- routes
  const routes = [
    { re: /^\/votes$/, tab: 'votes', title: () => `Voteringar ${RF.state.rm}`, run: (ctx) => RF.views.votes(ctx) },
    { re: /^\/matter\/([^/]+)\/([^/]+)$/, tab: 'votes', title: (m) => decodeURIComponent(m[2]), run: (ctx, m) => RF.views.matter(ctx, rmFromSlug(m[1]), decodeURIComponent(m[2])) },
    { re: /^\/vote\/([^/]+)\/([^/]+)$/, tab: 'votes', title: () => 'Votering', run: (ctx, m) => RF.views.vote(ctx, rmFromSlug(m[1]), m[2].toUpperCase()) },
    { re: /^\/props$/, tab: 'props', title: () => 'Propositioner', run: (ctx) => RF.views.props(ctx) },
    { re: /^\/prop\/([^/]+)$/, tab: 'props', title: () => 'Proposition', run: (ctx, m) => RF.views.prop(ctx, decodeURIComponent(m[1])) },
    { re: /^\/parties$/, tab: 'parties', title: () => 'Partier & partiledare', run: (ctx) => RF.views.parties(ctx) },
    { re: /^\/party\/([^/]+)$/, tab: 'parties', title: (m) => decodeURIComponent(m[1]), run: (ctx, m) => RF.views.party(ctx, decodeURIComponent(m[1])) },
    { re: /^\/members$/, tab: 'members', title: () => 'Ledamöter', run: (ctx) => RF.views.members(ctx) },
    { re: /^\/member\/([^/]+)$/, tab: 'members', title: () => 'Ledamot', run: (ctx, m) => RF.views.member(ctx, m[1]) },
    { re: /^\/about$/, tab: 'about', title: () => 'Om tjänsten', run: (ctx) => RF.views.about(ctx) },
  ];

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/votes';
    const i = raw.indexOf('?');
    return { path: i < 0 ? raw : raw.slice(0, i), query: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
  }

  const scrollMemory = new Map();
  let token = 0;

  async function render() {
    const my = ++token;
    const { path, query } = parseHash();
    if (path === '/' || path === '') { location.replace('#/votes'); return; }
    const route = routes.find((r) => r.re.test(path));
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', !!route && a.dataset.tab === route.tab));
    // Pending bills and the About page don't depend on the selected riksmöte.
    document.querySelector('.rm-select').hidden = !!route && (route.tab === 'props' || route.tab === 'about');
    const ctx = {
      el: app,
      rm: RF.state.rm,
      query,
      alive: () => my === token,
      reload: render,
      setRm,
      setQuery(params) {
        const s = params.toString();
        history.replaceState(history.state, '', '#' + path + (s ? '?' + s : ''));
      },
    };
    if (!route) {
      mount(app, h('div.card', h('h1', 'Sidan finns inte'), h('p', h('a', { href: '#/votes' }, 'Gå till voteringarna'))));
      return;
    }
    const m = route.re.exec(path);
    document.title = `${route.title(m)} – Riksförande`;
    const saved = scrollMemory.get(location.hash);
    try {
      await route.run(ctx, m);
    } catch (err) {
      if (ctx.alive()) mount(app, ui.errorBox(err, render));
    }
    if (ctx.alive()) window.scrollTo(0, saved || 0);
  }

  window.addEventListener('hashchange', (e) => {
    try { scrollMemory.set(new URL(e.oldURL).hash, window.scrollY); } catch (err) { /* ignore */ }
    render();
  });

  // ---------------------------------------------------------------- riksmöte
  function setRm(rm) {
    if (!rm || rm === RF.state.rm) return;
    RF.state.rm = rm;
    rmSelect.value = rm;
    store.set('rf:rm', rm, true);
    // Pages that carry their own riksmöte in the URL go back to the list for the new year.
    const { path } = parseHash();
    if (/^\/(vote|matter)\//.test(path)) location.hash = '#/votes';
    else render();
  }

  async function detectLatestRm() {
    const cur = RF.rmForDate(new Date());
    try {
      const has = await api.cached(`hasVotes:${cur}`, 6 * 3600e3, async () => {
        const j = await api.getJSON('/voteringlista/', { rm: cur, sz: 1, utformat: 'json' });
        return RF.arr(j && j.voteringlista && j.voteringlista.votering).length > 0;
      });
      return has ? cur : RF.prevRm(cur);
    } catch (e) {
      return RF.prevRm(cur);
    }
  }

  async function initRm() {
    const list = RF.rmList(2010);
    RF.state.latestRm = await detectLatestRm();
    mount(rmSelect, list.map((rm) => h('option', { value: rm }, rm === RF.state.latestRm ? `${rm} (senaste)` : rm)));
    const saved = store.get('rf:rm', true);
    RF.state.rm = saved && list.includes(saved) ? saved : RF.state.latestRm;
    rmSelect.value = RF.state.rm;
    rmSelect.addEventListener('change', () => setRm(rmSelect.value));
  }

  // ---------------------------------------------------------------- theme
  function initTheme() {
    const btn = document.getElementById('theme-btn');
    btn.addEventListener('click', () => {
      const root = document.documentElement;
      const current = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('rf:theme', next);
    });
  }

  // ---------------------------------------------------------------- boot
  (async function boot() {
    initTheme();
    ui.initTooltip();
    mount(app, ui.loading('Ansluter till riksdagen…'));
    await initRm();
    render();
  })();
})(window.RF);
