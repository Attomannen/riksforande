/* Reusable UI pieces. */
(function (RF) {
  'use strict';
  const { h, s, arr, fmtDate, fmtNum, fmtBytes, pct, partyInfo, inkOn, safeHtml, docType, riksdagenUrl, VOTE_CLASS, SEAT_ORDER, sum } = RF;

  const ICON_REBEL = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true' },
    s('path', { d: 'M8 1.5 15 14H1z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M8 6v3.6M8 11.4v.1', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));

  // ---------------------------------------------------------------- small pieces
  function partyBadge(code, opts = {}) {
    const info = partyInfo(code);
    const el = h(opts.link ? 'a.pbadge' : 'span.pbadge', {
      class: opts.lg ? 'lg' : '',
      href: opts.link && code !== '-' ? `#/party/${code}` : null,
      style: { background: info.color, color: inkOn(info.color) },
      'data-tip': info.name,
      'aria-label': info.name,
    }, code === '-' ? '–' : code);
    return el;
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  // Vote rows don't carry photo links, and former members aren't in the sitting-member list,
  // so their photo is looked up (once visible) from their person record.
  let photoObserver = null;
  function observePhoto(el, iid, size) {
    if (!('IntersectionObserver' in window)) return;
    photoObserver = photoObserver || new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        photoObserver.unobserve(e.target);
        const t = e.target;
        RF.api.person(t.dataset.iid).then((p) => {
          if (p && p.img && t.isConnected) t.replaceWith(avatar({ ...p, iid: null }, t.dataset.size));
        }).catch(() => {});
      }
    }, { rootMargin: '200px' });
    el.dataset.iid = iid;
    el.dataset.size = size;
    photoObserver.observe(el);
  }

  function avatar(p, size = '') {
    const src = p && (size === 'lg' || size === 'xl' ? p.img || p.imgSmall : p.imgSmall || p.img);
    const fallback = () => h('span.avatar', { class: size, 'aria-hidden': 'true' }, initials(p && p.name));
    if (!src) {
      const el = fallback();
      if (p && p.iid) observePhoto(el, p.iid, size);
      return el;
    }
    const img = h('img.avatar', { class: size, src, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    return img;
  }

  /** Photo URL for a member we only know by id (vote rows don't carry photo links). */
  function photoFor(iid, members) {
    const m = members && members.byIid && members.byIid.get(iid);
    return m ? m : null;
  }

  function votePill(vote, extra) {
    const cls = vote === null ? 'split' : VOTE_CLASS[vote] || 'franv';
    const label = vote === null ? 'Delad' : vote;
    return h('span.vote-pill', { class: cls }, label, extra || null);
  }

  function rebelBadge(n, label) {
    if (!n) return null;
    return h('span.rebel-badge', { 'data-tip': `${n} ${n === 1 ? 'ledamot' : 'ledamöter'} röstade mot sitt partis linje` },
      ICON_REBEL(), label || `${n} avvikare`);
  }

  const VOTE_LABELS = ['Ja', 'Nej', 'Avstår', 'Frånvarande'];

  /** Stacked bar for [ja, nej, avstår, frånvarande]. */
  function voteBar(c, opts = {}) {
    const total = sum(c || []);
    const bar = h('div.vbar', { class: opts.thick ? 'thick' : '', role: 'img', 'aria-label': c ? VOTE_LABELS.map((l, i) => `${l} ${c[i]}`).join(', ') : 'Uppgift saknas' });
    if (!total) return bar;
    const tip = VOTE_LABELS.map((l, i) => `${l}: ${c[i]}`).join('\n');
    c.forEach((n, i) => {
      if (!n) return;
      bar.appendChild(h('span', { class: 'v-' + VOTE_CLASS[VOTE_LABELS[i]], style: { flex: `${n} 1 0` }, 'data-tip': opts.tipPrefix ? opts.tipPrefix + '\n' + tip : tip }));
    });
    return bar;
  }

  function voteLegend(withAbsent = true) {
    const items = [['ja', 'Ja'], ['nej', 'Nej'], ['avst', 'Avstår']];
    if (withAbsent) items.push(['franv', 'Frånvarande']);
    return h('div.legend', items.map(([c, l]) => h('span', h('span.sw.v-' + c), l)));
  }

  function loading(text = 'Laddar…') {
    return h('div.loading', { role: 'status' }, h('span.spinner'), h('span', text));
  }

  function progress(done, total, label) {
    const w = total ? Math.round((done / total) * 100) : 0;
    return h('div.stack', { role: 'status' },
      h('div.row', h('span.spinner'), h('span.muted', `${label || 'Laddar'} (${done} av ${total})`)),
      h('div.progress', h('div', { style: { width: w + '%' } })));
  }

  function errorBox(err, retry) {
    console.error(err);
    return h('div.error', { role: 'alert' },
      h('b', 'Något gick fel. '),
      h('span', err && err.message ? err.message : String(err)),
      h('p.muted', { style: { margin: '6px 0 0' } }, 'Riksdagens API kan vara tillfälligt otillgängligt, eller så saknas internetanslutning.'),
      retry ? h('button.btn.small', { type: 'button', onclick: retry, style: { marginTop: '8px' } }, 'Försök igen') : null);
  }

  function tile(label, value, sub) {
    return h('div.tile', h('div.label', label), h('div.value', value), sub ? h('div.sub', sub) : null);
  }

  function empty(text) { return h('div.empty', text); }

  /** Render a long list progressively with a "Show more" button. */
  function pagedList(container, items, renderItem, pageSize = 40) {
    let shown = 0;
    const list = h('div.stack');
    const moreWrap = h('div.more-wrap');
    const draw = () => {
      const next = items.slice(shown, shown + pageSize);
      next.forEach((x) => list.appendChild(renderItem(x)));
      shown += next.length;
      RF.mount(moreWrap, shown < items.length
        ? h('button.btn', { type: 'button', onclick: draw }, `Visa fler (${fmtNum(items.length - shown)} kvar)`)
        : null);
    };
    RF.mount(container, list, moreWrap);
    draw();
  }

  /** Simple sortable table. columns: [{key, label, render(row), sort(row), num}] */
  function sortableTable(columns, rows, opts = {}) {
    let sortKey = opts.sortKey || null, dir = opts.dir || 1;
    const pageSize = opts.pageSize || 100;
    let limit = pageSize;
    const wrap = h('div');
    const draw = () => {
      const col = columns.find((c) => c.key === sortKey);
      const data = col && col.sort ? rows.slice().sort((a, b) => {
        const x = col.sort(a), y = col.sort(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
      }) : rows;
      const thead = h('thead', h('tr', columns.map((c) => h('th', {
        class: [c.num ? 'n' : '', c.sort ? 'sortable' : ''].join(' '),
        'aria-sort': c.key === sortKey ? (dir > 0 ? 'ascending' : 'descending') : null,
        onclick: c.sort ? () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = c.num ? -1 : 1; } draw(); } : null,
      }, c.label, c.key === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : ''))));
      const tbody = h('tbody', data.slice(0, limit).map((r) => {
        const tr = h('tr', { class: opts.rowClass ? opts.rowClass(r) : '' }, columns.map((c) => h('td', { class: c.num ? 'n' : '' }, c.render(r))));
        return tr;
      }));
      RF.mount(wrap,
        h('div.table-wrap', h('table.data', thead, tbody)),
        data.length > limit ? h('div.more-wrap', h('button.btn', { type: 'button', onclick: () => { limit += pageSize; draw(); } }, `Visa fler (${fmtNum(data.length - limit)} kvar)`)) : null,
        !data.length ? empty(opts.emptyText || 'Inget att visa.') : null);
    };
    draw();
    return wrap;
  }

  function personCell(p, sub) {
    return h('a.person-cell', { href: `#/member/${p.iid}` },
      avatar(p, 'sm'),
      h('span', h('span.pname', p.name), sub ? h('small', sub) : null));
  }

  // ---------------------------------------------------------------- hemicycle
  /** Seat positions for n seats, sorted left → right so parties form wedges. */
  function hemicycleLayout(n, rows) {
    const r0 = 0.36, r1 = 1;
    const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
    const totalR = sum(radii);
    const counts = radii.map((r) => Math.floor((n * r) / totalR));
    let diff = n - sum(counts);
    for (let i = rows - 1; diff > 0; i = (i - 1 + rows) % rows) { counts[i]++; diff--; }
    const pts = [];
    radii.forEach((r, i) => {
      const k = counts[i];
      for (let j = 0; j < k; j++) {
        const a = k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1));
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), a, r });
      }
    });
    pts.sort((p, q) => q.a - p.a || p.r - q.r);
    return { pts, dot: ((r1 - r0) / (rows - 1)) * 0.42 };
  }

  /**
   * seats: [{iid, name, party, vote?, rebel?}]; colorBy 'vote' | 'party'.
   * Seats are grouped by party in left–right order; within a party, the majority option comes first.
   */
  function hemicycle(seats, opts = {}) {
    const colorBy = opts.colorBy || 'vote';
    const order = (p) => { const i = SEAT_ORDER.indexOf(p); return i < 0 ? 99 : i; };
    const voteOrder = { Ja: 0, Nej: 1, 'Avstår': 2, 'Frånvarande': 3 };
    const sorted = seats.slice().sort((a, b) =>
      order(a.party) - order(b.party) || (a.rebel === b.rebel ? 0 : a.rebel ? 1 : -1) || (voteOrder[a.vote] ?? 9) - (voteOrder[b.vote] ?? 9) || String(a.name).localeCompare(String(b.name), 'sv'));
    const rows = seats.length > 250 ? 12 : seats.length > 120 ? 9 : 6;
    const { pts, dot } = hemicycleLayout(sorted.length, rows);
    const cssVar = { Ja: 'var(--ja)', Nej: 'var(--nej)', 'Avstår': 'var(--avst)', 'Frånvarande': 'var(--franv)' };
    const svg = s('svg', { class: 'hemicycle', viewBox: '-1.06 -1.04 2.12 1.1', role: 'img', 'aria-label': opts.label || 'Platsdiagram' });
    sorted.forEach((seat, i) => {
      const p = pts[i];
      const fill = colorBy === 'party' ? partyInfo(seat.party).color : cssVar[seat.vote] || 'var(--franv)';
      const tip = colorBy === 'party'
        ? `${seat.name} (${seat.party})${seat.valkrets ? '\n' + seat.valkrets : ''}`
        : `${seat.name} (${seat.party})\nRöstade: ${seat.vote}${seat.line ? `\nPartilinje: ${seat.line}` : ''}${seat.rebel ? '\n⚠ Bröt partilinjen' : ''}`;
      const c = s('circle', {
        cx: p.x.toFixed(4), cy: (-p.y).toFixed(4), r: dot.toFixed(4), fill,
        stroke: seat.rebel ? 'var(--text)' : 'var(--surface)', 'stroke-width': seat.rebel ? dot * 0.55 : dot * 0.18,
        'data-tip': tip, 'data-party': seat.party, tabindex: seat.iid ? 0 : null,
        onclick: seat.iid ? () => { location.hash = `#/member/${seat.iid}`; } : null,
        onkeydown: seat.iid ? (e) => { if (e.key === 'Enter') location.hash = `#/member/${seat.iid}`; } : null,
      });
      svg.appendChild(c);
    });
    if (opts.centerText) {
      svg.appendChild(s('text', { x: 0, y: -0.1, 'text-anchor': 'middle', 'font-size': 0.16, 'font-weight': 600, fill: 'var(--text)' }, opts.centerText));
      if (opts.centerSub) svg.appendChild(s('text', { x: 0, y: 0.0, 'text-anchor': 'middle', 'font-size': 0.07, fill: 'var(--text-2)' }, opts.centerSub));
    }
    return svg;
  }

  // ---------------------------------------------------------------- document reader
  async function openReader(dokId, title) {
    const frame = h('iframe.docframe', { title: title || dokId, sandbox: 'allow-popups allow-popups-to-escape-sandbox' });
    const dlg = h('dialog.reader',
      h('header', h('b', title || dokId),
        h('a.btn.small', { href: `https://data.riksdagen.se/dokument/${dokId}.html`, target: '_blank', rel: 'noopener' }, 'Öppna i ny flik'),
        h('button.btn.small', { type: 'button', onclick: () => dlg.close() }, 'Stäng')),
      frame);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    frame.srcdoc = '<p style="font-family:sans-serif;padding:20px">Laddar dokumentet…</p>';
    try {
      const html = await RF.api.docHtml(dokId);
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font-family:Georgia,serif;max-width:800px;margin:24px auto;padding:0 20px;background:#fff;color:#111;line-height:1.5}table{border-collapse:collapse}td,th{padding:2px 6px}</style>${html}`;
    } catch (e) {
      frame.srcdoc = `<p style="font-family:sans-serif;padding:20px">Kunde inte ladda dokumentet (${String(e.message).replace(/[<>&]/g, '')}).</p>`;
    }
  }

  // ---------------------------------------------------------------- documents panel
  function docLinks(doc) {
    const links = [];
    const pub = riksdagenUrl(doc.doktyp, doc.dokId);
    if (doc.dokId && !doc.noRead && ['bet', 'prop', 'mot', 'prot', 'rskr', 'skr', 'utl', 'frsrdg'].includes(doc.doktyp)) {
      links.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); openReader(doc.dokId, doc.label || doc.title); } }, 'Läs'));
    }
    if (pub) links.push(h('a', { href: pub, target: '_blank', rel: 'noopener' }, 'riksdagen.se ↗'));
    for (const f of doc.files || []) {
      links.push(h('a', { href: f.url, target: '_blank', rel: 'noopener', 'data-tip': f.name }, `${(f.type || 'file').toUpperCase()} ${fmtBytes(f.size)}`));
    }
    return h('div.doc-links', links);
  }

  function docItem(doc) {
    const t = docType(doc.doktyp);
    return h('li.doc-item',
      h('span.doc-icon', { 'aria-hidden': 'true' }, doc.doktyp || 'doc'),
      h('div.t',
        h('b', doc.href ? h('a', { href: doc.href }, doc.title || doc.label) : doc.title || doc.label),
        h('small', [doc.label || `${t.sv}`, doc.meta].filter(Boolean).join(' · '))),
      docLinks(doc));
  }

  /** Lazily enrich a proposition entry with its PDF and signatories. */
  function propItem(ref) {
    const doc = { doktyp: ref.doktyp, dokId: ref.dokId, title: ref.title, label: `${docType(ref.doktyp).sv} ${ref.rm}:${ref.bet}`, href: `#/prop/${ref.dokId}` };
    const li = docItem(doc);
    RF.api.docStatus(ref.dokId).then((d) => {
      if (!d) return;
      const signed = d.people.filter((p) => /statsråd/i.test(p.role || '')).map((p) => `${p.name}${p.party && p.party !== '-' ? ` (${p.party})` : ''}`);
      const meta = [d.submittedBy, d.date ? fmtDate(d.date) : null, signed.length ? 'Undertecknad av ' + signed.join(', ') : null].filter(Boolean).join(' · ');
      li.replaceWith(docItem({ ...doc, files: d.files, meta }));
    }).catch(() => {});
    return li;
  }

  const REF_GROUPS = [
    { key: 'prop', title: 'Propositioner från regeringen', match: (r) => r.type === 'behandlar' && r.doktyp === 'prop' },
    { key: 'skr', title: 'Skrivelser och andra ärenden som behandlas', match: (r) => r.type === 'behandlar' && !['prop', 'mot'].includes(r.doktyp) },
    { key: 'mot', title: 'Motioner från ledamöter', match: (r) => r.type === 'behandlar' && r.doktyp === 'mot' },
    { key: 'chamber', title: 'Debatt och beslut i kammaren', match: (r) => ['protokolldebatt', 'protokollbeslut', 'rskr'].includes(r.type) },
  ];

  /**
   * All documentation for a matter (committee report), optionally focused on one decision point.
   * m: result of api.matter(); point: string punkt.
   */
  function docsPanel(m, opts = {}) {
    if (!m) {
      return h('div.card', { id: 'documents' }, h('h2', 'Dokument'), empty('Inget betänkande är kopplat till den här voteringen i riksdagens öppna data.'));
    }
    const blocks = [];
    const point = opts.point != null ? m.points.find((p) => p.punkt === String(opts.point)) : null;

    if (point) {
      const res = m.reservations.filter((r) => r.punkt === point.punkt);
      blocks.push(h('div.doc-block',
        h('h3', `Punkt ${point.punkt}: ${point.rubrik || ''}`),
        h('div.forslag', h('b', 'Utskottets förslag: '), safeHtml(point.forslag)),
        res.length ? h('p.muted', { style: { marginTop: '8px', fontSize: '.88rem' } },
          'Motförslag: ',
          res.map((r, i) => [i ? '; ' : '', `${r.typ === 'reservation' ? 'Reservation' : r.typ} ${r.nummer}${r.rubrik ? ` ”${r.rubrik}”` : ''} av `, r.parties.map((p, j) => [j ? ' ' : '', partyBadge(p)])])) : null));
    }

    if (opts.skipSummary) {
      // The page already shows the decision summary above.
    } else if (m.decisionSummary || m.chamberDecision) {
      blocks.push(h('div.doc-block',
        h('h3', 'Beslut i korthet', m.decisionHeading ? h('span.faint', { style: { fontWeight: 400 } }, ` — ${m.decisionHeading}`) : null),
        h('div.doc-text', safeHtml(m.decisionSummary)),
        h('div.row', { style: { fontSize: '.85rem' } },
          m.chamberDecision ? h('span.tag.good', m.chamberDecision) : null,
          m.decidedAt ? h('span.tag', 'Beslutat ' + fmtDate(m.decidedAt)) : null,
          m.status ? h('span.tag', m.status) : null)));
    } else if (m.committeeSummary) {
      blocks.push(h('div.doc-block', h('h3', 'Utskottets förslag i korthet'), h('div.doc-text', safeHtml(m.committeeSummary))));
    }
    if (m.committeeProposal) {
      blocks.push(h('div.doc-block', h('h3', 'Utskottets förslag till beslut'), h('p.doc-text', m.committeeProposal)));
    }

    // The report itself
    const reportDoc = { doktyp: 'bet', dokId: m.dokId, title: m.title, label: m.typrubrik, files: m.files, meta: `${RF.committee(m.organ).sv}${m.date ? ' · ' + fmtDate(m.date) : ''}` };
    blocks.push(h('div.doc-block', h('h3', 'Betänkandet'), h('ul.doc-list', docItem(reportDoc))));

    for (const g of REF_GROUPS) {
      const refs = m.refs.filter(g.match);
      const seen = new Set();
      const uniq = refs.filter((r) => (seen.has(r.dokId + r.type) ? false : seen.add(r.dokId + r.type)));
      if (!uniq.length) continue;
      const items = uniq.map((r) => {
        if (r.doktyp === 'prop') return propItem(r);
        if (r.doktyp === 'mot') {
          // Subtitle reads like "av Gudrun Nordborg m.fl. (V)".
          const who = /^av\s+(.+?)\s*\(([^)]*)\)\s*$/.exec(r.subtitle || '');
          const li = docItem({ doktyp: 'mot', dokId: r.dokId, title: who ? `Motion av ${who[1]}` : r.title, label: `Motion ${r.rm}:${r.bet}`, meta: who ? r.title : null });
          if (who && who[2]) who[2].split(/\s*,\s*/).forEach((p) => li.querySelector('.t b').append(' ', partyBadge(RF.normParty(p))));
          return li;
        }
        const label = r.type === 'protokolldebatt' ? 'Debatt — ' + r.name : r.type === 'protokollbeslut' ? 'Beslut — ' + r.name : `${r.name || docType(r.doktyp).sv} ${r.rm}:${r.bet}`;
        return docItem({ doktyp: r.doktyp, dokId: r.dokId, title: r.title, label });
      });
      const limit = 6;
      blocks.push(h('div.doc-block',
        h('h3', g.title, h('span.faint', { style: { fontWeight: 400 } }, ` (${uniq.length})`)),
        h('ul.doc-list', items.slice(0, limit)),
        items.length > limit ? h('details.more', h('summary', `Visa alla ${items.length}`), h('ul.doc-list', items.slice(limit))) : null));
    }

    if (m.activity.length) {
      blocks.push(h('div.doc-block', h('h3', 'Ärendets gång'),
        h('div.timeline', m.activity.map((a) => h('span', h('b', a.name), fmtDate(a.date))))));
    }

    return h('div.card', { id: 'documents' },
      h('h2', 'Dokument & bakgrund'),
      h('div.docs', blocks));
  }

  // ---------------------------------------------------------------- stepper
  /** steps: [{label, sub}]; current: index of the active step (steps before it are done). */
  function stepper(steps, current, opts = {}) {
    return h('ol.stepper', { class: opts.compact ? 'compact' : '', 'aria-label': 'Ärendets gång' },
      steps.map((st, i) => h('li', {
        class: i < current ? 'done' : i === current ? 'current' : '',
        'aria-current': i === current ? 'step' : null,
      }, h('b', st.label), st.sub ? h('small', st.sub) : null)));
  }

  // ---------------------------------------------------------------- tooltip
  function initTooltip() {
    const tip = document.getElementById('tooltip');
    let current = null;
    const show = (el, x, y) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      current = el;
      RF.mount(tip, ...text.split('\n').map((line, i) => (i ? [h('br'), line] : h('b', line))));
      tip.hidden = false;
      place(x, y);
    };
    const place = (x, y) => {
      const r = tip.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    };
    const hide = () => { current = null; tip.hidden = true; };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el && el !== current) show(el, e.clientX, e.clientY);
      else if (!el) hide();
    });
    document.addEventListener('mousemove', (e) => { if (current) place(e.clientX, e.clientY); });
    document.addEventListener('focusin', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el) { const r = el.getBoundingClientRect(); show(el, r.right, r.bottom); } else hide();
    });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('hashchange', hide);
  }

  Object.assign(RF, {
    ui: {
      partyBadge, avatar, photoFor, votePill, rebelBadge, voteBar, voteLegend, loading, progress, errorBox, tile, empty,
      pagedList, sortableTable, personCell, hemicycle, docsPanel, docItem, openReader, initTooltip, stepper,
    },
  });
})(window.RF);
