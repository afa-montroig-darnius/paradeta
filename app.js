'use strict';
/*
 * Paradeta AFA — app del mòbil.
 *
 * Com funciona:
 *  - Cada cosa que es fa (una venda, una anul·lació, el canvi inicial...) és una «operació» amb un id únic.
 *    Es guarda primer al mòbil (la «cua») i s'envia al full de Google quan hi ha connexió.
 *  - El full no accepta mai dues vegades la mateixa operació, així que reenviar no duplica res.
 *  - L'estoc i els totals no es guarden: es calculen a partir dels productes i de les operacions
 *    (les del full més les que encara són a la cua).
 */

// ---------- Utilitats ----------
const $ = s => document.querySelector(s);
const eur = c => ((c || 0) / 100).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseEur = v => { const s = String(v == null ? '' : v).trim().replace(/\s|€/g, '').replace(',', '.'); if (!s) return null; const n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100); };
const hhmm = iso => new Date(iso).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const suma = a => a.reduce((x, y) => x + y, 0);
const alfa = arr => [...arr].sort((a, b) => a.nom.localeCompare(b.nom, 'ca', { sensitivity: 'base' }));
const perData = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
const nouId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const euroText = c => c == null ? '' : (c / 100).toFixed(2).replace('.', ',');
const de = nom => (/^[aeiouàèéíòóúh]/i.test(nom) ? "d'" : 'de ') + nom; // «d'Alan», «de Joan»

const LS = {
  get(k, def) { try { const v = localStorage.getItem('pa.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('pa.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('pa.' + k); } catch (e) {} }
};

const DEMO = !window.PARADETA_API;

// ---------- Estat ----------
const S = {
  clau: LS.get('clau', null),
  admin: LS.get('admin', null),
  paradeta: LS.get('paradeta', null),
  llista: LS.get('paradetes', []),
  dades: null,
  cua: LS.get('cua', []),
  xarxa: 'ok',               // ok | enviant | error
  demoSenseXarxa: false,
  vista: 'venda', tab: null, cistella: {}, cistellaOberta: false,
  reserva: null,             // referència de la reserva que s'està recollint (p. ex. «R14»)
  dispositiu: LS.get('dispositiu', null),
  canviDemanat: false,
  carcassa: false
};
if (!S.dispositiu) { S.dispositiu = 'M' + Math.random().toString(36).slice(2, 7); LS.set('dispositiu', S.dispositiu); }
if (S.paradeta) S.dades = LS.get('cache.' + S.paradeta, null);

// ---------- Comunicació amb el full ----------
async function crida(p) {
  const cos = Object.assign({ clau: S.admin || S.clau }, p);
  if (DEMO) {
    if (S.demoSenseXarxa) throw new Error('sense connexió');
    await new Promise(r => setTimeout(r, 200));
    return JSON.parse(JSON.stringify(window.demoServidor(cos)));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(window.PARADETA_API, { method: 'POST', body: JSON.stringify(cos), signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

let sincronitzant = false, repetir = false;
async function sincronitza() {
  if (!S.clau || !S.paradeta) return;
  if (sincronitzant) { repetir = true; return; } // en acabar, en farà una altra
  sincronitzant = true;
  repetir = false;
  if (S.cua.length) { S.xarxa = 'enviant'; pintaEstat(); }
  let mesCua = false;
  try {
    if (S.cua.length) {
      const lot = S.cua.slice(0, 40);
      const r = await crida({ accio: 'enviar', operacions: lot });
      if (!r.ok) throw r;
      // les rebudes i les que el full ha rebutjat per mal fetes surten de la cua
      const fora = new Set(r.rebudes.concat((r.errors || []).map(e => e.id)));
      S.cua = S.cua.filter(o => !fora.has(o.id));
      LS.set('cua', S.cua);
      if (r.errors && r.errors.length) console.warn('Operacions rebutjades pel full', r.errors);
      mesCua = S.cua.length > 0;
    }
    const d = await crida({ accio: 'dades', paradeta: S.paradeta });
    if (!d.ok) throw d;
    S.dades = d;
    S.llista = d.paradetes;
    LS.set('cache.' + S.paradeta, d);
    LS.set('paradetes', d.paradetes);
    S.xarxa = 'ok';
  } catch (e) {
    if (e && e.error === 'contrasenya') {
      if (S.admin && S.admin !== S.clau) { S.admin = null; LS.del('admin'); toast('La contrasenya d\'administració ha canviat'); }
      else { surt(true); return; }
    }
    S.xarxa = 'error';
  } finally {
    sincronitzant = false;
    render();
  }
  if ((mesCua || repetir) && S.xarxa !== 'error') sincronitza();
}

function afegeixOp(op) {
  Object.assign(op, { id: nouId(), paradeta: S.paradeta, ts: new Date().toISOString(), dispositiu: S.dispositiu });
  S.cua.push(op);
  LS.set('cua', S.cua);
  render();
  sincronitza();
  return op;
}

// ---------- Model: tot el que es veu, calculat a partir dels moviments ----------
function model() {
  const d = S.dades;
  if (!d || !d.paradeta) return null;
  const provs = {};
  (d.proveidors || []).forEach(p => { provs[p.nom] = p; });
  const productes = d.productes.map(p => Object.assign({}, p));
  const pendents = S.cua.filter(o => o.paradeta === S.paradeta);
  pendents.filter(o => o.tipus === 'producte').forEach(o => {
    if (productes.some(p => p.id === o.producte.id)) return;
    const p = Object.assign({ inicial: 0 }, o.producte);
    const pv = provs[p.proveidor];
    if (d.admin) p.cost = pv && pv.descompte != null ? Math.round(p.preu * (1 - pv.descompte / 100)) : null;
    productes.push(p);
  });
  const vistes = new Set(d.moviments.map(m => m.op));
  let movs = d.moviments.slice();
  pendents.filter(o => o.tipus !== 'producte' && !vistes.has(o.id)).forEach(o => {
    try { movs = movs.concat(Nucli.filesDeOperacio(o).map(Nucli.objecteDeFila)); } catch (e) {}
  });

  const anul = new Set(movs.filter(m => m.tipus === 'anulacio').map(m => m.ref));
  const vendes = [], perOp = {};
  movs.filter(m => m.tipus === 'venda').forEach(m => {
    let v = perOp[m.op];
    if (!v) { v = perOp[m.op] = { op: m.op, ts: m.ts, ref: m.ref, linies: [], total: 0, anulada: anul.has(m.op) }; vendes.push(v); }
    v.linies.push(m);
    v.total += m.import || 0;
  });
  vendes.sort(perData);
  const venutsParada = {};
  vendes.filter(v => !v.anulada).forEach(v => v.linies.forEach(l => { venutsParada[l.producte] = (venutsParada[l.producte] || 0) + l.quantitat; }));

  const sortides = {}, retorns = {}, diners = [];
  let retornat = false;
  movs.forEach(m => {
    if (m.tipus === 'sortida' && m.producte) sortides[m.producte] = (sortides[m.producte] || 0) + m.quantitat;
    if (m.tipus === 'retorn') { retornat = true; if (m.producte) retorns[m.producte] = (retorns[m.producte] || 0) + m.quantitat; }
    if (m.tipus === 'diners') diners.push(m);
  });
  const ultim = t => movs.filter(m => m.tipus === t).sort(perData).pop();
  const canvi = ultim('canvi'), recompte = ultim('recompte');

  // reserves del web: l'estat (pendent, recollida, anul·lada) inclou el que encara és a la cua
  const reserves = Nucli.estatReserves(JSON.parse(JSON.stringify(d.reserves || [])), movs);
  const resPendents = reserves.filter(r => r.estat === 'pendent');
  const reservat = {};
  resPendents.forEach(r => r.linies.forEach(l => { reservat[l.producte] = (reservat[l.producte] || 0) + l.quantitat; }));

  productes.forEach(p => {
    p.reservat = reservat[p.id] || 0;
    const sp = venutsParada[p.id] || 0, so = sortides[p.id] || 0, re = retorns[p.id] || 0;
    p.venutsParada = sp;
    p.alFora = retornat ? 0 : so;
    p.venutsFora = retornat ? so - re : 0;
    p.queda = p.inicial - sp - so + re;
    p.venuts = sp + p.venutsFora;
  });
  const categories = [];
  productes.forEach(p => { if (!categories.includes(p.categoria)) categories.push(p.categoria); });
  // una categoria és amagada si tots els seus productes ho són
  const amagades = categories.filter(c => productes.filter(p => p.categoria === c).every(p => p.amagat));
  const visibles = categories.filter(c => !amagades.includes(c));
  const ambMoviments = new Set(movs.map(m => m.producte).filter(Boolean));

  const totalVendes = suma(vendes.filter(v => !v.anulada).map(v => v.total));
  const totalDiners = suma(diners.map(m => m.import || 0));
  return {
    d, provs, productes, categories, amagades, visibles, ambMoviments, vendes, reserves, resPendents, sortides, retorns, retornat, diners,
    canvi: canvi ? canvi.import : null, recompte: recompte ? recompte.import : null,
    totalVendes, totalDiners,
    fora: d.paradeta.fora,
    foraUnitats: retornat ? 0 : suma(Object.values(sortides)),
    foraDeu: retornat ? suma(productes.map(p => p.venutsFora * p.preu)) : 0
  };
}

function liquidacions(M) {
  const g = {};
  M.productes.forEach(p => {
    const k = p.proveidor || 'Sense proveïdor';
    const x = g[k] || (g[k] = { nom: k, pagar: 0, faltenCost: 0, tornar: 0, retorna: M.provs[k] ? M.provs[k].retorna : true });
    if (p.venuts) { if (p.cost == null) x.faltenCost++; else x.pagar += p.venuts * p.cost; }
    x.tornar += Math.max(0, p.queda);
  });
  return Object.values(g).sort((a, b) => a.nom.localeCompare(b.nom, 'ca'));
}

// ---------- Icones ----------
const ICONES = {
  venda: '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.3 10.6a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 1.9-1.4L21 8H6.1"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/></svg>',
  totals: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  resum: '<svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M6 17v-5M11 17V6M16 17v-8"/></svg>',
  planta: '<svg viewBox="0 0 24 24"><path d="M5 20c0-8.5 6-15 15-15 0 9-6.5 15-15 15z"/><path d="M5 20l8-8"/></svg>',
  llibre: '<svg viewBox="0 0 24 24"><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h8"/></svg>',
  joc: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></svg>',
  altre: '<svg viewBox="0 0 24 24"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
  avall: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
};
function iconaCategoria(c) {
  const l = c.toLowerCase();
  if (/llibre|conte|còmic|comic|revista/.test(l)) return ICONES.llibre;
  if (/plant|flor|ros|arbre|avet|verd/.test(l)) return ICONES.planta;
  if (/joc|jugar|puzzle|trencaclosques/.test(l)) return ICONES.joc;
  return ICONES.altre;
}

// ---------- Pintar ----------
function render() {
  const arrel = $('#arrel');
  if (!S.clau) { S.carcassa = false; arrel.innerHTML = vLogin(); return; }
  if (!S.carcassa) {
    arrel.innerHTML = `${DEMO ? '<div class="demo">Mode demo: les dades només es guarden en aquest mòbil.</div>' : ''}
      <div class="app">
        <header>
          <div class="hrow"><img class="logo" src="logo.jpg" alt="AFA Escola Mont-roig-Darnius"><button class="sync" id="sync" onclick="tocaEstat()"></button></div>
          <div class="evtwrap"><button class="evt" id="evt" onclick="triaParadeta()"></button></div>
        </header>
        <main id="main"></main>
      </div>
      <div class="cartbar" id="cartbar"></div>
      <nav><div class="in" id="nav"></div></nav>`;
    S.carcassa = true;
  }
  pintaEstat();
  $('#evt').innerHTML = `${esc(S.paradeta || 'Tria una paradeta')}${ICONES.avall}`;
  $('#nav').innerHTML = [['venda', 'Venda'], ['totals', 'Totals'], ['resum', 'Resum']]
    .map(([k, l]) => `<button class="${S.vista === k ? 'on' : ''}" onclick="ves('${k}')"><span class="ic">${ICONES[k]}</span>${l}</button>`).join('');
  const M = model();
  const titol = { venda: 'Venda', totals: 'Totals', resum: 'Resum' }[S.vista];
  $('#main').innerHTML = `<h2 class="ptitle">${titol}</h2>` + (M ? ({ venda: vVenda, totals: vTotals, resum: vResum })[S.vista](M) : vSenseDades());
  pintaCistella(M);
  if (M && S.vista === 'venda' && M.canvi == null && M.productes.length && !S.canviDemanat && !$('#overlay').innerHTML) {
    S.canviDemanat = true;
    canviSheet();
  }
}

function pintaEstat() {
  const el = $('#sync');
  if (!el) return;
  const n = S.cua.length;
  let cls = 'ok', t = 'Tot enviat';
  if (S.xarxa === 'enviant' && n) { cls = 'busy'; t = `Enviant ${n}…`; }
  else if (n) { cls = 'off'; t = `Sense connexió · ${n} pendent${n === 1 ? '' : 's'}`; }
  else if (S.xarxa === 'error') { cls = 'off'; t = 'Sense connexió'; }
  if (DEMO && S.demoSenseXarxa && !n) { cls = 'off'; t = 'Sense connexió'; }
  el.className = 'sync ' + cls;
  el.textContent = t;
}

function tocaEstat() {
  if (DEMO) {
    S.demoSenseXarxa = !S.demoSenseXarxa;
    toast(S.demoSenseXarxa ? 'Demo: simulant que no hi ha connexió' : 'Demo: torna a haver-hi connexió');
    if (S.demoSenseXarxa) { S.xarxa = 'error'; render(); } else sincronitza();
    return;
  }
  toast('Tornant a provar…');
  sincronitza();
}

function ves(v) { S.vista = v; S.cistellaOberta = false; render(); scrollTo(0, 0); }
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
function tanca() { $('#overlay').innerHTML = ''; }
function sheet(html) { $('#overlay').innerHTML = `<div class="sheet" onclick="if(event.target===this)tanca()"><div class="pane">${html}</div></div>`; }

function vSenseDades() {
  if (!S.paradeta) return `<div class="panel empty"><b>Encara no hi ha cap paradeta</b><p class="muted">${S.dades && S.dades.admin || S.admin ? 'Crea-la tocant el botó de dalt.' : 'L\'ha de crear l\'administració.'}</p></div>`;
  if (S.dades && !S.dades.paradeta) return `<div class="panel empty"><b>No trobo «${esc(S.paradeta)}»</b><p class="muted">Potser li han canviat el nom al full. Tria-la de nou tocant el botó de dalt.</p></div>`;
  if (S.xarxa === 'error') return `<div class="panel empty"><b>Cal connexió</b><p class="muted">El primer cop que s'obre una paradeta en aquest mòbil cal connexió per carregar els productes.</p></div>`;
  return `<div class="panel empty"><p class="muted">Carregant…</p></div>`;
}

// ---------- Entrar ----------
function vLogin() {
  return `<div class="login"><img class="logo" src="logo.jpg" alt="AFA Escola Mont-roig-Darnius">
    <h1>Paradeta AFA</h1><p class="muted">Escriu la contrasenya de la paradeta.</p>
    <form onsubmit="entra(event)">
      <input type="password" id="pw" autocomplete="current-password" placeholder="Contrasenya">
      <div class="err" id="err"></div>
      <button class="btn pri full">Entrar</button>
    </form>
    ${DEMO ? '<p class="foot-note">Mode demo: la contrasenya és «paradeta», o «admin» per a l\'administració.</p>' : ''}</div>`;
}
async function entra(e) {
  e.preventDefault();
  const v = $('#pw').value.trim();
  if (!v) return;
  $('#err').textContent = 'Comprovant…';
  try {
    const r = await crida({ accio: 'hola', clau: v });
    if (!r.ok) { $('#err').textContent = r.error === 'contrasenya' ? 'Contrasenya incorrecta' : r.error; return; }
    S.clau = v; LS.set('clau', v);
    if (r.admin) { S.admin = v; LS.set('admin', v); }
    S.llista = r.paradetes; LS.set('paradetes', r.paradetes);
    if (!S.paradeta || !r.paradetes.some(p => p.nom === S.paradeta)) {
      S.paradeta = r.paradetes.length ? r.paradetes[r.paradetes.length - 1].nom : null;
      LS.set('paradeta', S.paradeta);
    }
    S.dades = S.paradeta ? LS.get('cache.' + S.paradeta, null) : null;
    render();
    sincronitza();
  } catch (err) {
    $('#err').textContent = 'Cal connexió per entrar el primer cop.';
  }
}
function surt(perContrasenya) {
  if (!perContrasenya && S.cua.length && !confirm(`Hi ha ${S.cua.length} operacions sense enviar. Si tanques la sessió es perdran. Vols tancar-la igualment?`)) return;
  ['clau', 'admin', 'cua'].forEach(k => LS.del(k));
  Object.assign(S, { clau: null, admin: null, cua: [], cistella: {}, xarxa: 'ok' });
  tanca();
  render();
  if (perContrasenya) toast('La contrasenya ha canviat. Torna a entrar.');
}

// ---------- Paradetes ----------
function triaParadeta() {
  const admin = S.dades ? S.dades.admin : !!S.admin;
  sheet(`<h2>Paradetes</h2>
    ${S.llista.length ? `<div class="panel">${[...S.llista].reverse().map(p => `<button class="pick r" onclick="canviaParadeta(this.dataset.nom)" data-nom="${esc(p.nom)}">
      <span><b>${esc(p.nom)}</b>${p.data ? `<br><span class="muted">${esc(dataCurta(p.data))}</span>` : ''}</span>
      <span class="check">${p.nom === S.paradeta ? '✓' : ''}</span></button>`).join('')}</div>` : '<p class="muted">Encara no n\'hi ha cap.</p>'}
    <div class="row" style="margin-top:14px"><button class="btn sec" onclick="tanca()">Tancar</button>${admin ? '<button class="btn pri" onclick="novaParadeta()">+ Nova paradeta</button>' : ''}</div>
    <p class="foot-note">Cada paradeta té els seus productes, vendes i caixa. Les d'anys anteriors es poden tornar a obrir per consultar-les.</p>`);
}
function canviaParadeta(nom) {
  S.paradeta = nom; LS.set('paradeta', nom);
  S.dades = LS.get('cache.' + nom, null);
  Object.assign(S, { cistella: {}, cistellaOberta: false, tab: null, canviDemanat: false, vista: 'venda' });
  tanca(); render(); sincronitza();
}
function novaParadeta() {
  sheet(`<h2>Nova paradeta</h2>
    <label class="micro" for="pn">Nom</label><input type="text" id="pn" placeholder="p. ex. Sant Jordi 2027">
    <label class="micro" for="pd">Data</label><input type="date" id="pd">
    <label class="micro" for="pf">Qui ven fora de la parada (opcional)</label><input type="text" id="pf" placeholder="p. ex. Alan">
    <label class="micro" for="pc">Copiar els productes de</label>
    <select id="pc"><option value="">Cap (els posaré al full)</option>${[...S.llista].reverse().map(p => `<option>${esc(p.nom)}</option>`).join('')}</select>
    <div class="err" id="perr"></div>
    <div class="row"><button class="btn sec" onclick="triaParadeta()">Enrere</button><button class="btn pri" onclick="creaParadeta()">Crear</button></div>
    <p class="foot-note">Si copies els productes, es copien els noms i els preus. Les quantitats les poses després al full.</p>`);
  $('#pn').focus();
}
async function creaParadeta() {
  const nom = $('#pn').value.trim();
  if (!nom) { $('#perr').textContent = 'Falta el nom'; return; }
  $('#perr').textContent = 'Creant…';
  try {
    const r = await crida({ accio: 'novaParadeta', nom, data: $('#pd').value, fora: $('#pf').value.trim(), copiarDe: $('#pc').value });
    if (!r.ok) { $('#perr').textContent = r.error; return; }
    S.llista = r.paradetes; LS.set('paradetes', r.paradetes);
    canviaParadeta(nom);
    toast(r.copiats ? `Paradeta creada amb ${r.copiats} productes` : 'Paradeta creada');
  } catch (e) {
    $('#perr').textContent = 'Cal connexió per crear una paradeta.';
  }
}

// ---------- VENDA ----------
function vVenda(M) {
  if (!M.productes.length) return `<div class="panel empty"><b>Encara no hi ha productes</b><p class="muted">Afegeix-los a la pestanya «Productes» del full de Google, amb el nom d'aquesta paradeta a la columna «Paradeta».</p></div>`;
  if (!M.visibles.length) return `<div class="panel empty"><b>Totes les categories estan amagades</b><p class="muted">Es tornen a mostrar des de Resum › Categories, amb la contrasenya d'administració.</p></div>`;
  if (!M.visibles.includes(S.tab)) S.tab = M.visibles[0];
  const ci = M.categories.indexOf(S.tab) % 4;
  const llista = alfa(M.productes.filter(p => p.categoria === S.tab));
  // les unitats de la reserva que s'està cobrant ja són a la cistella: no es compten dues vegades
  const enCurs = {};
  const rc = S.reserva && M.reserves.find(r => r.ref === S.reserva);
  if (rc) rc.linies.forEach(l => { enCurs[l.producte] = (enCurs[l.producte] || 0) + l.quantitat; });
  let h = M.reserves.length
    ? `<button class="resbar" onclick="reservesSheet()"><span><b>Reserves</b> <span class="muted">· ${M.resPendents.length ? `${M.resPendents.length} per recollir` : 'totes recollides'}</span></span>${ICONES.avall}</button>`
    : '';
  h += M.visibles.length > 1
    ? `<div class="seg">${M.visibles.map((c, i) => `<button class="${S.tab === c ? 'on' : ''}" onclick="S.tab=this.dataset.c;render()" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
    : '';
  h += '<div class="grid">' + llista.map(p => {
    const dins = S.cistella[p.id] || 0, res = Math.max(0, p.reservat - (enCurs[p.id] || 0)), q = p.queda - dins - res;
    return `<button class="tile ${dins ? 'on' : ''}" onclick="afegeix('${p.id}')">${dins ? `<span class="badge num">${dins}</span>` : ''}
      <span class="rj" style="background:var(--cat-${ci})">${iconaCategoria(p.categoria)}</span>
      <span class="n">${esc(p.nom)}</span><span class="p num">${eur(p.preu)}</span>
      <span class="s num ${q <= 1 ? 'low' : ''}">${q < 0 ? `Estoc ${q}` : `Queden ${q}`}${res ? ` · ${res} reservat${res > 1 ? 's' : ''}` : ''}${p.alFora ? ` · ${p.alFora} ${esc(M.fora || 'fora')}` : ''}</span></button>`;
  }).join('');
  const esLlibre = /llibre/i.test(S.tab);
  h += `<button class="tile add" onclick="nouProducte()">+ ${esLlibre ? 'Llibre' : 'Afegir'}<span class="muted">no és a la llista</span></button></div>`;
  return h;
}
function afegeix(id) { S.cistella[id] = (S.cistella[id] || 0) + 1; render(); }
function canviaQ(id, d) {
  S.cistella[id] = (S.cistella[id] || 0) + d;
  if (S.cistella[id] <= 0) delete S.cistella[id];
  if (!Object.keys(S.cistella).length) { S.cistellaOberta = false; S.reserva = null; }
  render();
}
function totalCistella(M) { return suma(Object.entries(S.cistella).map(([k, q]) => { const p = M.productes.find(x => x.id === k); return p ? p.preu * q : 0; })); }
function pintaCistella(M) {
  const el = $('#cartbar');
  if (M) Object.keys(S.cistella).forEach(k => { if (!M.productes.some(p => p.id === k)) delete S.cistella[k]; });
  const ids = Object.keys(S.cistella);
  if (!ids.length) S.reserva = null;
  if (!M || S.vista !== 'venda' || !ids.length) { el.innerHTML = ''; return; }
  const n = suma(ids.map(k => S.cistella[k]));
  const rc = S.reserva && M.reserves.find(r => r.ref === S.reserva);
  el.innerHTML = `<div class="wrap"><div class="hero cart">
    ${S.cistellaOberta ? `<div class="lines">${ids.map(k => { const p = M.productes.find(x => x.id === k); return `<div class="line"><span class="nm">${esc(p.nom)}<br><span class="muted num">${eur(p.preu)} c/u</span></span><div class="step"><button onclick="canviaQ('${k}',-1)">−</button><span class="num">${S.cistella[k]}</span><button onclick="canviaQ('${k}',1)">+</button></div></div>`; }).join('')}
      <button class="clear" onclick="S.cistella={};S.cistellaOberta=false;S.reserva=null;render()">Buidar cistella</button></div>` : ''}
    <div class="foot"><div class="sum" onclick="S.cistellaOberta=!S.cistellaOberta;render()"><div class="micro">${rc ? `Reserva ${rc.num} · ${esc(rc.nom)} · ` : ''}${n} article${n > 1 ? 's' : ''} · ${S.cistellaOberta ? 'amagar' : 'veure'}</div><div class="big num">${eur(totalCistella(M))}</div></div>
    <button class="btn go" onclick="obreCobrar()">Cobrar</button></div></div></div>`;
}

// ---------- COBRAR ----------
let pag = {};
function obreCobrar() { pag = { sel: null, rebut: null }; pintaCobrar(); }
function pintaCobrar() {
  const M = model(), t = totalCistella(M);
  const opts = [['Exacte', t], ['5 €', 500], ['10 €', 1000], ['20 €', 2000], ['50 €', 5000]];
  sheet(`<div class="hero" style="margin-bottom:16px"><div class="micro">Total a cobrar</div><div class="big num">${eur(t)}</div></div>
    <div class="micro">Ha pagat amb</div>
    <div class="bills">${opts.map(([l, v]) => `<button class="num ${pag.sel === l ? 'on' : ''}" ${v < t ? 'disabled' : ''} onclick="pag.sel='${l}';pag.rebut=${v};pintaCobrar()">${l}</button>`).join('')}
      <button class="${pag.sel === 'Altre' ? 'on' : ''}" onclick="pag.sel='Altre';pag.rebut=null;pintaCobrar()">Altre</button></div>
    ${pag.sel === 'Altre' ? `<input type="text" inputmode="decimal" id="cust" placeholder="Import rebut, p. ex. 12,50" oninput="pag.rebut=parseEur(this.value);actualitzaCanvi()">` : ''}
    <div id="chg"></div>
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" id="okbtn" onclick="confirmaVenda()">Confirmar venda</button></div>`);
  actualitzaCanvi();
  if (pag.sel === 'Altre') $('#cust').focus();
}
function actualitzaCanvi() {
  const t = totalCistella(model()), g = pag.rebut;
  let h;
  if (g == null) h = `<div class="change"><span class="muted">Tria amb què paga per veure el canvi</span></div>`;
  else if (g < t) h = `<div class="change bad"><div class="micro">Falten</div><b class="num">${eur(t - g)}</b></div>`;
  else h = `<div class="change good"><div class="micro">${g === t ? 'Import just' : 'Has de tornar'}</div><b class="num">${eur(g - t)}</b></div>`;
  $('#chg').innerHTML = h;
  $('#okbtn').disabled = g == null || g < t;
}
function confirmaVenda() {
  const M = model();
  const linies = Object.entries(S.cistella).map(([id, q]) => { const p = M.productes.find(x => x.id === id); return { producte: id, nom: p.nom, quantitat: q, preu: p.preu }; });
  if (!linies.length) return tanca();
  const ref = S.reserva;
  S.cistella = {}; S.cistellaOberta = false; S.reserva = null;
  tanca();
  afegeixOp(Object.assign({ tipus: 'venda', linies, import: suma(linies.map(l => l.quantitat * l.preu)) }, ref ? { ref } : {}));
  toast(S.xarxa === 'error' ? 'Venda guardada al mòbil. S\'enviarà quan hi hagi connexió.' : ref ? 'Reserva recollida i cobrada' : 'Venda guardada');
}

// ---------- PRODUCTE QUE NO ÉS A LA LLISTA ----------
function nouProducte() {
  const esLlibre = /llibre/i.test(S.tab);
  sheet(`<h2>${esLlibre ? 'Llibre' : 'Producte'} que no és a la llista</h2>
    <label class="micro" for="bt">${esLlibre ? 'Títol' : 'Nom'}</label><input type="text" id="bt">
    <label class="micro" for="bp">Preu de venda</label><input type="text" id="bp" inputmode="decimal" placeholder="p. ex. 18,95">
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="desaProducte()">Afegir a la cistella</button></div>`);
  $('#bt').focus();
}
function desaProducte() {
  const nom = $('#bt').value.trim(), preu = parseEur($('#bp').value);
  if (!nom || !preu) { toast('Falta el nom o el preu'); return; }
  const M = model();
  const germa = M.productes.find(p => p.categoria === S.tab);
  const id = 'L' + nouId();
  tanca();
  afegeixOp({ tipus: 'producte', producte: { id, nom, categoria: S.tab, proveidor: germa ? germa.proveidor : '', preu, inicial: 1 } });
  S.cistella[id] = 1;
  render();
}

// ---------- CANVI INICIAL I RECOMPTE ----------
function canviSheet() {
  const M = model(), has = M && M.canvi != null;
  sheet(`<h2>Amb quant canvi comences?</h2><p class="muted" style="margin-bottom:12px">Compta els diners que hi ha a la caixa abans de la primera venda.</p>
    <label class="micro" for="ci">Canvi inicial</label><input type="text" id="ci" inputmode="decimal" placeholder="p. ex. 50,00" value="${has ? euroText(M.canvi) : ''}">
    <div class="row"><button class="btn sec" onclick="tanca()">${has ? 'Enrere' : 'Més tard'}</button><button class="btn pri" onclick="desaCanvi()">${has ? 'Desar' : 'Començar a vendre'}</button></div>`);
  $('#ci').focus();
}
function desaCanvi() {
  const v = parseEur($('#ci').value);
  if (v == null || v < 0) { toast('Import no vàlid'); return; }
  tanca();
  afegeixOp({ tipus: 'canvi', import: v });
  toast(`Canvi inicial: ${eur(v)}`);
}
function recompteSheet() {
  sheet(`<h2>Comptar la caixa</h2><p class="muted" style="margin-bottom:12px">Compta tots els diners que hi ha a la caixa i posa el total. L'app et dirà si quadra.</p>
    <label class="micro" for="rc">Diners comptats</label><input type="text" id="rc" inputmode="decimal" placeholder="p. ex. 432,50">
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="desaRecompte()">Desar</button></div>`);
  $('#rc').focus();
}
function desaRecompte() {
  const v = parseEur($('#rc').value);
  if (v == null || v < 0) { toast('Import no vàlid'); return; }
  tanca();
  afegeixOp({ tipus: 'recompte', import: v });
}

// ---------- TOTALS ----------
function vTotals(M) {
  const ok = M.vendes.filter(v => !v.anulada);
  let h = `<div class="hero"><div class="micro">Vendes a la parada</div><div class="big num">${eur(M.totalVendes)}</div>
    <div class="sub"><div><span class="micro">Vendes</span><b class="num">${ok.length}</b></div><div><span class="micro">Articles</span><b class="num">${suma(ok.map(v => suma(v.linies.map(l => l.quantitat))))}</b></div><div><span class="micro">Anul·lades</span><b class="num">${M.vendes.length - ok.length}</b></div></div></div>
    <div class="label">Últimes vendes</div>`;
  if (!M.vendes.length) return h + `<p class="muted">Encara no hi ha cap venda.</p>`;
  h += `<div class="panel">${[...M.vendes].reverse().map((v, i) => `<div class="r sale ${v.anulada ? 'void' : ''}"><div class="t">
      <div class="muted num">#${M.vendes.length - i} · ${hhmm(v.ts)}${v.ref ? ` · reserva ${esc(v.ref.slice(1))}` : ''}${v.anulada ? ' · anul·lada' : ''}</div>
      ${v.linies.map(l => `<div>${l.quantitat}× ${esc(l.nom)}</div>`).join('')}</div>
      <div style="text-align:right"><div class="v num">${eur(v.total)}</div>${v.anulada ? '' : `<button class="txtbtn" onclick="anulla('${v.op}')">Anul·lar</button>`}</div></div>`).join('')}</div>`;
  return h;
}
function anulla(op) {
  const v = model().vendes.find(x => x.op === op);
  if (!v || !confirm(`Anul·lar aquesta venda de ${eur(v.total)}? Les unitats tornaran a l'estoc.`)) return;
  afegeixOp({ tipus: 'anulacio', ref: op, import: v.total });
  toast('Venda anul·lada');
}

// ---------- VENDA FORA DE LA PARADA ----------
function vFora(M) {
  const nom = esc(M.fora), nOut = suma(Object.values(M.sortides));
  let chip, cos;
  if (!M.retornat) {
    chip = nOut ? '<span class="chip amber">A fora</span>' : '<span class="chip grey">Res a fora</span>';
    cos = alfa(M.productes.filter(p => M.sortides[p.id])).map(p => `<div class="r"><span>${esc(p.nom)}</span><span class="v num">${M.sortides[p.id]}</span></div>`).join('')
      + `<div class="btns"><button class="btn sec" onclick="sortida()">S'endu productes</button><button class="btn pri" onclick="retorn()" ${nOut ? '' : 'disabled'}>Registrar retorn</button></div>`;
  } else {
    const ret = suma(Object.values(M.retorns)), pen = M.foraDeu - M.totalDiners;
    chip = pen > 0 ? '<span class="chip amber">Pendent de cobrar</span>' : '<span class="chip green">Liquidat</span>';
    cos = `<div class="r"><span>Endutes / retornades</span><span class="v num">${nOut} / ${ret}</span></div>
      <div class="r"><span>Venudes</span><span class="v num">${nOut - ret}</span></div>
      <div class="r"><span>Ha de portar</span><span class="v num">${eur(M.foraDeu)}</span></div>
      ${M.diners.map(m => `<div class="r"><span class="muted num">Rebut ${esc(dataCurta(m.ts))} ${hhmm(m.ts)}</span><span class="v num">${eur(m.import)}</span></div>`).join('')}
      <div class="r tot"><span>Pendent</span><span class="v num" style="color:${pen > 0 ? 'var(--amber)' : 'var(--good)'}">${eur(pen)}</span></div>
      ${pen > 0 ? '<div class="btns"><button class="btn pri" onclick="diners()">Anotar diners rebuts</button></div>' : ''}`;
  }
  return `<div class="label">${nom} · venda fora de la parada</div><div class="panel"><div class="r"><b>${nom}</b>${chip}</div>${cos}</div>`;
}
let tmp = {};
function sortida() { tmp = {}; pintaSortida(); }
function pintaSortida() {
  const M = model();
  sheet(`<h2>${esc(M.fora)} s'endu…</h2><div class="panel">
    ${alfa(M.productes.filter(p => !M.amagades.includes(p.categoria))).map(p => `<div class="line"><span class="nm">${esc(p.nom)}<br><span class="muted num">A la parada: ${p.queda}</span></span>
      <div class="step"><button onclick="tmp['${p.id}']=Math.max(0,(tmp['${p.id}']||0)-1);pintaSortida()">−</button><span class="num">${tmp[p.id] || 0}</span><button onclick="tmp['${p.id}']=(tmp['${p.id}']||0)+1;pintaSortida()">+</button></div></div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="desaSortida()">Confirmar sortida</button></div>`);
}
function desaSortida() {
  const M = model();
  const linies = Object.entries(tmp).filter(([, q]) => q > 0).map(([id, q]) => { const p = M.productes.find(x => x.id === id); return { producte: id, nom: p.nom, quantitat: q, preu: p.preu }; });
  tanca();
  if (!linies.length) return;
  afegeixOp({ tipus: 'sortida', linies });
  toast('Sortida anotada');
}
function retorn() { tmp = {}; pintaRetorn(); }
function pintaRetorn() {
  const M = model();
  const ps = alfa(M.productes.filter(p => M.sortides[p.id]));
  const deu = suma(ps.map(p => (M.sortides[p.id] - (tmp[p.id] || 0)) * p.preu));
  sheet(`<h2>${esc(M.fora)} torna…</h2><p class="muted" style="margin-bottom:10px">Compta el que torna i posa-ho aquí.</p><div class="panel">
    ${ps.map(p => { const q = M.sortides[p.id]; return `<div class="line"><span class="nm">${esc(p.nom)}<br><span class="muted num">Se'n va endur ${q} · venudes ${q - (tmp[p.id] || 0)}</span></span>
      <div class="step"><button onclick="tmp['${p.id}']=Math.max(0,(tmp['${p.id}']||0)-1);pintaRetorn()">−</button><span class="num">${tmp[p.id] || 0}</span><button onclick="tmp['${p.id}']=Math.min(${q},(tmp['${p.id}']||0)+1);pintaRetorn()">+</button></div></div>`; }).join('')}</div>
    <div class="change good" style="margin-top:14px"><div class="micro">Ha de portar</div><b class="num">${eur(deu)}</b></div>
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="desaRetorn()">Confirmar retorn</button></div>`);
}
function desaRetorn() {
  const M = model();
  const linies = alfa(M.productes.filter(p => M.sortides[p.id])).map(p => ({ producte: p.id, nom: p.nom, quantitat: tmp[p.id] || 0, preu: p.preu }));
  tanca();
  afegeixOp({ tipus: 'retorn', linies });
  toast('Retorn anotat');
}
function diners() {
  const M = model(), pen = M.foraDeu - M.totalDiners;
  sheet(`<h2>Diners ${esc(de(M.fora))}</h2><p class="muted" style="margin-bottom:12px">Pendent: ${eur(pen)}. Si només en porta una part, posa el que porta.</p>
    <label class="micro" for="dr">Import rebut</label><input type="text" id="dr" inputmode="decimal" value="${euroText(pen)}">
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="desaDiners()">Anotar</button></div>`);
}
function desaDiners() {
  const a = parseEur($('#dr').value);
  if (!a) { toast('Import no vàlid'); return; }
  tanca();
  afegeixOp({ tipus: 'diners', import: a });
  toast('Diners anotats a la caixa');
}

// ---------- RESUM ----------
function vResum(M) {
  const admin = M.d.admin, esperat = (M.canvi || 0) + M.totalVendes + M.totalDiners;
  const pend = M.retornat ? M.foraDeu - M.totalDiners : 0;
  let h = `<div class="hero"><div class="micro">Hi hauria d'haver a la caixa</div><div class="big num">${eur(esperat)}</div>
    <div class="sub"><div><span class="micro">Canvi inicial</span><b class="num">${M.canvi == null ? '—' : eur(M.canvi)}</b><button class="herolink" onclick="canviSheet()">${M.canvi == null ? 'Posar' : 'Canviar'}</button></div>
    <div><span class="micro">Vendes</span><b class="num">${eur(M.totalVendes)}</b></div>
    ${M.fora ? `<div><span class="micro">${esc(de(M.fora))}</span><b class="num">${eur(M.totalDiners)}</b></div>` : ''}</div></div>`;
  if (M.canvi == null) h += `<div class="notice">Falta posar el canvi inicial de la caixa</div>`;
  if (pend > 0) h += `<div class="notice">${esc(M.fora)} encara ha de portar <span class="num">${eur(pend)}</span></div>`;
  if (M.foraUnitats) h += `<div class="notice">${esc(M.fora)} encara té ${M.foraUnitats} productes a fora</div>`;
  if (M.resPendents.length) h += `<div class="notice">${M.resPendents.length === 1 ? 'Hi ha 1 reserva' : `Hi ha ${M.resPendents.length} reserves`} per recollir</div>`;

  h += `<div class="label">Comptar la caixa</div><div class="panel">`;
  if (M.recompte != null) {
    const dif = M.recompte - esperat;
    h += `<div class="r"><span>Comptat</span><span class="v num">${eur(M.recompte)}</span></div>
      <div class="r tot"><span>Diferència</span><span class="v num" style="color:${dif === 0 ? 'var(--good)' : 'var(--amber)'}">${dif > 0 ? '+' : ''}${eur(dif)}</span></div>`;
  }
  h += `<div class="btns"><button class="btn sec" onclick="recompteSheet()">${M.recompte != null ? 'Tornar a comptar' : 'Comptar ara'}</button></div></div>`;

  if (M.fora) h += vFora(M);

  if (admin) {
    const ingres = suma(M.productes.map(p => p.venuts * p.preu));
    const ambCost = M.productes.filter(p => p.venuts && p.cost != null);
    const falten = M.productes.filter(p => p.venuts && p.cost == null).length;
    const cost = suma(ambCost.map(p => p.venuts * p.cost));
    h += `<div class="label">Benefici per a l'AFA</div>
      <div class="panel"><div class="r"><span>Venut${M.fora ? ` (parada + ${esc(M.fora)})` : ''}</span><span class="v num">${eur(ingres)}</span></div>
      <div class="r"><span>Cost del que s'ha venut</span><span class="v num">− ${eur(cost)}</span></div>
      <div class="r tot"><span>Benefici</span><span class="v num" style="color:var(--good)">${eur(ingres - cost)}</span></div></div>
      ${falten ? `<div class="notice">Falta el preu de cost de ${falten} producte${falten > 1 ? 's' : ''} venut${falten > 1 ? 's' : ''}: el benefici no és definitiu</div>` : ''}
      <div class="label">Liquidacions</div><div class="panel">
      ${liquidacions(M).map(l => `<div class="r"><span>${esc(l.nom)} · a pagar</span><span class="v num">${eur(l.pagar)}${l.faltenCost ? ' *' : ''}</span></div>
        ${l.retorna ? `<div class="r"><span>${esc(l.nom)} · a tornar</span><span class="v num">${l.tornar} unitats</span></div>` : ''}`).join('')}</div>
      ${M.foraUnitats ? `<p class="foot-note">Mentre ${esc(M.fora)} tingui productes a fora, les liquidacions no són definitives.</p>` : ''}
      <div class="btns"><button class="btn sec" onclick="descarrega()">Descarregar en Excel</button></div>`;
    const obertes = !!M.d.paradeta.reserves, enllac = urlReserves();
    const nRec = M.reserves.filter(r => r.estat === 'recollida').length, nAnul = M.reserves.filter(r => r.estat === 'anullada').length;
    h += `<div class="label">Reserves pel web</div><div class="panel">
      <div class="r"><span>${obertes ? 'La gent pot reservar des del web' : 'El web de reserves està tancat'}</span>${obertes ? '<span class="chip green">Obertes</span>' : '<span class="chip grey">Tancades</span>'}</div>
      <div class="r"><span>Per recollir · recollides · anul·lades</span><span class="v num">${M.resPendents.length} · ${nRec} · ${nAnul}</span></div>
      ${obertes ? `<div class="r"><span class="muted" style="word-break:break-all">${esc(enllac)}</span></div>` : ''}
      <div class="btns"><button class="btn sec" onclick="obreReserves(${!obertes})">${obertes ? 'Tancar-les' : 'Obrir-les'}</button>${obertes ? '<button class="btn sec" onclick="comparteixEnllac()">Compartir l\'enllaç</button>' : ''}</div></div>`;
    h += `<div class="label">Categories</div><div class="panel">
      ${M.categories.map(c => { const n = M.productes.filter(p => p.categoria === c).length; return `<button class="pick r" onclick="categoriaSheet(this.dataset.c)" data-c="${esc(c)}">
        <span><b>${esc(c)}</b><br><span class="muted">${n} producte${n === 1 ? '' : 's'}</span></span>${M.amagades.includes(c) ? '<span class="chip grey">Amagada</span>' : '<span class="chip green">A la venda</span>'}</button>`; }).join('')}
      <div class="btns"><button class="btn sec" onclick="novaCategoria()">+ Nova categoria</button></div></div>`;
  }

  M.categories.forEach(c => {
    const ambRes = M.reserves.length > 0;
    h += `<div class="label">${esc(c)}${M.amagades.includes(c) ? ' · amagada' : ''}</div><div class="panel"><table><tr><th>Producte</th><th>Inicial</th><th>Venut</th>${M.fora ? `<th>${esc(M.fora)}</th>` : ''}${ambRes ? '<th>Reserv.</th>' : ''}<th>Queda</th></tr>
      ${alfa(M.productes.filter(p => p.categoria === c)).map(p => `<tr><td>${esc(p.nom)}</td><td>${p.inicial}</td><td>${p.venuts}</td>${M.fora ? `<td>${p.alFora || ''}</td>` : ''}${ambRes ? `<td>${p.reservat || ''}</td>` : ''}<td class="${p.queda < 0 ? 'neg' : ''}">${p.queda}</td></tr>`).join('')}</table></div>`;
  });

  h += `<div class="label">Sessió</div><div class="panel">
    ${admin ? `<div class="r"><span>Mode administració</span><span class="chip green">Actiu</span></div>` : ''}
    <div class="btns">${admin
      ? (S.admin && S.admin !== S.clau ? '<button class="btn sec" onclick="surtAdmin()">Sortir de l\'administració</button>' : '')
      : '<button class="btn sec" onclick="entraAdmin()">Administració</button>'}
      <button class="btn sec" onclick="surt()">Tancar sessió</button></div></div>
    <p class="foot-note">${DEMO ? 'Mode demo. ' : ''}Aquest mòbil: ${esc(S.dispositiu)}.</p>`;
  return h;
}
function entraAdmin() {
  sheet(`<h2>Administració</h2><p class="muted" style="margin-bottom:12px">Amb la contrasenya d'administració es veuen els costos, el benefici i les liquidacions, i es poden crear paradetes i categories, i obrir les reserves pel web.</p>
    <input type="password" id="ap" placeholder="Contrasenya d'administració"><div class="err" id="aerr"></div>
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="provaAdmin()">Entrar</button></div>`);
  $('#ap').focus();
}
async function provaAdmin() {
  const v = $('#ap').value.trim();
  if (!v) return;
  $('#aerr').textContent = 'Comprovant…';
  try {
    const r = await crida({ accio: 'hola', clau: v });
    if (!r.ok || !r.admin) { $('#aerr').textContent = 'No és la contrasenya d\'administració'; return; }
    S.admin = v; LS.set('admin', v);
    tanca(); sincronitza();
  } catch (e) { $('#aerr').textContent = 'Cal connexió per comprovar-la.'; }
}
function surtAdmin() {
  S.admin = null; LS.del('admin');
  if (S.dades) { S.dades.admin = false; S.dades.productes.forEach(p => delete p.cost); delete S.dades.proveidors; }
  render(); sincronitza();
}

// ---------- RESERVES ----------
let cercaRes = '';
const normal = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function reservesSheet() {
  cercaRes = '';
  sheet(`<h2>Reserves</h2>
    <input type="search" id="rq" placeholder="Busca per nom, número o telèfon" oninput="cercaRes=this.value;pintaLlistaRes()">
    <div id="rl"></div>
    <div class="row" style="margin-top:6px"><button class="btn sec" onclick="tanca()">Tancar</button></div>`);
  pintaLlistaRes();
}
function pintaLlistaRes() {
  const M = model(), el = $('#rl');
  if (!M || !el) return;
  const f = normal(cercaRes.trim()), xifres = f.replace(/\D/g, '');
  const ordre = { pendent: 0, recollida: 1, anullada: 2 };
  const llista = M.reserves
    .filter(r => !f || normal(r.nom).includes(f) || String(r.num) === f || (xifres.length >= 3 && r.telefon.replace(/\D/g, '').includes(xifres)))
    .sort((a, b) => ordre[a.estat] - ordre[b.estat] || a.num - b.num);
  const chip = { pendent: '<span class="chip amber">Per recollir</span>', recollida: '<span class="chip green">Recollida</span>', anullada: '<span class="chip grey">Anul·lada</span>' };
  el.innerHTML = llista.length ? llista.map(r => `<div class="panel resv ${r.estat}">
      <div class="r"><span><b>${r.num} · ${esc(r.nom)}</b><br><a class="muted num" href="tel:${esc(r.telefon.replace(/[^\d+]/g, ''))}">${esc(r.telefon)}</a></span>${chip[r.estat]}</div>
      ${r.linies.map(l => `<div class="r"><span>${l.quantitat}× ${esc(l.nom)}</span><span class="v num">${eur(l.quantitat * l.preu)}</span></div>`).join('')}
      <div class="r tot"><span>Total</span><span class="v num">${eur(suma(r.linies.map(l => l.quantitat * l.preu)))}</span></div>
      ${r.estat === 'pendent' ? `<div class="btns">${M.d.admin ? `<button class="btn sec danger" data-ref="${esc(r.ref)}" onclick="anullaReserva(this.dataset.ref)">Anul·lar</button>` : ''}<button class="btn pri" data-ref="${esc(r.ref)}" onclick="recull(this.dataset.ref)">Recollir i cobrar</button></div>` : ''}
    </div>`).join('') : `<p class="muted" style="padding:10px 0 16px">${M.reserves.length ? 'Cap reserva no coincideix.' : 'Encara no hi ha cap reserva.'}</p>`;
}
function recull(ref) {
  const M = model(), r = M.reserves.find(x => x.ref === ref);
  if (!r) return;
  if (Object.keys(S.cistella).length && S.reserva !== ref && !confirm('A la cistella hi ha altres productes. Els treus i hi poses la reserva?')) return;
  S.cistella = {};
  r.linies.forEach(l => { if (M.productes.some(p => p.id === l.producte)) S.cistella[l.producte] = (S.cistella[l.producte] || 0) + l.quantitat; });
  S.reserva = ref; S.cistellaOberta = true; S.vista = 'venda';
  tanca(); render(); obreCobrar();
}
function anullaReserva(ref) {
  const r = model().reserves.find(x => x.ref === ref);
  if (!r || !confirm(`Anul·lar la reserva ${r.num} de ${r.nom}? Els productes tornaran a estar a la venda.`)) return;
  afegeixOp({ tipus: 'anulReserva', ref });
  toast('Reserva anul·lada');
  pintaLlistaRes();
}
function urlReserves() { return new URL('reserves.html', location.href).href; }
async function obreReserves(obrir) {
  try {
    const r = await crida({ accio: 'reservesObertes', paradeta: S.paradeta, obertes: obrir });
    if (!r.ok) { toast(r.error); return; }
    toast(obrir ? 'Reserves obertes' : 'Reserves tancades');
    sincronitza();
  } catch (e) { toast('Cal connexió per fer-ho.'); }
}
function comparteixEnllac() {
  const url = urlReserves();
  if (navigator.share) { navigator.share({ title: 'Reserves de la paradeta de l\'AFA', url }).catch(() => {}); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Enllaç copiat'), () => prompt('Copia l\'enllaç:', url));
  else prompt('Copia l\'enllaç:', url);
}

// ---------- CATEGORIES (administració) ----------
async function accioAdmin(p, err, fet) {
  $(err).textContent = 'Desant…';
  try {
    const r = await crida(Object.assign({ paradeta: S.paradeta }, p));
    if (!r.ok) { $(err).textContent = r.error; return null; }
    tanca(); toast(fet); sincronitza();
    return r;
  } catch (e) { $(err).textContent = 'Cal connexió per fer-ho.'; return null; }
}
function categoriaSheet(c) {
  const M = model();
  const ps = alfa(M.productes.filter(p => p.categoria === c)), amagada = M.amagades.includes(c);
  const usada = ps.some(p => M.ambMoviments.has(p.id));
  tmp = { cat: c };
  sheet(`<h2>${esc(c)}</h2><p class="muted" style="margin-bottom:12px">${ps.length} producte${ps.length === 1 ? '' : 's'}: ${ps.slice(0, 6).map(p => esc(p.nom)).join(', ')}${ps.length > 6 ? '…' : ''}</p>
    <div class="panel"><div class="r"><span>${amagada ? 'Ara no surt a la pantalla de venda.' : 'Surt a la pantalla de venda.'}</span></div>
      <div class="btns"><button class="btn sec" onclick="amagaCategoria(${!amagada})">${amagada ? 'Tornar-la a mostrar' : 'Amagar-la'}</button></div></div>
    <div class="panel" style="margin-top:12px">${usada
      ? `<div class="r"><span class="muted">No es pot esborrar perquè ja s'hi ha venut o mogut algun producte. Si l'amagues, deixa de sortir a la venda però continua comptant a la caixa, al resum i a l'Excel.</span></div>`
      : `<div class="r"><span>Esborrar la categoria i els seus productes, també del full de Google.</span></div>
        <div class="btns"><button class="btn sec danger" onclick="esborraCategoria()">Esborrar</button></div>`}</div>
    <div class="err" id="cerr"></div>
    <div class="row" style="margin-top:14px"><button class="btn sec" onclick="tanca()">Tancar</button></div>`);
}
function amagaCategoria(amagar) {
  accioAdmin({ accio: 'amagaCategoria', categoria: tmp.cat, amagar }, '#cerr', amagar ? 'Categoria amagada' : 'Categoria a la venda');
}
async function esborraCategoria() {
  if (!confirm(`Esborrar «${tmp.cat}» i tots els seus productes? No es pot desfer.`)) return;
  const r = await accioAdmin({ accio: 'esborraCategoria', categoria: tmp.cat }, '#cerr', 'Categoria esborrada');
  if (!r && $('#cerr') && $('#cerr').textContent === 'te-moviments') $('#cerr').textContent = 'Algú hi ha venut un producte fa poc: ja no es pot esborrar. La pots amagar.';
}
function novaCategoria() {
  const provs = (S.dades && S.dades.proveidors || []).map(p => p.nom).sort((a, b) => a.localeCompare(b, 'ca'));
  sheet(`<h2>Nova categoria</h2>
    <label class="micro" for="cn">Nom de la categoria</label><input type="text" id="cn" placeholder="p. ex. Jocs de taula">
    <label class="micro" for="cp">Proveïdor</label>
    <select id="cp" onchange="$('#cpn').hidden=this.value!=='+'"><option value="">Cap (és de l'AFA)</option>${provs.map(p => `<option>${esc(p)}</option>`).join('')}<option value="+">Un altre…</option></select>
    <div id="cpn" hidden><input type="text" id="cpx" placeholder="Nom del proveïdor">
      <label class="micro" for="cpd">Descompte que us fa (%)</label><input type="text" id="cpd" inputmode="decimal" placeholder="p. ex. 15">
      <label class="chk"><input type="checkbox" id="cpr" checked> El que sobra es torna al proveïdor</label></div>
    <div class="label" style="margin-top:16px">Primer producte</div>
    <label class="micro" for="cpn1">Nom</label><input type="text" id="cpn1">
    <label class="micro" for="cpp">Preu de venda</label><input type="text" id="cpp" inputmode="decimal" placeholder="p. ex. 24,90">
    <label class="micro" for="cpc">Preu de cost (si el deixes buit, es calcula amb el descompte)</label><input type="text" id="cpc" inputmode="decimal">
    <label class="micro" for="cpq">Quantitat</label><input type="text" id="cpq" inputmode="numeric" placeholder="p. ex. 3">
    <div class="err" id="cerr"></div>
    <div class="row"><button class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" onclick="creaCategoria()">Crear</button></div>
    <p class="foot-note">La resta de productes els pots afegir al full de Google, o a la venda amb «+ Afegir».</p>`);
  $('#cn').focus();
}
function creaCategoria() {
  const categoria = $('#cn').value.trim(), nom = $('#cpn1').value.trim(), preu = parseEur($('#cpp').value), cost = parseEur($('#cpc').value);
  const sel = $('#cp').value, proveidor = sel === '+' ? $('#cpx').value.trim() : sel;
  const inicial = parseInt($('#cpq').value, 10) || 0;
  if (!categoria) { $('#cerr').textContent = 'Falta el nom de la categoria'; return; }
  if (sel === '+' && !proveidor) { $('#cerr').textContent = 'Falta el nom del proveïdor'; return; }
  if (!nom || !preu) { $('#cerr').textContent = 'Falta el nom o el preu del primer producte'; return; }
  const descompte = sel === '+' ? $('#cpd').value.trim().replace('%', '') : '';
  accioAdmin({ accio: 'novaCategoria', categoria, proveidor, retorna: sel === '+' && $('#cpr').checked, descompte, producte: { nom, preu, cost, inicial } }, '#cerr', `Categoria «${categoria}» creada`)
    .then(r => { if (r) { S.tab = categoria; } });
}

function descarrega() {
  const M = model();
  if (!M) return;
  const n = euroText;
  const files = [['Paradeta', S.paradeta], [],
    ['Producte', 'Categoria', 'Proveïdor', 'Preu', 'Cost', 'Inicial', 'Venut a la parada', 'Venut fora', 'Queda', 'Reservat per recollir', 'Import venut', 'Cost del venut']];
  alfa(M.productes).forEach(p => files.push([p.nom, p.categoria, p.proveidor, n(p.preu), n(p.cost), p.inicial, p.venutsParada, p.venutsFora, p.queda, p.reservat,
    n(p.venuts * p.preu), p.cost == null ? '' : n(p.venuts * p.cost)]));
  files.push([], ['Caixa'], ['Canvi inicial', n(M.canvi)], ['Vendes a la parada', n(M.totalVendes)]);
  if (M.fora) files.push([`Diners ${de(M.fora)}`, n(M.totalDiners)], [`Pendent ${de(M.fora)}`, n(M.retornat ? M.foraDeu - M.totalDiners : 0)]);
  files.push(['Hi hauria d\'haver', n((M.canvi || 0) + M.totalVendes + M.totalDiners)]);
  if (M.recompte != null) files.push(['Comptat', n(M.recompte)]);
  files.push([], ['Liquidacions', 'A pagar', 'A tornar']);
  liquidacions(M).forEach(l => files.push([l.nom, n(l.pagar) + (l.faltenCost ? ' (falten costos)' : ''), l.retorna ? l.tornar : '']));
  if (M.reserves.length) {
    const estat = { pendent: 'Per recollir', recollida: 'Recollida', anullada: 'Anul·lada' };
    files.push([], ['Reserves', 'Nom', 'Telèfon', 'Productes', 'Import', 'Estat']);
    M.reserves.forEach(r => files.push([r.num, r.nom, r.telefon, r.linies.map(l => `${l.quantitat}× ${l.nom}`).join(', '),
      n(suma(r.linies.map(l => l.quantitat * l.preu))), estat[r.estat]]));
  }
  const cel = x => { const s = String(x == null ? '' : x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + files.map(f => f.map(cel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Paradeta ${S.paradeta}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- Engegar ----------
render();
if (S.clau) sincronitza();
setInterval(() => { if (document.visibilityState === 'visible') sincronitza(); }, 30000);
window.addEventListener('online', sincronitza);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronitza(); });
