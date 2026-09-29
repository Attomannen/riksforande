/* Om tjänsten: datakällor, begrepp och cache. */
(function (RF) {
  'use strict';
  const { h, mount, api } = RF;
  RF.views = RF.views || {};

  RF.views.about = function (ctx) {
    const status = h('span.muted');
    mount(ctx.el,
      h('div.page-head', h('div', h('h1', 'Om Riksförande'), h('p', 'Ett verktyg för att följa hur varje riksdagsledamot röstar, byggt på riksdagens öppna data.'))),
      h('div.grid.two',
        h('div.card',
          h('h2', 'Varifrån kommer datan?'),
          h('p', 'Allt hämtas direkt från ', h('a', { href: 'https://data.riksdagen.se/', target: '_blank', rel: 'noopener' }, 'data.riksdagen.se'), ' (Riksdagens öppna data, fri att återanvända). Ingenting skickas någon annanstans.'),
          h('ul', { style: { paddingLeft: '18px' } },
            h('li', h('b', 'voteringlista'), ' – varje ledamots röst och partiernas röstsiffror'),
            h('li', h('b', 'dokumentlista'), ' – voteringarnas rubriker och datum'),
            h('li', h('b', 'dokumentstatus'), ' – betänkanden och propositioner: beslutspunkter, reservationer, ärendets gång, motioner och PDF:er'),
            h('li', h('b', 'personlista'), ' – ledamöter, foton och partiuppdrag som partiledare'))),
        h('div.card',
          h('h2', 'Så läser du siffrorna'),
          h('dl.bio',
            h('dt', 'Riksmöte'), h('dd', 'Riksdagsåret, från september till sommaren. Välj riksmöte i menyn högst upp.'),
            h('dt', 'Proposition'), h('dd', 'Ett förslag från regeringen. Efter att det lämnats in följer motionstiden, då partierna kan lägga motförslag (motioner). Sedan bereder ett utskott ärendet och skriver ett betänkande som kammaren röstar om.'),
            h('dt', 'Betänkande'), h('dd', 'Kammaren röstar om utskottens betänkanden. Ett betänkande behandlar en proposition från regeringen och/eller motioner från ledamöter och delas upp i beslutspunkter.'),
            h('dt', 'Vilande'), h('dd', 'Grundlagsändringar måste beslutas två gånger med ett val emellan. Efter det första beslutet är förslaget vilande.'),
            h('dt', 'Ja / Nej'), h('dd', 'Oftast betyder Ja utskottets förslag och Nej en reservation (ett motförslag) från ett eller flera partier. Varje voteringssida visar exakt vad som gällde.'),
            h('dt', 'Partilinje'), h('dd', 'Det alternativ som flest av partiets röstande ledamöter valde. Frånvarande räknas inte.'),
            h('dt', 'Avvikare'), h('dd', 'En ledamot som röstade Ja, Nej eller Avstår på ett annat sätt än sitt partis linje. Om ett parti delar sig jämnt räknas ingen som avvikare.'),
            h('dt', 'Frånvaro'), h('dd', 'Beror ofta på kvittning mellan blocken och räknas därför inte som att bryta mot partiet.')))),
      h('div.card', { style: { marginTop: '16px' } },
        h('h2', 'Sparad data'),
        h('p.muted', 'Hämtad data sparas i webbläsaren så att sidorna öppnas direkt nästa gång. Pågående riksmöte uppdateras med några timmars mellanrum; äldre riksmöten sparas i en månad.'),
        h('div.row',
          h('button.btn', { type: 'button', onclick: async () => { status.textContent = 'Rensar…'; await api.clearCache(); status.textContent = 'Klart. Datan hämtas på nytt nästa gång.'; } }, 'Rensa sparad data'),
          status)));
  };
})(window.RF);
