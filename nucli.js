/*
 * Nucli de la Paradeta AFA.
 *
 * La mateixa lògica corre en dos llocs:
 *  - dins del full de Google (google/Codi.gs, que es construeix a partir d'aquest fitxer), i
 *  - al mode demo de l'app (app/demo.js), per poder-la provar sense Google.
 * No toca res de Google ni del navegador: tot el que llegeix i escriu passa per un «magatzem»
 * amb aquests mètodes: llegir(full), afegir(full, files), escriure(full, fila, columna, valor),
 * esborrar(full, files), bloqueja(fn) i uuid(). Les files es compten des de 0, sense la capçalera.
 *
 * Imports: l'app treballa en cèntims (enters); el full, en euros.
 */
var Nucli = (function () {
  var FULLS = {
    config: 'Configuració',
    paradetes: 'Paradetes',
    proveidors: 'Proveïdors',
    productes: 'Productes',
    moviments: 'Moviments',
    reserves: 'Reserves'
  };

  var CAPS = {
    'Configuració': ['Clau', 'Valor'],
    'Paradetes': ['Nom', 'Data', 'Ven fora', 'Reserves obertes'],
    'Proveïdors': ['Nom', 'Descompte %', 'Es retorna'],
    'Productes': ['Id', 'Paradeta', 'Nom', 'Categoria', 'Proveïdor', 'Preu venda', 'Preu cost', 'Quantitat inicial', 'Amagat'],
    'Moviments': ['Operació', 'Paradeta', 'Data i hora', 'Tipus', 'Id producte', 'Producte', 'Quantitat', 'Preu', 'Import', 'Referència', 'Dispositiu'],
    // Les reserves que es fan des del web: una fila per producte. «Codi» evita que un reenviament la dupliqui.
    'Reserves': ['Número', 'Paradeta', 'Data i hora', 'Nom', 'Telèfon', 'Id producte', 'Producte', 'Quantitat', 'Preu', 'Codi']
  };

  // Codi intern → nom que es veu al full
  var TIPUS = {
    venda: 'Venda',
    anulacio: 'Anul·lació',
    sortida: 'Sortida fora',
    retorn: 'Retorn fora',
    diners: 'Diners fora',
    canvi: 'Canvi inicial',
    recompte: 'Recompte caixa',
    anulReserva: 'Anul·lació reserva'
  };
  var CODI = {};
  Object.keys(TIPUS).forEach(function (k) { CODI[TIPUS[k]] = k; });

  function txt(v) { return v == null ? '' : String(v).trim(); }
  // Ids d'operacions, productes, referències i dispositius: només lletres, xifres, «-» i «_».
  // Així no poden portar codi ni fórmules quan l'app o el full els fan servir.
  function idOk(v) { return /^[A-Za-z0-9_-]{1,40}$/.test(v); }
  var MIN_CLAU = 8;
  function esData(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
  function num(v) {
    if (typeof v === 'number') return isNaN(v) ? null : v;
    var s = txt(v).replace(/\s|€/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); // «1.234,50»
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function cents(v) { var n = num(v); return n == null ? null : Math.round(n * 100); }
  function euros(c) { return c == null ? '' : Math.round(c) / 100; }
  function iso(v) {
    if (esData(v)) return isNaN(v.getTime()) ? '' : v.toISOString();
    return txt(v);
  }
  function siNo(v) {
    if (v === true) return true;
    var s = txt(v).toLowerCase();
    return s === 'sí' || s === 'si' || s === 's' || s === 'yes' || s === 'true';
  }

  function config(m) {
    var c = { venda: '', admin: '' };
    m.llegir(FULLS.config).forEach(function (r) {
      var k = txt(r[0]).toLowerCase();
      if (k.indexOf('venda') >= 0) c.venda = txt(r[1]);
      else if (k.indexOf('administr') >= 0) c.admin = txt(r[1]);
    });
    // Les contrasenyes massa curtes no valen: és com si no n'hi hagués (però se n'avisa)
    c.curtes = [];
    if (c.venda && c.venda.length < MIN_CLAU) { c.curtes.push('de venda'); c.venda = ''; }
    if (c.admin && c.admin.length < MIN_CLAU) { c.curtes.push('d\'administració'); c.admin = ''; }
    return c;
  }

  function rol(clau, c) {
    clau = txt(clau);
    if (!clau) return null;
    if (c.admin && clau === c.admin) return 'admin';
    if (c.venda && clau === c.venda) return 'venda';
    return null;
  }

  function paradetes(m) {
    return m.llegir(FULLS.paradetes)
      .filter(function (r) { return txt(r[0]); })
      .map(function (r) { return { nom: txt(r[0]), data: iso(r[1]), fora: txt(r[2]), reserves: siNo(r[3]) }; });
  }

  function proveidors(m) {
    var o = {};
    m.llegir(FULLS.proveidors).forEach(function (r) {
      var n = txt(r[0]);
      if (n) o[n] = { nom: n, descompte: num(r[1]), retorna: siNo(r[2]) };
    });
    return o;
  }

  // Una operació de l'app → files del full Moviments
  function filesDeOperacio(op) {
    var t = TIPUS[op.tipus];
    if (!t) throw new Error('Tipus desconegut: ' + op.tipus);
    if (op.ref && !idOk(txt(op.ref))) throw new Error('Referència no vàlida');
    if (op.dispositiu && !idOk(txt(op.dispositiu))) throw new Error('Dispositiu no vàlid');
    (op.linies || []).forEach(function (l) { if (!l || (l.producte && !idOk(txt(l.producte)))) throw new Error('Producte no vàlid'); });
    var d = new Date(op.ts || Date.now());
    function fila(prod, nom, q, preu, imp) {
      return [op.id, op.paradeta, d, t, prod || '', nom || '',
        q == null ? '' : q, preu == null ? '' : euros(preu), imp == null ? '' : euros(imp),
        op.ref || '', op.dispositiu || ''];
    }
    var lin = op.linies || [];
    if (op.tipus === 'venda') {
      if (!lin.length) throw new Error('Venda sense productes');
      return lin.map(function (l) { return fila(l.producte, l.nom, l.quantitat, l.preu, l.quantitat * l.preu); });
    }
    if (op.tipus === 'sortida' || op.tipus === 'retorn') {
      if (!lin.length) return [fila('', '', 0, null, null)];
      return lin.map(function (l) { return fila(l.producte, l.nom, l.quantitat, l.preu, null); });
    }
    if (op.tipus === 'anulacio') return [fila('', '', null, null, -Math.abs(op.import || 0))];
    return [fila('', '', null, null, op.import || 0)]; // diners, canvi, recompte
  }

  // Una fila del full Moviments → objecte per a l'app
  function objecteDeFila(r) {
    return {
      op: txt(r[0]), paradeta: txt(r[1]), ts: iso(r[2]), tipus: CODI[txt(r[3])] || txt(r[3]),
      producte: txt(r[4]), nom: txt(r[5]), quantitat: num(r[6]) || 0,
      preu: cents(r[7]), import: cents(r[8]), ref: txt(r[9])
    };
  }

  // Productes d'una paradeta. Als que s'han enganxat a mà sense id se'ls en posa un.
  // Les lectures van sense bloqueig (el bloqueig de Google és lent). Si en llegir cal escriure alguna cosa
  // (posar id a productes enganxats a mà), es para i es torna a fer amb bloqueig.
  var CAL_BLOQUEIG = { calBloqueig: true };
  function lectura(m, fn) {
    try { return fn(true); } catch (e) {
      if (e === CAL_BLOQUEIG) return m.bloqueja(function () { return fn(false); });
      throw e;
    }
  }

  function productesDe(m, nom, admin, nomesLectura) {
    var prov = proveidors(m), prods = [];
    m.llegir(FULLS.productes).forEach(function (f, i) {
      if (txt(f[1]) !== nom || !txt(f[2])) return;
      var id = txt(f[0]);
      if (!idOk(id)) { // productes enganxats a mà, sense id o amb un id estrany: se'ls en posa un
        if (nomesLectura) throw CAL_BLOQUEIG;
        id = 'P' + m.uuid().slice(0, 8);
        m.escriure(FULLS.productes, i, 0, id);
      }
      var preu = cents(f[5]) || 0, pv = prov[txt(f[4])], cost = cents(f[6]);
      if (cost == null && pv && pv.descompte != null) cost = Math.round(preu * (1 - pv.descompte / 100));
      var o = {
        id: id, nom: txt(f[2]), categoria: txt(f[3]) || 'Altres', proveidor: txt(f[4]),
        preu: preu, inicial: Math.round(num(f[7]) || 0)
      };
      if (admin) o.cost = cost;
      if (siNo(f[8])) o.amagat = true;
      prods.push(o);
    });
    return prods;
  }

  function movimentsDe(m, nom) {
    return m.llegir(FULLS.moviments).filter(function (f) { return txt(f[1]) === nom; }).map(objecteDeFila);
  }

  // Reserves d'una paradeta, agrupades per número
  function reservesDe(m, nom) {
    var per = {}, out = [];
    m.llegir(FULLS.reserves).forEach(function (f) {
      if (txt(f[1]) !== nom) return;
      var n = Math.round(num(f[0]) || 0);
      if (!n) return;
      var r = per[n];
      if (!r) { r = per[n] = { num: n, ref: 'R' + n, ts: iso(f[2]), nom: txt(f[3]), telefon: txt(f[4]), linies: [] }; out.push(r); }
      r.linies.push({ producte: txt(f[5]), nom: txt(f[6]), quantitat: Math.round(num(f[7]) || 0), preu: cents(f[8]) || 0 });
    });
    return out;
  }

  // Estat de cada reserva segons els moviments (també es fa servir a l'app):
  //  - «recollida» si hi ha una venda amb aquesta referència que no s'ha anul·lat,
  //  - «anullada» si l'administració l'ha anul·lada,
  //  - si no, «pendent».
  function estatReserves(reserves, movs) {
    var anul = {}, recollida = {}, anulRes = {};
    movs.forEach(function (x) { if (x.tipus === 'anulacio') anul[x.ref] = 1; });
    movs.forEach(function (x) {
      if (x.tipus === 'venda' && x.ref && !anul[x.op]) recollida[x.ref] = 1;
      if (x.tipus === 'anulReserva') anulRes[x.ref] = 1;
    });
    reserves.forEach(function (r) { r.estat = recollida[r.ref] ? 'recollida' : anulRes[r.ref] ? 'anullada' : 'pendent'; });
    return reserves;
  }

  // Quantes unitats queden a la parada i quantes n'hi ha de reservades i encara no recollides
  function existencies(prods, movs, reserves) {
    var anul = {}, o = {};
    movs.forEach(function (x) { if (x.tipus === 'anulacio') anul[x.ref] = 1; });
    prods.forEach(function (p) { o[p.id] = { queda: p.inicial, reservat: 0 }; });
    movs.forEach(function (x) {
      var e = o[x.producte];
      if (!e) return;
      if (x.tipus === 'venda' && !anul[x.op]) e.queda -= x.quantitat;
      if (x.tipus === 'sortida') e.queda -= x.quantitat;
      if (x.tipus === 'retorn') e.queda += x.quantitat;
    });
    estatReserves(reserves, movs).forEach(function (r) {
      if (r.estat !== 'pendent') return;
      r.linies.forEach(function (l) { if (o[l.producte]) o[l.producte].reservat += l.quantitat; });
    });
    return o;
  }

  function dades(p, m, r, nl) {
    var nom = txt(p.paradeta), admin = r === 'admin';
    var prods = productesDe(m, nom, admin, nl), movs = movimentsDe(m, nom);
    var llista = paradetes(m);
    var res = {
      ok: true, admin: admin,
      paradeta: llista.filter(function (x) { return x.nom === nom; })[0] || null,
      paradetes: llista, productes: prods, moviments: movs,
      reserves: estatReserves(reservesDe(m, nom), movs), ara: new Date().toISOString()
    };
    if (admin) {
      var prov = proveidors(m);
      res.proveidors = Object.keys(prov).map(function (k) { return prov[k]; });
    }
    return res;
  }

  // Rep operacions de l'app. Cada una té un id únic: si ja hi és, no s'escriu dues vegades.
  function enviar(p, m) {
    var ops = p.operacions || [], vistos = {}, prodIds = {}, nousMov = [], nousProd = [], rebudes = [], errors = [];
    m.llegir(FULLS.moviments).forEach(function (f) { var k = txt(f[0]); if (k) vistos[k] = 1; });
    m.llegir(FULLS.productes).forEach(function (f) { var k = txt(f[0]); if (k) prodIds[k] = 1; });
    ops.forEach(function (op) {
      try {
        if (!op || !txt(op.id)) throw new Error('Operació sense id');
        if (!idOk(txt(op.id))) throw new Error('Id d\'operació no vàlid');
        if (op.tipus === 'producte') {
          var pr = op.producte || {};
          if (!txt(pr.id) || !txt(pr.nom)) throw new Error('Producte sense id o sense nom');
          if (!idOk(txt(pr.id))) throw new Error('Id de producte no vàlid');
          if (!prodIds[pr.id]) {
            prodIds[pr.id] = 1;
            nousProd.push([pr.id, op.paradeta, txt(pr.nom), txt(pr.categoria), txt(pr.proveidor),
              euros(pr.preu), '', pr.inicial == null ? '' : pr.inicial]);
          }
        } else if (!vistos[op.id]) {
          var files = filesDeOperacio(op);
          vistos[op.id] = 1;
          nousMov = nousMov.concat(files);
        }
        rebudes.push(op.id);
      } catch (e) {
        errors.push({ id: op && op.id, error: String((e && e.message) || e) });
      }
    });
    if (nousProd.length) m.afegir(FULLS.productes, nousProd);
    if (nousMov.length) m.afegir(FULLS.moviments, nousMov);
    return { ok: true, rebudes: rebudes, errors: errors };
  }

  function novaParadeta(p, m) {
    var nom = txt(p.nom);
    if (!nom) return { ok: false, error: 'Falta el nom' };
    var ja = paradetes(m).some(function (x) { return x.nom.toLowerCase() === nom.toLowerCase(); });
    if (ja) return { ok: false, error: 'Ja hi ha una paradeta amb aquest nom' };
    m.afegir(FULLS.paradetes, [[nom, p.data ? new Date(p.data) : '', txt(p.fora)]]);
    var copiats = 0, de = txt(p.copiarDe);
    if (de) {
      var nous = m.llegir(FULLS.productes)
        .filter(function (f) { return txt(f[1]) === de && txt(f[2]); })
        .map(function (f) { return ['P' + m.uuid().slice(0, 8), nom, f[2], f[3], f[4], f[5], f[6], '']; });
      if (nous.length) m.afegir(FULLS.productes, nous);
      copiats = nous.length;
    }
    return { ok: true, copiats: copiats, paradetes: paradetes(m) };
  }

  // ---------- Categories (només l'administració) ----------
  // Una categoria no es guarda enlloc a part: és la columna «Categoria» dels productes.
  function categoria(f) { return txt(f[3]) || 'Altres'; }
  function filesCategoria(m, par, cat) {
    var out = [];
    m.llegir(FULLS.productes).forEach(function (f, i) {
      if (txt(f[1]) === par && txt(f[2]) && categoria(f).toLowerCase() === cat.toLowerCase()) out.push({ i: i, f: f });
    });
    return out;
  }

  // Crea una categoria amb el seu primer producte. Si el proveïdor és nou, l'afegeix a Proveïdors.
  function novaCategoria(p, m) {
    var par = txt(p.paradeta), cat = txt(p.categoria), pr = p.producte || {};
    if (!paradetes(m).some(function (x) { return x.nom === par; })) return { ok: false, error: 'No trobo la paradeta' };
    if (!cat) return { ok: false, error: 'Falta el nom de la categoria' };
    if (!txt(pr.nom)) return { ok: false, error: 'Falta el nom del primer producte' };
    if (!(pr.preu > 0)) return { ok: false, error: 'Falta el preu del primer producte' };
    if (filesCategoria(m, par, cat).length) return { ok: false, error: 'Ja hi ha una categoria amb aquest nom' };
    var prov = txt(p.proveidor);
    if (prov) {
      // Si el proveïdor ja hi és (escrit igual o amb altres majúscules), es fa servir aquell
      // i, si s'ha posat descompte, se li actualitza.
      var dte = num(p.descompte), fila = -1;
      m.llegir(FULLS.proveidors).forEach(function (f, i) { if (fila < 0 && txt(f[0]).toLowerCase() === prov.toLowerCase()) fila = i; });
      if (fila >= 0) {
        prov = txt(m.llegir(FULLS.proveidors)[fila][0]);
        if (dte != null) m.escriure(FULLS.proveidors, fila, 1, dte);
      } else {
        m.afegir(FULLS.proveidors, [[prov, dte == null ? '' : dte, p.retorna ? 'Sí' : 'No']]);
      }
    }
    var inicial = Math.max(0, Math.round(num(pr.inicial) || 0));
    m.afegir(FULLS.productes, [['P' + m.uuid().slice(0, 8), par, txt(pr.nom), cat, prov, euros(pr.preu),
      pr.cost == null ? '' : euros(pr.cost), inicial, '']]);
    return { ok: true };
  }

  // Amaga o torna a mostrar una categoria a la pantalla de venda. El que ja s'hi ha venut continua comptant.
  function amagaCategoria(p, m) {
    var fs = filesCategoria(m, txt(p.paradeta), txt(p.categoria));
    if (!fs.length) return { ok: false, error: 'No trobo la categoria' };
    fs.forEach(function (x) { m.escriure(FULLS.productes, x.i, 8, p.amagar ? 'Sí' : ''); });
    return { ok: true };
  }

  // Esborra una categoria i els seus productes, només si cap d'ells té vendes ni cap altre moviment.
  function esborraCategoria(p, m) {
    var fs = filesCategoria(m, txt(p.paradeta), txt(p.categoria));
    if (!fs.length) return { ok: false, error: 'No trobo la categoria' };
    var ids = {};
    fs.forEach(function (x) { var id = txt(x.f[0]); if (id) ids[id] = 1; });
    var usat = m.llegir(FULLS.moviments).some(function (f) { return ids[txt(f[4])]; });
    if (usat) return { ok: false, error: 'te-moviments' };
    m.esborrar(FULLS.productes, fs.map(function (x) { return x.i; }));
    return { ok: true, esborrats: fs.length };
  }

  // ---------- Reserves des del web (sense contrasenya) ----------
  // El que es pot reservar: paradetes amb les reserves obertes i els seus productes no amagats.
  function publica(m, nl) {
    return {
      ok: true,
      paradetes: paradetes(m).filter(function (x) { return x.reserves; }).map(function (x) {
        var prods = productesDe(m, x.nom, false, nl).filter(function (p) { return !p.amagat; });
        var ex = existencies(prods, movimentsDe(m, x.nom), reservesDe(m, x.nom));
        return {
          nom: x.nom, data: x.data,
          productes: prods.map(function (p) {
            return { id: p.id, nom: p.nom, categoria: p.categoria, preu: p.preu, queden: Math.max(0, ex[p.id].queda - ex[p.id].reservat) };
          })
        };
      })
    };
  }

  function telefonNet(t) {
    var s = txt(t).replace(/[^\d+]/g, ''), mes = s.charAt(0) === '+';
    var d = s.replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) return null;
    // «+34 612 345 678»: amb espais, perquè el full no el converteixi en número
    var pre = d.slice(0, d.length - 9), g = d.slice(-9).replace(/(\d{3})(?=\d)/g, '$1 ');
    return pre ? (mes ? '+' : '') + pre + ' ' + g : g;
  }

  function reserva(p, m) {
    if (txt(p.web)) return { ok: true, numero: 0 }; // camp parany: només l'omplen els robots
    var par = txt(p.paradeta), x = paradetes(m).filter(function (y) { return y.nom === par; })[0];
    if (!x || !x.reserves) return { ok: false, error: 'Ara no es pot reservar en aquesta paradeta.' };
    var codi = txt(p.codi);
    if (codi && !/^[a-z0-9]{8,40}$/.test(codi)) return { ok: false, error: 'Petició no vàlida. Torna a carregar la pàgina.' };
    if (codi) {
      var ja = m.llegir(FULLS.reserves).filter(function (f) { return txt(f[9]) === codi; })[0];
      if (ja) return { ok: true, numero: Math.round(num(ja[0])), repetida: true };
    }
    var nom = txt(p.nom).replace(/^[=+\-@\s]+/, '').slice(0, 60);
    if (nom.length < 2) return { ok: false, error: 'Posa el teu nom.' };
    var tel = telefonNet(p.telefon);
    if (!tel) return { ok: false, error: 'El telèfon no és correcte.' };
    // Com a molt 3 reserves per recollir amb el mateix telèfon (comparant els 9 últims números)
    var nou = tel.replace(/\D/g, '').slice(-9), movs = movimentsDe(m, par);
    var mateix = estatReserves(reservesDe(m, par), movs).filter(function (r) {
      return r.estat === 'pendent' && r.telefon.replace(/\D/g, '').slice(-9) === nou;
    }).length;
    if (mateix >= 3) return { ok: false, error: 'Amb aquest telèfon ja hi ha 3 reserves per recollir. Per fer-ne més, parla amb l\'AFA.' };
    var q = {};
    (p.linies || []).forEach(function (l) {
      var n = Math.round(num(l && l.quantitat) || 0);
      if (l && n > 0) q[txt(l.producte)] = (q[txt(l.producte)] || 0) + n;
    });
    var ids = Object.keys(q);
    if (!ids.length) return { ok: false, error: 'No has triat res.' };
    var prods = productesDe(m, par, false).filter(function (pr) { return !pr.amagat; }), per = {}, total = 0, unitats = 0;
    prods.forEach(function (pr) { per[pr.id] = pr; });
    var ex = existencies(prods, movs, reservesDe(m, par));
    for (var i = 0; i < ids.length; i++) {
      var pr = per[ids[i]];
      if (!pr) return { ok: false, error: 'Un dels productes ja no es pot reservar. Torna a carregar la pàgina.' };
      var lliures = ex[pr.id].queda - ex[pr.id].reservat;
      if (q[pr.id] > lliures) return { ok: false, error: lliures > 0 ? 'De «' + pr.nom + '» només en queden ' + lliures + '.' : '«' + pr.nom + '» ja s\'ha acabat.' };
      unitats += q[pr.id];
      total += q[pr.id] * pr.preu;
    }
    if (unitats > 30) return { ok: false, error: 'Per reservar més de 30 unitats, parla amb l\'AFA.' };
    var numero = 1;
    m.llegir(FULLS.reserves).forEach(function (f) { if (txt(f[1]) === par) numero = Math.max(numero, Math.round(num(f[0]) || 0) + 1); });
    var ara = new Date();
    m.afegir(FULLS.reserves, ids.map(function (id) {
      return [numero, par, ara, nom, tel, id, per[id].nom, q[id], euros(per[id].preu), codi];
    }));
    return { ok: true, numero: numero, total: total };
  }

  // Obre o tanca les reserves pel web d'una paradeta
  function reservesObertes(p, m) {
    var par = txt(p.paradeta), fila = -1;
    m.llegir(FULLS.paradetes).forEach(function (f, i) { if (fila < 0 && txt(f[0]) === par) fila = i; });
    if (fila < 0) return { ok: false, error: 'No trobo la paradeta' };
    m.escriure(FULLS.paradetes, fila, 3, p.obertes ? 'Sí' : '');
    return { ok: true, paradetes: paradetes(m) };
  }

  var ADMIN = { reservesObertes: reservesObertes, novaParadeta: novaParadeta, novaCategoria: novaCategoria, amagaCategoria: amagaCategoria, esborraCategoria: esborraCategoria };

  function respon(p, m) {
    try {
      p = p || {};
      // Les úniques accions sense contrasenya: veure què es pot reservar i fer una reserva
      if (p.accio === 'publica') return lectura(m, function (nl) { return publica(m, nl); });
      if (p.accio === 'reserva') return m.bloqueja(function () { return reserva(p, m); });
      var c = config(m);
      if (!c.venda && !c.admin) return { ok: false, error: 'Falten les contrasenyes: posa-les a la pestanya Configuració del full (com a mínim ' + MIN_CLAU + ' caràcters).' };
      var r = rol(p.clau, c);
      if (!r && c.curtes.length) return { ok: false, error: 'La contrasenya ' + c.curtes.join(' i la ') + ' del full té menys de ' + MIN_CLAU + ' caràcters i no val: allarga-la a la pestanya Configuració.' };
      if (!r) return { ok: false, error: 'contrasenya' };
      if (p.accio === 'hola') return { ok: true, admin: r === 'admin', paradetes: paradetes(m) };
      if (p.accio === 'dades') return lectura(m, function (nl) { return dades(p, m, r, nl); });
      if (p.accio === 'enviar') return m.bloqueja(function () {
        // Amb «ambDades», torna també les dades de la paradeta: l'app s'estalvia una segona crida
        var res = enviar(p, m);
        if (p.ambDades && txt(p.paradeta)) res.dades = dades(p, m, r, false);
        return res;
      });
      if (ADMIN[p.accio]) {
        if (r !== 'admin') return { ok: false, error: 'Només ho pot fer l\'administració' };
        return m.bloqueja(function () { return ADMIN[p.accio](p, m); });
      }
      return { ok: false, error: 'Acció desconeguda' };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  var PLANTES_NADAL = [
    ['Antúrium', 15], ['Ardisia', 18], ['Avet gran', 25], ['Avet petit', 7], ['Cactus', 5],
    ['Ciclamen', 4.5], ['Colorful', 5], ['Flor de Nadal gran', 6], ['Flor de Nadal petita', 5],
    ['Golden Cipres', 8], ['Grèvol', 3.5], ['Pensament', 1.2], ['Rhipsalis', 6], ['Spatifilium', 7],
    ['Vesc de la sort', 3], ['Zamioculcas', 7]
  ];

  // El que posa «Preparar el full» la primera vegada
  function dadesInicials() {
    return {
      // Sense contrasenyes per defecte: fins que no s'hi posen, l'app no deixa entrar
      'Configuració': [['Contrasenya venda', ''], ['Contrasenya administració', '']],
      'Paradetes': [['Nadal 2026', '', 'Alan', '']],
      'Proveïdors': [['Proveïdor de plantes', '', 'Sí'], ['Llibreria', '', 'Sí']],
      'Productes': PLANTES_NADAL.map(function (x) {
        return ['', 'Nadal 2026', x[0], 'Plantes', 'Proveïdor de plantes', x[1], '', ''];
      }),
      'Moviments': [],
      'Reserves': []
    };
  }

  return {
    FULLS: FULLS, CAPS: CAPS, TIPUS: TIPUS, PLANTES_NADAL: PLANTES_NADAL,
    respon: respon, filesDeOperacio: filesDeOperacio, objecteDeFila: objecteDeFila, estatReserves: estatReserves,
    dadesInicials: dadesInicials, txt: txt, num: num
  };
})();
