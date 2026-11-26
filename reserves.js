'use strict';
/*
 * Paradeta AFA — web de reserves (pública, sense contrasenya).
 * La gent tria el que vol, posa nom i telèfon, i ho paga en efectiu quan ho recull a la parada.
 * Només surten les paradetes amb les reserves obertes (Resum › Reserves pel web, a l'app).
 */
const $ = s => document.querySelector(s);
const eur = c => ((c || 0) / 100).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alfa = arr => [...arr].sort((a, b) => a.nom.localeCompare(b.nom, 'ca', { sensitivity: 'base' }));
const dataLlarga = iso => iso ? new Date(iso).toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
const DEMO = !window.PARADETA_API;

const R = { estat: 'carregant', paradetes: [], par: null, triat: {}, resultat: null, enviant: false, codi: null };

function meves() { try { return JSON.parse(localStorage.getItem('pa.mevesReserves')) || []; } catch (e) { return []; } }
function desaMeva(x) { try { localStorage.setItem('pa.mevesReserves', JSON.stringify(meves().concat([x]).slice(-20))); } catch (e) {} }

async function crida(p) {
  if (DEMO) {
    await new Promise(r => setTimeout(r, 250));
    return JSON.parse(JSON.stringify(window.demoServidor(p)));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(window.PARADETA_API, { method: 'POST', body: JSON.stringify(p), signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// El que es va veure l'última vegada: surt de seguida mentre es carrega el que hi ha ara
function desat() { try { return JSON.parse(localStorage.getItem('pa.publica')); } catch (e) { return null; } }
function posa(paradetes) {
  R.paradetes = paradetes;
  if (!R.paradetes.some(x => x.nom === R.par)) R.par = R.paradetes.length ? R.paradetes[0].nom : null;
  R.estat = 'ok';
}

async function carrega(silenci) {
  if (!silenci) {
    const d = desat();
    if (d && R.estat === 'carregant') { posa(d); R.actualitzant = true; } else R.estat = 'carregant';
    pinta();
  }
  try {
    const r = await crida({ accio: 'publica' });
    if (!r.ok) throw r;
    posa(r.paradetes);
    try { localStorage.setItem('pa.publica', JSON.stringify(r.paradetes)); } catch (e) {}
  } catch (e) {
    if (!silenci && !R.actualitzant) R.estat = 'error';
  }
  R.actualitzant = false;
  pinta();
}

const par = () => R.paradetes.find(x => x.nom === R.par);
const triats = () => { const P = par(); return P ? P.productes.filter(p => R.triat[p.id]) : []; };
const total = () => triats().reduce((s, p) => s + p.preu * R.triat[p.id], 0);
const unitats = () => triats().reduce((s, p) => s + R.triat[p.id], 0);

function pinta() {
  let h = `<div class="app"><header><div class="hrow"><img class="logo" src="logo.png" alt="AFA Escola Mont-roig-Darnius"></div></header><main class="pub">`;
  if (DEMO) h = '<div class="demo">Mode demo: les reserves es guarden només en aquest navegador.</div>' + h;
  h += `<h2 class="ptitle">Reserves</h2>`;
  if (R.actualitzant && !R.resultat) h += `<p class="muted" style="margin:-6px 0 10px">Actualitzant…</p>`;
  if (R.resultat) h += vResultat();
  else if (R.estat === 'carregant') h += `<div class="panel empty"><p class="muted">Carregant…</p></div>`;
  else if (R.estat === 'error') h += `<div class="panel empty"><b>No s'ha pogut carregar</b><p class="muted">Comprova la connexió.</p><div class="btns"><button class="btn sec" onclick="carrega()">Tornar-ho a provar</button></div></div>`;
  else if (!R.paradetes.length) h += `<div class="panel empty"><b>Ara no hi ha reserves obertes</b><p class="muted">Quan l'AFA obri les reserves d'una paradeta, les podràs fer aquí.</p></div>`;
  else h += vProductes();
  h += `</main></div><div class="cartbar pub" id="cartbar"></div>`;
  $('#arrel').innerHTML = h;
  pintaBarra();
}

function vProductes() {
  const P = par();
  let h = R.paradetes.length > 1
    ? `<div class="seg">${R.paradetes.map(x => `<button class="${x.nom === R.par ? 'on' : ''}" data-n="${esc(x.nom)}" onclick="R.par=this.dataset.n;R.triat={};pinta()">${esc(x.nom)}</button>`).join('')}</div>`
    : '';
  h += `<div class="hero"><div class="micro">Paradeta</div><div class="big">${esc(P.nom)}</div>
    <p class="herotext">${P.data ? `El ${esc(dataLlarga(P.data))}. ` : ''}Reserva el que vulguis i paga-ho en efectiu quan ho recullis a la parada.</p></div>`;
  const fetes = meves().filter(x => x.paradeta === P.nom);
  if (fetes.length) h += `<div class="notice ok">Ja tens ${fetes.length === 1 ? 'la reserva' : 'les reserves'} ${fetes.map(x => 'núm. ' + x.numero).join(', ')}.</div>`;
  const cats = [];
  P.productes.forEach(p => { if (!cats.includes(p.categoria)) cats.push(p.categoria); });
  cats.forEach(c => {
    h += `<div class="label">${esc(c)}</div><div class="panel">${alfa(P.productes.filter(p => p.categoria === c)).map(p => {
      const n = R.triat[p.id] || 0, esgotat = p.queden <= 0;
      return `<div class="line ${esgotat ? 'off' : ''}"><span class="nm"><b>${esc(p.nom)}</b><br><span class="muted num">${eur(p.preu)} · ${esgotat ? 'Esgotat' : `Queden ${p.queden}`}</span></span>
        ${esgotat ? '' : `<div class="step"><button aria-label="Treure un" data-id="${esc(p.id)}" onclick="canvia(this.dataset.id,-1)" ${n ? '' : 'disabled'}>−</button><span class="num">${n}</span><button aria-label="Afegir un" data-id="${esc(p.id)}" onclick="canvia(this.dataset.id,1)" ${n >= p.queden ? 'disabled' : ''}>+</button></div>`}</div>`;
    }).join('')}</div>`;
  });
  h += `<p class="foot-note">Les reserves es paguen en efectiu quan es recullen. Si al final no la pots venir a buscar, avisa l'AFA.</p>`;
  return h;
}

function canvia(id, d) {
  const p = par().productes.find(x => x.id === id);
  const n = Math.max(0, Math.min(p.queden, (R.triat[id] || 0) + d));
  if (n) R.triat[id] = n; else delete R.triat[id];
  R.codi = null; // ha canviat la reserva: és una reserva nova
  pinta();
}

function pintaBarra() {
  const el = $('#cartbar');
  if (!el) return;
  const n = unitats();
  if (R.resultat || !n) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="wrap"><div class="hero cart"><div class="foot">
    <div class="sum"><div class="micro">${n} article${n > 1 ? 's' : ''}</div><div class="big num">${eur(total())}</div></div>
    <button class="btn go" onclick="formulari()">Reservar</button></div></div></div>`;
}

function sheet(html) { $('#overlay').innerHTML = `<div class="sheet" onclick="if(event.target===this)tanca()"><div class="pane">${html}</div></div>`; }
function tanca() { $('#overlay').innerHTML = ''; }

function formulari() {
  if (!R.codi) R.codi = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const nom = $('#rn') ? $('#rn').value : '', tel = $('#rt') ? $('#rt').value : '', com = $('#rc') ? $('#rc').value : '';
  sheet(`<h2>La teva reserva</h2>
    <div class="panel" style="margin-bottom:14px">${alfa(triats()).map(p => `<div class="r"><span>${R.triat[p.id]}× ${esc(p.nom)}</span><span class="v num">${eur(p.preu * R.triat[p.id])}</span></div>`).join('')}
      <div class="r tot"><span>Total a pagar en recollir-ho</span><span class="v num">${eur(total())}</span></div></div>
    <form onsubmit="envia(event)">
      <label class="micro" for="rn">Nom i cognom</label><input type="text" id="rn" autocomplete="name" maxlength="60" value="${esc(nom)}">
      <label class="micro" for="rt">Telèfon</label><input type="tel" id="rt" autocomplete="tel" inputmode="tel" placeholder="p. ex. 612 345 678" value="${esc(tel)}">
      <label class="micro" for="rc">Comentari <span style="text-transform:none;letter-spacing:0">(opcional)</span></label><textarea id="rc" rows="2" maxlength="200" placeholder="p. ex. passaré a recollir-ho cap a les 6">${esc(com)}</textarea>
      <div class="hp" aria-hidden="true"><label for="rw">Web</label><input type="text" id="rw" tabindex="-1" autocomplete="off"></div>
      <div class="err" id="rerr"></div>
      <div class="row"><button type="button" class="btn sec" onclick="tanca()">Enrere</button><button class="btn pri" id="rok">Confirmar la reserva</button></div>
    </form>
    <p class="foot-note">Només fem servir el nom, el telèfon i el comentari per trobar la teva reserva a la parada o trucar-te si cal. Els esborrem després de la paradeta.</p>`);
  if (!nom) $('#rn').focus();
}

async function envia(e) {
  e.preventDefault();
  if (R.enviant) return;
  const nom = $('#rn').value.trim(), telefon = $('#rt').value.trim(), comentari = $('#rc').value.trim();
  if (nom.length < 2) { $('#rerr').textContent = 'Posa el teu nom.'; return; }
  if (telefon.replace(/\D/g, '').length < 9) { $('#rerr').textContent = 'El telèfon no és correcte.'; return; }
  const P = par(), linies = triats().map(p => ({ producte: p.id, quantitat: R.triat[p.id] }));
  const resum = alfa(triats()).map(p => ({ nom: p.nom, quantitat: R.triat[p.id], preu: p.preu }));
  R.enviant = true;
  $('#rok').disabled = true;
  $('#rerr').textContent = 'Enviant…';
  try {
    const r = await crida({ accio: 'reserva', paradeta: P.nom, nom, telefon, comentari, linies, codi: R.codi, web: $('#rw').value });
    if (!r.ok) {
      $('#rerr').textContent = r.error;
      carrega(true).then(() => { if ($('#rn')) formulari(); });
      return;
    }
    desaMeva({ paradeta: P.nom, numero: r.numero, ts: new Date().toISOString() });
    R.resultat = { numero: r.numero, paradeta: P.nom, data: P.data, nom, comentari, linies: resum, total: resum.reduce((s, l) => s + l.preu * l.quantitat, 0) };
    R.triat = {}; R.codi = null;
    tanca(); pinta(); scrollTo(0, 0);
    carrega(true);
  } catch (err) {
    $('#rerr').textContent = 'No s\'ha pogut enviar. Comprova la connexió i torna-ho a provar.';
  } finally {
    R.enviant = false;
    if ($('#rok')) $('#rok').disabled = false;
  }
}

function vResultat() {
  const x = R.resultat;
  return `<div class="hero"><div class="micro">Reserva feta</div><div class="big">Núm. ${x.numero}</div>
      <p class="herotext">Gràcies, ${esc(x.nom.split(' ')[0])}! Recull-la i paga-la en efectiu a la paradeta ${esc(x.paradeta)}${x.data ? `, el ${esc(dataLlarga(x.data))}` : ''}. Digues el teu nom o el número de reserva.</p></div>
    <div class="label">Has reservat</div>
    <div class="panel">${x.linies.map(l => `<div class="r"><span>${l.quantitat}× ${esc(l.nom)}</span><span class="v num">${eur(l.quantitat * l.preu)}</span></div>`).join('')}
      <div class="r tot"><span>A pagar en recollir-ho</span><span class="v num">${eur(x.total)}</span></div></div>
    ${x.comentari ? `<div class="label">El teu comentari</div><div class="panel"><div class="r"><span>${esc(x.comentari)}</span></div></div>` : ''}
    <p class="foot-note">Fes una captura de pantalla d'aquesta pàgina per tenir el número a mà.</p>
    <div class="btns"><button class="btn sec" onclick="R.resultat=null;pinta()">Fer una altra reserva</button></div>`;
}

pinta();
carrega();
