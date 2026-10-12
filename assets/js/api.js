/* Riksdagen open data client: fetch with retry + concurrency limit, and a persistent cache.
   API docs: https://data.riksdagen.se/ */
(function (RF) {
  'use strict';
  const { arr, int, normParty, partyApiCode, PARTY_ORDER } = RF;

  const BASE = 'https://data.riksdagen.se';
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const CACHE_VERSION = 1;

  // ---------------------------------------------------------------- persistent cache
  // IndexedDB when available (it is on file:// in Chromium and Firefox); memory otherwise.
  const mem = new Map();
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('riksforande', CACHE_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }
  async function idb(mode, fn) {
    const d = await db();
    if (!d) return undefined;
    return new Promise((resolve) => {
      try {
        const tx = d.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch (e) {
        resolve(undefined);
      }
    });
  }
  const idbGet = (k) => idb('readonly', (st) => st.get(k));
  const idbSet = (k, v) => idb('readwrite', (st) => st.put(v, k));

  async function clearCache() {
    mem.clear();
    await idb('readwrite', (st) => st.clear());
  }

  const inflight = new Map();
  /** Memoise producer() under key for ttl ms, in memory and IndexedDB. Serves stale data if the network fails. */
  function cached(key, ttl, producer) {
    const hit = mem.get(key);
    if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.v);
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const stored = await idbGet(key);
      if (stored && Date.now() - stored.t < ttl) {
        mem.set(key, stored);
        return stored.v;
      }
      try {
        const v = await producer();
        const rec = { t: Date.now(), v };
        mem.set(key, rec);
        idbSet(key, rec);
        return v;
      } catch (err) {
        if (stored) {
          console.warn('Serving stale cache for', key, err);
          mem.set(key, stored);
          return stored.v;
        }
        throw err;
      }
    })();
    inflight.set(key, p);
    const done = () => inflight.delete(key);
    p.then(done, done);
    return p;
  }

  // ---------------------------------------------------------------- fetch with limits
  const MAX_CONCURRENT = 6;
  let active = 0;
  const queue = [];
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      active++;
      job.fn().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }
  function limited(fn) {
    return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function buildUrl(path, params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return BASE + path + q;
  }

  async function getJSON(path, params) {
    const url = buildUrl(path, params);
    return limited(async () => {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url);
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!text.trim()) return null;
          return JSON.parse(text);
        } catch (e) {
          lastErr = e;
          await sleep(500 * (attempt + 1));
        }
      }
      const err = new Error(`Kunde inte hämta data från riksdagen (${lastErr && lastErr.message}).`);
      err.url = url;
      throw err;
    });
  }

  /** Recently finished or ongoing sessions can still change; older ones are frozen. */
  function ttlFor(rm) {
    const recent = RF.rmForDate(new Date(Date.now() - 75 * DAY));
    return rm >= recent ? 3 * HOUR : 30 * DAY;
  }

  // ---------------------------------------------------------------- votes
  const counts4 = (r) => [int(r.Ja), int(r.Nej), int(r['Avstår']), int(r['Frånvarande'])];

  /** {voteId: [ja, nej, avstår, frånvarande]} for a riksmöte, optionally for one party. */
  async function fetchCounts(rm, party) {
    const params = { rm, sz: 20000, utformat: 'json', gruppering: 'votering_id' };
    if (party) params.parti = partyApiCode(party, rm);
    const j = await getJSON('/voteringlista/', params);
    const out = {};
    for (const r of arr(j && j.voteringlista && j.voteringlista.votering)) {
      if (r.votering_id) out[r.votering_id.toUpperCase()] = counts4(r);
    }
    return out;
  }

  function parseVoteDoc(d) {
    const summary = d.summary || d.notis || '';
    const capM = /Omröstning i (\S+)\s*\n\s*([^\n]+?)\s*\n/.exec(summary);
    let title = d.undertitel || '';
    const tm = /betänkande \d{4}\/\d{2}:\S+\s+(.+?),\s*förslagspunkt/i.exec(d.titel || '');
    if (tm) title = tm[1];
    // Older years label the report "FöU13p2" (point appended); the vote API wants "FöU13".
    const punkt = d.tempbeteckning;
    const bet = String(d.beteckning || '').replace(new RegExp(`p${punkt}$`), '');
    return {
      id: String(d.kall_id || '').toUpperCase(),
      dokId: d.dok_id,
      date: (d.datum || '').slice(0, 10),
      bet,
      punkt,
      organ: d.organ,
      title: title || d.titel,
      avser: capM ? capM[1] : null,
      caption: capM ? cleanCaption(capM[2]) : null,
    };
  }

  /** Captions come as "Utskottets förslag mot reservation 6 (C, MP)" or, in older years, "… reservation 17 SD, KD Parti". */
  function cleanCaption(line) {
    // Votes without a counter-proposal go straight to the tally table ("Parti / Ja / Nej…").
    const cap = String(line || '').replace(/\s*Parti$/, '').trim();
    if (!cap) return null;
    return cap.replace(/^(Utskottets förslag mot reservation \d+)\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö]*(?:,\s*[A-ZÅÄÖ][A-ZÅÄÖa-zåäö]*)*)$/, '$1 ($2)');
  }

  /** Every page of a dokumentlista query (the API caps a page at 200 documents). */
  async function fetchDocList(params, onProgress) {
    const base = { utformat: 'json', sz: 200, sort: 'datum', sortorder: 'desc', ...params };
    const first = await getJSON('/dokumentlista/', { ...base, p: 1 });
    const list = first && first.dokumentlista;
    const pages = int(list && list['@sidor']) || 1;
    let docs = arr(list && list.dokument);
    let done = 1;
    onProgress && onProgress(done, pages);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        getJSON('/dokumentlista/', { ...base, p: i + 2 }).then((j) => {
          onProgress && onProgress(++done, pages);
          return arr(j && j.dokumentlista && j.dokumentlista.dokument);
        })
      )
    );
    for (const r of rest) docs = docs.concat(r);
    return docs;
  }

  async function fetchVoteDocs(rm, onProgress) {
    const docs = await fetchDocList({ doktyp: 'votering', rm }, onProgress);
    return docs.map(parseVoteDoc).filter((d) => d.id);
  }

  /** Metadata for a vote that has no entry in the document list (rare, e.g. votes on urgent motions). */
  async function fetchVoteMeta(id) {
    const j = await getJSON(`/votering/${id}/json`);
    const d = j && j.votering && j.votering.dokument;
    if (!d) return null;
    return {
      id, dokId: d.dok_id, date: (d.datum || '').slice(0, 10), bet: d.beteckning, punkt: d.tempbeteckning || '0',
      organ: d.organ && d.organ !== '-' ? d.organ : '', title: (d.titel || '').replace(/^Omröstning:\s*/, ''), avser: null, caption: null,
    };
  }

  /**
   * Everything needed to list the votes of a riksmöte:
   * [{id, date, bet, punkt, organ, title, caption, avser, dokId, c:[ja,nej,avst,franv]}], newest first.
   */
  function voteIndex(rm, onProgress) {
    return cached(`voteIndex:v4:${rm}`, ttlFor(rm), async () => {
      const [counts, docs] = await Promise.all([fetchCounts(rm), fetchVoteDocs(rm, onProgress)]);
      const byId = new Map();
      for (const d of docs) if (counts[d.id]) byId.set(d.id, { ...d, c: counts[d.id] });
      const missing = Object.keys(counts).filter((id) => !byId.has(id));
      const extra = await Promise.all(missing.map((id) => fetchVoteMeta(id).catch(() => null)));
      extra.forEach((m, i) => {
        const id = missing[i];
        byId.set(id, { ...(m || { id, date: '', bet: '', punkt: '', organ: '', title: 'Votering ' + id.slice(0, 8), caption: null }), c: counts[id] });
      });
      return [...byId.values()].sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') || (a.bet || '').localeCompare(b.bet || '') || int(a.punkt) - int(b.punkt)
      );
    });
  }

  /** Per-party tallies for every vote in a riksmöte: {party: {voteId: [ja,nej,avst,franv]}}. */
  function partyCounts(rm) {
    return cached(`partyCounts:v1:${rm}`, ttlFor(rm), async () => {
      const out = {};
      await Promise.all(PARTY_ORDER.map(async (p) => { out[p] = await fetchCounts(rm, p); }));
      return out;
    });
  }

  function parseVoteRow(r) {
    return {
      id: String(r.votering_id || '').toUpperCase(),
      iid: r.intressent_id,
      name: r.namn || `${r.fornamn} ${r.efternamn}`,
      first: r.fornamn,
      last: r.efternamn,
      party: normParty(r.parti),
      valkrets: r.valkrets,
      vote: r.rost,
      seat: int(r.banknummer),
      gender: r.kon,
      born: r.fodd,
      avser: r.avser,
    };
  }

  /** Every member's vote for one vote point (optionally one party). The API filters by rm+bet+punkt, not vote id. */
  async function voteRows(rm, bet, punkt, id, party) {
    const key = `rows:v1:${rm}:${bet}:${punkt}:${party || ''}`;
    const all = await cached(key, ttlFor(rm), async () => {
      const params = { rm, bet, punkt, sz: 1000, utformat: 'json' };
      if (party) params.parti = partyApiCode(party, rm);
      const j = await getJSON('/voteringlista/', params);
      const grouped = {};
      for (const r of arr(j && j.voteringlista && j.voteringlista.votering)) {
        const row = parseVoteRow(r);
        (grouped[row.id] = grouped[row.id] || []).push(row);
      }
      return grouped;
    });
    return all[id] || [];
  }

  /** A member's votes in a riksmöte. */
  function memberVotes(iid, rm) {
    return cached(`mvotes:v1:${iid}:${rm}`, ttlFor(rm), async () => {
      const j = await getJSON('/voteringlista/', { rm, iid, sz: 20000, utformat: 'json' });
      return arr(j && j.voteringlista && j.voteringlista.votering).map((r) => ({
        id: String(r.votering_id).toUpperCase(), bet: r.beteckning, punkt: r.punkt, vote: r.rost, party: normParty(r.parti), avser: r.avser,
      }));
    });
  }

  // ---------------------------------------------------------------- documents
  function partyList(s) { return String(s || '').replace(/"/g, '').split(/\s*,\s*/).filter(Boolean).map(normParty); }

  function captionText(tbl) {
    const cap = tbl && tbl.table && tbl.table.caption;
    if (!cap) return { avser: null, caption: null };
    const b = typeof cap === 'object' ? cap.b : '';
    const t = typeof cap === 'object' ? cap['#text'] : cap;
    const m = /Omröstning i (\S+)/.exec(b || '');
    return { avser: m ? m[1] : null, caption: t ? String(t).trim() : null };
  }

  function parseDokumentstatus(ds) {
    const d = ds.dokument || {};
    const upp = {};
    for (const u of arr(ds.dokuppgift && ds.dokuppgift.uppgift)) upp[u.kod] = u.text;
    return {
      dokId: d.dok_id,
      rm: d.rm,
      bet: d.beteckning,
      state: d.status, // "Klar" once decided; "planerat" for a committee report still being prepared
      doktyp: d.doktyp || d.typ,
      subtyp: d.subtyp,
      typrubrik: d.typrubrik,
      title: d.titel,
      subtitle: d.subtitel,
      organ: d.organ,
      date: (d.datum || '').slice(0, 10),
      published: (d.publicerad || '').slice(0, 10),
      decisionHeading: upp.notisrubrik,
      decisionSummary: upp.notis, // HTML: "Beslut i korthet"
      committeeSummary: upp.utsknotis, // HTML: committee's proposal in brief
      committeeProposal: upp.beslutssammanfattningusk,
      chamberDecision: upp.rdbeslut,
      status: upp.statustext,
      decidedAt: (upp.beslutdatumtid || '').slice(0, 10),
      submittedBy: upp.inlamnatav,
      assignedTo: upp.tilldelat,
      points: arr(ds.dokutskottsforslag && ds.dokutskottsforslag.utskottsforslag).map((p) => ({
        punkt: String(p.punkt),
        rubrik: p.rubrik,
        forslag: p.forslag,
        beslutstyp: p.beslutstyp,
        voteId: p.votering_id ? String(p.votering_id).toUpperCase() : null,
        winner: p.vinnare,
        resNo: p.motforslag_nummer,
        resParties: partyList(p.motforslag_partier),
        majority: p.voteringskrav,
        ...captionText(p.votering_sammanfattning_html),
      })),
      reservations: arr(ds.dokmotforslag && ds.dokmotforslag.motforslag).map((r) => ({
        nummer: r.nummer, rubrik: r.rubrik, parties: partyList(r.partier), typ: r.typ, punkt: String(r.utskottsforslag_punkt || ''),
      })),
      refs: arr(ds.dokreferens && ds.dokreferens.referens).map((r) => ({
        type: r.referenstyp, dokId: r.ref_dok_id, doktyp: r.ref_dok_typ, rm: r.ref_dok_rm, bet: r.ref_dok_bet,
        title: r.ref_dok_titel, subtitle: r.ref_dok_subtitel, name: r.ref_dok_dokumentnamn,
      })),
      files: arr(ds.dokbilaga && ds.dokbilaga.bilaga).map((b) => ({
        title: b.titel, subtitle: b.subtitel, name: b.filnamn, size: int(b.filstorlek), type: b.filtyp, url: b.fil_url,
      })),
      activity: arr(ds.dokaktivitet && ds.dokaktivitet.aktivitet).map((a) => ({ code: a.kod, name: a.namn, date: (a.datum || '').slice(0, 10), status: a.status })),
      people: arr(ds.dokintressent && ds.dokintressent.intressent).map((i) => ({ name: i.namn, party: normParty(i.partibet), role: i.roll, iid: i.intressent_id })),
      proposals: arr(ds.dokforslag && ds.dokforslag.forslag).map((f) => ({ nummer: f.nummer, text: f.forslagstext || f.lydelse || '', committee: f.intressent })),
    };
  }

  const isoDay = (d) => d.toISOString().slice(0, 10);

  /** The chamber's calendar for a riksmöte: opening day and upcoming decision days ("Beslut", i.e. votes). */
  function chamberCalendar(rm) {
    return cached(`kalender:v1:${rm}`, 3 * HOUR, async () => {
      const start = parseInt(rm, 10);
      const until = isoDay(new Date(Date.now() + 150 * DAY));
      const j = await getJSON('/kalender/', { utformat: 'json', org: 'kamm', from: `${start}-09-01`, tom: until });
      const events = arr(j && j.kalenderlista && j.kalenderlista.kalender)
        .filter((e) => /^\d{8}/.test(e.DTSTART || ''))
        .map((e) => ({ date: `${e.DTSTART.slice(0, 4)}-${e.DTSTART.slice(4, 6)}-${e.DTSTART.slice(6, 8)}`, summary: e.SUMMARY || '', cats: e.CATEGORIES || '' }));
      return {
        opening: events.filter((e) => /riksmötets öppnande/i.test(e.summary)).map((e) => e.date).sort()[0] || null,
        decisionDays: [...new Set(events.filter((e) => /votering/i.test(e.cats)).map((e) => e.date))].sort(),
      };
    });
  }

  /** Committee reports in a riksmöte that the chamber has not decided yet; decisionDay is set once it is scheduled. */
  function pendingReports(rm) {
    return cached(`pendingBet:v1:${rm}`, 3 * HOUR, async () => {
      const docs = await fetchDocList({ doktyp: 'bet', rm });
      return docs.filter((d) => d.status === 'planerat').map((d) => ({
        dokId: d.dok_id,
        rm: d.rm,
        bet: d.beteckning,
        title: d.titel,
        organ: d.organ,
        date: (d.datum || '').slice(0, 10),
        decisionDay: (d.beslutsdag || '').slice(0, 10) || null,
      }));
    });
  }

  /**
   * Government bills (propositioner) and communications (skrivelser) from the last three riksmöten.
   * Bills not decided before an election carry over, so older years can still be pending.
   */
  function propositions(onProgress) {
    return cached('props:v1', 3 * HOUR, async () => {
      const cur = RF.rmForDate(new Date());
      const rms = [cur, RF.prevRm(cur), RF.prevRm(RF.prevRm(cur))];
      const lists = await Promise.all(rms.map((rm) => fetchDocList({ doktyp: 'prop', rm }, rm === cur ? null : onProgress)));
      return lists.flat()
        // The budget bill's chapters are listed as separate documents (e.g. HD031d8); keep only main documents.
        .filter((d) => d.dok_id && String(d.dok_id).toUpperCase().endsWith('03' + String(d.beteckning).toUpperCase()))
        .map((d) => ({
          dokId: d.dok_id,
          rm: d.rm,
          nr: d.beteckning,
          title: d.titel,
          date: (d.datum || '').slice(0, 10),
          dep: d.organ,
          kind: d.subtyp === 'skr' ? 'skr' : 'prop',
          done: d.status === 'Klar',
        }));
    });
  }

  function docStatus(dokId, ttl = 7 * DAY) {
    return cached(`docstatus:v2:${dokId}`, ttl, async () => {
      const j = await getJSON(`/dokumentstatus/${encodeURIComponent(dokId)}.json`);
      return j && j.dokumentstatus ? parseDokumentstatus(j.dokumentstatus) : null;
    });
  }

  /** The committee report (betänkande) behind a vote, with its points, related bills/motions and files. */
  function matter(rm, bet, voteDokId) {
    return cached(`matter:v2:${rm}:${bet}`, ttlFor(rm), async () => {
      // Vote documents are named e.g. HD19UbU30p7; the report is HD01UbU30 (same riksmöte prefix).
      if (voteDokId && /^[A-Z0-9]{2}19/i.test(voteDokId)) {
        const guess = await docStatus(voteDokId.slice(0, 2) + '01' + bet, ttlFor(rm)).catch(() => null);
        if (guess && guess.bet === bet) return guess;
      }
      const l = await getJSON('/dokumentlista/', { rm, bet, doktyp: 'bet', utformat: 'json', sz: 5 });
      const hit = arr(l && l.dokumentlista && l.dokumentlista.dokument).find((d) => d.beteckning === bet && d.rm === rm);
      return hit ? docStatus(hit.dok_id, ttlFor(rm)) : null;
    });
  }

  /** Raw HTML of a document (for the in-app reader). */
  async function docHtml(dokId) {
    return limited(async () => {
      const res = await fetch(`${BASE}/dokument/${encodeURIComponent(dokId)}.html`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  }

  // ---------------------------------------------------------------- people
  const LEADER_ROLES = /^(Partiledare|Språkrör|Partiordförande)$/i;

  function parsePerson(p, full) {
    const today = new Date().toISOString().slice(0, 10);
    const uppdrag = arr(p.personuppdrag && p.personuppdrag.uppdrag);
    const isCurrent = (u) => !u.tom || u.tom.slice(0, 10) >= today;
    const partyRoles = uppdrag
      .filter((u) => u.typ === 'partiuppdrag' && isCurrent(u))
      .map((u) => ({ role: u.roll_kod, org: normParty(u.organ_kod), from: (u.from || '').slice(0, 10) }));
    const out = {
      iid: p.intressent_id,
      sourceid: p.sourceid,
      first: p.tilltalsnamn,
      last: p.efternamn,
      name: `${p.tilltalsnamn} ${p.efternamn}`.trim(),
      sort: p.sorteringsnamn,
      party: normParty(p.parti),
      valkrets: p.valkrets,
      status: p.status,
      born: p.fodd_ar,
      gender: p.kon,
      img: p.bild_url_192 || p.bild_url_80,
      imgSmall: p.bild_url_80 || p.bild_url_192,
      partyRoles,
    };
    if (full) {
      const uppgift = arr(p.personuppgift && p.personuppgift.uppgift);
      const val = (u) => arr(u.uppgift).filter((x) => typeof x === 'string').join(' ');
      out.bio = uppgift.filter((u) => u.typ === 'biografi').map((u) => ({ label: u.kod, text: val(u) }));
      const email = uppgift.find((u) => u.kod === 'Officiell e-postadress');
      out.email = email ? val(email).replace('[på]', '@') : null;
      out.web = uppgift.filter((u) => u.typ === 'eadress' && /webb/i.test(u.kod)).map(val).filter(Boolean);
      out.title = (uppgift.find((u) => u.typ === 'titlar' && u.kod === 'sv') || {}).uppgift;
      out.roles = uppdrag
        .map((u) => ({
          type: u.typ, organ: u.organ_kod, role: u.roll_kod, status: u.status,
          from: (u.from || '').slice(0, 10), to: (u.tom || '').slice(0, 10),
          name: arr(u.uppgift).filter((x) => typeof x === 'string').join(', '),
          current: isCurrent(u),
        }))
        .sort((a, b) => (b.from || '').localeCompare(a.from || ''));
    }
    return out;
  }

  /** Currently serving members of the Riksdag. */
  function members() {
    return cached('members:v1', DAY, async () => {
      const j = await getJSON('/personlista/', { utformat: 'json', sort: 'sorteringsnamn', sortorder: 'asc' });
      return arr(j && j.personlista && j.personlista.person).map((p) => parsePerson(p, false));
    });
  }

  /** Any person, current or former, with biography and assignments. */
  function person(iid) {
    return cached(`person:v1:${iid}`, DAY, async () => {
      const j = await getJSON('/personlista/', { iid, rdlstatus: 'samtliga', utformat: 'json' });
      const p = arr(j && j.personlista && j.personlista.person)[0];
      return p ? parsePerson(p, true) : null;
    });
  }

  /**
   * Current party leaders (and group leaders) per party.
   * Leaders serving as ministers are not in the sitting-member list, so those parties are looked up separately.
   */
  function partyLeaders() {
    return cached('leaders:v1', DAY, async () => {
      const out = {};
      for (const p of PARTY_ORDER) out[p] = { leaders: [], groupLeaders: [] };
      const add = (person) => {
        for (const r of person.partyRoles) {
          if (!out[r.org]) continue;
          const bucket = LEADER_ROLES.test(r.role) ? out[r.org].leaders : /^Gruppledare$/i.test(r.role) ? out[r.org].groupLeaders : null;
          if (bucket && !bucket.some((x) => x.person.iid === person.iid)) bucket.push({ person, role: r.role, since: r.from });
        }
      };
      const sitting = await members();
      sitting.forEach(add);
      const missing = PARTY_ORDER.filter((p) => !out[p].leaders.length);
      await Promise.all(missing.map(async (p) => {
        const j = await getJSON('/personlista/', { utformat: 'json', parti: p, rdlstatus: 'tjanst' });
        arr(j && j.personlista && j.personlista.person).forEach((x) => add(parsePerson(x, false)));
      }));
      return out;
    });
  }

  Object.assign(RF, {
    api: {
      voteIndex, partyCounts, voteRows, memberVotes, matter, docStatus, docHtml,
      members, person, partyLeaders, fetchCounts, clearCache, cached, ttlFor, getJSON, propositions,
      chamberCalendar, pendingReports,
    },
  });
})(window.RF);
