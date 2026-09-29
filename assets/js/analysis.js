/* Party lines, rebels and agreement – all derived from the Riksdagen vote tallies.

   Definitions used throughout the app:
   - A party's LINE on a vote is the option (Ja / Nej / Avstår) chosen by most of its members who voted.
     Absent members (Frånvarande) are ignored – absence is usually pairing ("kvittning"), not dissent.
   - If the top options tie, the party was SPLIT and has no line for that vote.
   - An OUTLIER (rebel) is a member who voted Ja/Nej/Avstår differently from their party's line. */
(function (RF) {
  'use strict';
  const { api, PARTY_ORDER, sum } = RF;

  const OPTIONS = ['Ja', 'Nej', 'Avstår'];
  const VOTE_CLASS = { Ja: 'ja', Nej: 'nej', 'Avstår': 'avst', 'Frånvarande': 'franv' };

  /** c = [ja, nej, avstår, frånvarande] → {line, cast, dev, split, unanimous} */
  function partyLine(c) {
    if (!c) return { line: null, cast: 0, dev: 0, split: false, present: false };
    const cast = c[0] + c[1] + c[2];
    if (!cast) return { line: null, cast: 0, dev: 0, split: false, present: false };
    const max = Math.max(c[0], c[1], c[2]);
    const top = [0, 1, 2].filter((i) => c[i] === max);
    const split = top.length > 1;
    return {
      line: split ? null : OPTIONS[top[0]],
      cast,
      dev: split ? 0 : cast - max,
      split,
      present: true,
      cohesion: max / cast,
    };
  }

  /** Winner by simple majority of Ja vs Nej (the official result is on the report page). */
  function outcome(c) {
    if (!c) return null;
    if (c[0] > c[1]) return 'Ja';
    if (c[1] > c[0]) return 'Nej';
    return 'Lika';
  }

  /** Total number of members voting against their party's line on one vote. */
  function rebelsForVote(pc, id) {
    let n = 0;
    for (const p of PARTY_ORDER) n += partyLine(pc[p] && pc[p][id]).dev;
    return n;
  }

  /** Map of voteId → line per party: {S: 'Ja', M: 'Nej', ...} */
  function linesForVote(pc, id) {
    const out = {};
    for (const p of PARTY_ORDER) {
      const pl = partyLine(pc[p] && pc[p][id]);
      if (pl.present) out[p] = pl;
    }
    return out;
  }

  /** Party-level summary for a riksmöte. */
  function partySummary(pc, party, index) {
    const tallies = pc[party] || {};
    let votes = 0, unanimous = 0, split = 0, devVotes = 0, devTotal = 0, won = 0, decided = 0;
    const lineCount = { Ja: 0, Nej: 0, 'Avstår': 0 };
    const byId = index ? new Map(index.map((v) => [v.id, v])) : null;
    for (const id in tallies) {
      const pl = partyLine(tallies[id]);
      if (!pl.present) continue;
      votes++;
      if (pl.split) split++;
      else {
        lineCount[pl.line]++;
        if (pl.dev === 0) unanimous++;
        const v = byId && byId.get(id);
        const res = v && outcome(v.c);
        if (res === 'Ja' || res === 'Nej') {
          if (pl.line !== 'Avstår') { decided++; if (pl.line === res) won++; }
        }
      }
      if (pl.dev > 0) { devVotes++; devTotal += pl.dev; }
    }
    return {
      votes, unanimous, split, devVotes, devTotal, lineCount,
      cohesion: votes ? unanimous / votes : null,
      winRate: decided ? won / decided : null,
    };
  }

  /** Share of votes where two parties took the same line (only votes where both had a line). */
  function agreement(pc, a, b) {
    const A = pc[a] || {}, B = pc[b] || {};
    let same = 0, both = 0;
    for (const id in A) {
      const la = partyLine(A[id]).line;
      const lb = partyLine(B[id]).line;
      if (!la || !lb) continue;
      both++;
      if (la === lb) same++;
    }
    return { rate: both ? same / both : null, same, both };
  }

  function activeParties(pc) {
    return PARTY_ORDER.filter((p) => pc[p] && Object.keys(pc[p]).length > 0);
  }

  function agreementMatrix(pc) {
    const parties = activeParties(pc);
    const m = {};
    for (const a of parties) {
      m[a] = {};
      for (const b of parties) m[a][b] = a === b ? { rate: 1 } : agreement(pc, a, b);
    }
    return { parties, m };
  }

  /** A member's record against their party's line. */
  function memberRecord(votes, pc, indexById) {
    const tally = { Ja: 0, Nej: 0, 'Avstår': 0, 'Frånvarande': 0 };
    const deviations = [];
    let withLine = 0, loyal = 0;
    const rows = votes.map((v) => {
      tally[v.vote] = (tally[v.vote] || 0) + 1;
      const pl = partyLine(pc[v.party] && pc[v.party][v.id]);
      const meta = indexById.get(v.id);
      let status = null;
      if (OPTIONS.includes(v.vote) && pl.line) {
        withLine++;
        if (v.vote === pl.line) { loyal++; status = 'loyal'; }
        else { status = 'rebel'; }
      }
      const row = { ...v, meta, line: pl.line, split: pl.split, status };
      if (status === 'rebel') deviations.push(row);
      return row;
    });
    const total = votes.length;
    return {
      rows, deviations, tally, total,
      cast: tally.Ja + tally.Nej + tally['Avstår'],
      attendance: total ? (total - tally['Frånvarande']) / total : null,
      loyalty: withLine ? loyal / withLine : null,
    };
  }

  /**
   * Members of a party who broke the line during a riksmöte.
   * Only votes where the party tally shows dissent are fetched in full, so this stays light.
   */
  function partyOutliers(rm, party, onProgress) {
    return api.cached(`outliers:v1:${rm}:${party}`, api.ttlFor(rm), async () => {
      const [index, pc] = await Promise.all([api.voteIndex(rm), api.partyCounts(rm)]);
      const tallies = pc[party] || {};
      const targets = index.filter((v) => v.bet && partyLine(tallies[v.id]).dev > 0);
      let done = 0;
      onProgress && onProgress(0, targets.length);
      const votes = await Promise.all(targets.map(async (v) => {
        const pl = partyLine(tallies[v.id]);
        const rows = await api.voteRows(rm, v.bet, v.punkt, v.id, party);
        onProgress && onProgress(++done, targets.length);
        const rebels = rows.filter((r) => OPTIONS.includes(r.vote) && r.vote !== pl.line);
        return { vote: v, line: pl.line, counts: tallies[v.id], rebels };
      }));
      const byMember = {};
      for (const x of votes) {
        for (const r of x.rebels) {
          const m = byMember[r.iid] || (byMember[r.iid] = { iid: r.iid, name: r.name, party: r.party, valkrets: r.valkrets, items: [] });
          m.items.push({ id: x.vote.id, vote: r.vote, line: x.line });
        }
      }
      return {
        votes: votes.filter((x) => x.rebels.length),
        members: Object.values(byMember).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'sv')),
      };
    });
  }

  Object.assign(RF, {
    OPTIONS, VOTE_CLASS,
    analysis: { partyLine, outcome, rebelsForVote, linesForVote, partySummary, agreement, agreementMatrix, activeParties, memberRecord, partyOutliers, sum },
  });
})(window.RF);
