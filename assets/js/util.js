/* Shared helpers: DOM building, formatting, sanitising, reference data. */
window.RF = window.RF || {};
(function (RF) {
  'use strict';

  // ---------------------------------------------------------------- DOM
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function setAttrs(el, attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function isAttrs(a) {
    return a && typeof a === 'object' && !(a instanceof Node) && !Array.isArray(a);
  }

  /** h('a.link#id', {href}, ...children) – tiny hyperscript. Text is always escaped. */
  function h(tag, attrs, ...children) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
    if (isAttrs(attrs)) setAttrs(el, attrs);
    else if (attrs != null) children.unshift(attrs);
    append(el, children);
    return el;
  }

  /** SVG equivalent of h(). */
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (isAttrs(attrs)) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.setAttribute('class', v);
        else el.setAttribute(k, String(v));
      }
    } else if (attrs != null) children.unshift(attrs);
    append(el, children);
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function mount(el, ...children) { clear(el); append(el, children); return el; }

  // ---------------------------------------------------------------- data helpers
  /** The API turns single-element XML lists into objects – normalise to arrays. */
  function arr(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function int(x) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; }
  function sum(a) { let t = 0; for (const x of a) t += x; return t; }
  function by(fn, dir = 1) {
    return (a, b) => {
      const x = fn(a), y = fn(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    };
  }
  function groupBy(list, fn) {
    const m = new Map();
    for (const x of list) {
      const k = fn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }
  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function norm(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ---------------------------------------------------------------- formatting
  const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
  function fmtDate(d) {
    if (!d) return '—';
    const x = new Date(String(d).slice(0, 10) + 'T12:00:00');
    return isNaN(x) ? String(d) : dateFmt.format(x);
  }
  function pct(x, digits = 1) {
    if (x == null || !Number.isFinite(x)) return '—';
    return (x * 100).toFixed(digits).replace(/\.0$/, '').replace('.', ',') + ' %';
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('sv-SE'); }
  function fmtBytes(b) {
    if (!b) return '';
    if (b > 1e6) return (b / 1e6).toFixed(1).replace('.', ',') + ' MB';
    return Math.max(1, Math.round(b / 1e3)) + ' kB';
  }
  /** plural(3, 'votering', 'voteringar') → "3 voteringar" */
  function plural(n, one, many) { return `${fmtNum(n)} ${n === 1 ? one : many}`; }

  // ---------------------------------------------------------------- sanitising
  const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'A', 'SPAN', 'H3', 'H4']);
  /** Parse untrusted HTML from the API and keep only a small, attribute-free allowlist. */
  function safeHtml(html) {
    const frag = document.createDocumentFragment();
    if (!html) return frag;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const walk = (src, dst) => {
      for (const node of src.childNodes) {
        if (node.nodeType === 3) dst.appendChild(document.createTextNode(node.nodeValue));
        else if (node.nodeType === 1) {
          const tag = node.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') continue;
          if (ALLOWED.has(tag)) {
            const el = document.createElement(tag.toLowerCase());
            if (tag === 'A') {
              const href = node.getAttribute('href') || '';
              if (/^https?:\/\//i.test(href)) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; }
            }
            walk(node, el);
            dst.appendChild(el);
          } else walk(node, dst);
        }
      }
    };
    walk(doc.body.firstChild, frag);
    return frag;
  }
  /** Plain text version of API HTML. */
  function htmlText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    return doc.body.textContent.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- reference data
  // Party colours are the parties' own identity colours. Every use pairs them with the party code in text.
  const PARTIES = {
    S: { name: 'Socialdemokraterna', color: '#E8112D' },
    M: { name: 'Moderaterna', color: '#52BDEC' },
    SD: { name: 'Sverigedemokraterna', color: '#DDDD00' },
    C: { name: 'Centerpartiet', color: '#009933' },
    V: { name: 'Vänsterpartiet', color: '#AF0000' },
    KD: { name: 'Kristdemokraterna', color: '#231977' },
    L: { name: 'Liberalerna', color: '#006AB3' },
    MP: { name: 'Miljöpartiet de gröna', color: '#83CF39' },
    '-': { name: 'Politiska vildar (partilösa)', color: '#8A8A86' },
  };
  // Riksdagen's own listing order, and the left→right seating used for the hemicycle.
  const PARTY_ORDER = ['S', 'M', 'SD', 'C', 'V', 'KD', 'L', 'MP'];
  const SEAT_ORDER = ['V', 'S', 'MP', 'C', 'L', 'KD', 'M', 'SD', '-'];

  function normParty(p) {
    const c = String(p || '').trim().toUpperCase();
    if (!c) return '-';
    if (c === 'FP') return 'L'; // Folkpartiet renamed Liberalerna in 2015
    return c;
  }
  /** Code the API expects for a party in a given riksmöte. */
  function partyApiCode(code, rm) { return code === 'L' && rm < '2015/16' ? 'FP' : code; }
  function partyInfo(code) { return PARTIES[code] || { name: code, color: '#8A8A86' }; }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  /** Ink or white, whichever reads better on the given fill. */
  function inkOn(hex) { return luminance(hex) > 0.36 ? '#0b0b0b' : '#ffffff'; }

  const COMMITTEES = {
    AU: 'Arbetsmarknadsutskottet',
    CU: 'Civilutskottet',
    FiU: 'Finansutskottet',
    FöU: 'Försvarsutskottet',
    JuU: 'Justitieutskottet',
    KU: 'Konstitutionsutskottet',
    KrU: 'Kulturutskottet',
    MJU: 'Miljö- och jordbruksutskottet',
    NU: 'Näringsutskottet',
    SfU: 'Socialförsäkringsutskottet',
    SkU: 'Skatteutskottet',
    SoU: 'Socialutskottet',
    TU: 'Trafikutskottet',
    UbU: 'Utbildningsutskottet',
    UU: 'Utrikesutskottet',
    UFöU: 'Sammansatta utrikes- och försvarsutskottet',
    BoU: 'Bostadsutskottet',
  };
  function committee(code) {
    return { code, sv: COMMITTEES[code] || code || '—' };
  }

  // [name, path segment on riksdagen.se]
  const DOC_TYPES = {
    bet: ['Betänkande', 'betankande'],
    prop: ['Proposition', 'proposition'],
    mot: ['Motion', 'motion'],
    prot: ['Protokoll', 'protokoll'],
    rskr: ['Riksdagsskrivelse', 'riksdagsskrivelse'],
    skr: ['Skrivelse', 'skrivelse'],
    utl: ['Utlåtande', 'utlatande'],
    frsrdg: ['Framställning/redogörelse', 'framstallning-redogorelse'],
    ds: ['Departementsserien', 'departementsserien'],
    sou: ['Statens offentliga utredningar', 'statens-offentliga-utredningar'],
    fpm: ['Faktapromemoria', 'faktapromemoria'],
    kammakt: ['Kammaraktivitet', null],
    'f-lista': ['Föredragningslista', 'foredragningslista'],
    't-lista': ['Talarlista', 'talarlista'],
  };
  function docType(t) {
    const d = DOC_TYPES[t];
    return d ? { sv: d[0], path: d[1] } : { sv: t, path: null };
  }
  /** Public page on riksdagen.se (the site redirects the short form to the full slug). */
  function riksdagenUrl(doktyp, dokId) {
    const p = docType(doktyp).path;
    return p && dokId ? `https://www.riksdagen.se/sv/dokument-och-lagar/dokument/${p}/_${String(dokId).toLowerCase()}/` : null;
  }
  function memberUrl(iid) { return `https://www.riksdagen.se/sv/ledamoter-och-partier/ledamot/_${iid}/`; }

  /** Caption such as "Utskottets förslag mot reservation 6 (C, MP)" → what Ja and Nej meant. */
  function explainCaption(cap) {
    if (!cap) return null;
    let m = /^Utskottets förslag mot reservation (\d+)\s*\(([^)]*)\)/i.exec(cap);
    if (m) return { text: cap, ja: 'utskottets förslag', nej: `reservation ${m[1]} (${m[2]})` };
    m = /^Utskottets förslag mot (.+)$/i.exec(cap);
    if (m) return { text: cap, ja: 'utskottets förslag', nej: m[1] };
    m = /^(.+?) mot (.+)$/i.exec(cap);
    if (m) return { text: cap, ja: m[1].toLowerCase(), nej: m[2] };
    return { text: cap, ja: null, nej: null };
  }

  // ---------------------------------------------------------------- constitutional amendments
  /**
   * Constitutional amendments must be adopted twice with a general election in between.
   * The Riksdag words the first decision "antar som vilande" and the second "antar slutligt det vilande förslaget".
   * Returns 'first', 'final' or null for a decision text (HTML allowed).
   */
  function vilandeKind(text) {
    const t = htmlText(text);
    if (/antar\s+slutligt|slutligt\s+(det|de)\s+vilande/i.test(t)) return 'final';
    if (/som\s+vilande/i.test(t)) return 'first';
    return null;
  }

  /** First ordinary general election after a date: the second Sunday of September every fourth year (2022, 2026, 2030…). */
  function electionAfter(isoDate) {
    const from = String(isoDate || '').slice(0, 10);
    const start = parseInt(from, 10) || new Date().getFullYear();
    for (let y = start; y < start + 5; y++) {
      if ((y - 2022) % 4 !== 0) continue;
      const firstSunday = 1 + ((7 - new Date(y, 8, 1).getDay()) % 7);
      const iso = `${y}-09-${String(firstSunday + 7).padStart(2, '0')}`;
      if (iso > from) return iso;
    }
    return null;
  }

  // ---------------------------------------------------------------- riksmöte helpers
  /** Riksmöte (parliamentary year) that a date falls in. It opens in September. */
  function rmForDate(d) {
    const y = d.getFullYear();
    const start = d.getMonth() >= 8 ? y : y - 1;
    return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
  }
  function rmList(from = 2010) {
    const out = [];
    const cur = parseInt(rmForDate(new Date()), 10);
    for (let y = cur; y >= from; y--) out.push(`${y}/${String((y + 1) % 100).padStart(2, '0')}`);
    return out;
  }
  function prevRm(rm) { const y = parseInt(rm, 10) - 1; return `${y}/${String((y + 1) % 100).padStart(2, '0')}`; }
  const rmSlug = (rm) => rm.replace('/', '-');
  const rmFromSlug = (slug) => String(slug).replace('-', '/');

  Object.assign(RF, {
    h, s, clear, mount, arr, int, sum, by, groupBy, debounce, norm,
    fmtDate, pct, fmtNum, fmtBytes, plural, safeHtml, htmlText,
    PARTIES, PARTY_ORDER, SEAT_ORDER, normParty, partyApiCode, partyInfo, inkOn,
    committee, docType, riksdagenUrl, memberUrl, explainCaption, vilandeKind, electionAfter,
    rmForDate, rmList, prevRm, rmSlug, rmFromSlug,
  });
})(window.RF);
