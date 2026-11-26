// Mode demo: un «full de Google» fals guardat al navegador, amb la mateixa lògica (nucli.js).
// Només s'usa si config.js no té l'adreça de Google.
(function () {
  var CLAU = 'pa.demo.fulls';
  function carrega() {
    try {
      var s = localStorage.getItem(CLAU);
      if (s) {
        var d = JSON.parse(s);
        // les dates es guarden com a text: tornen a ser dates
        (d['Moviments'] || []).forEach(function (f) { f[2] = new Date(f[2]); });
        (d['Reserves'] || []).forEach(function (f) { f[2] = new Date(f[2]); });
        d['Configuració'] = inicials()['Configuració'];
        return d;
      }
    } catch (e) {}
    return inicials();
  }
  function inicials() {
    var d = Nucli.dadesInicials();
    d['Configuració'] = [['Contrasenya venda', 'paradeta'], ['Contrasenya administració', 'administracio']];
    d['Proveïdors'] = [['Proveïdor de plantes', 45, 'Sí'], ['Llibreria', 30, 'Sí']];
    d['Paradetes'][0][3] = 'Sí'; // a la demo, les reserves pel web ja estan obertes
    var quantitats = { 'Avet gran': 4, 'Ardisia': 4, 'Antúrium': 5, 'Pensament': 40, 'Vesc de la sort': 20, 'Flor de Nadal petita': 15 };
    d['Productes'].forEach(function (f) { f[7] = quantitats[f[2]] || 10; });
    [['Llibre d\'exemple 1', 18.95, 3], ['Llibre d\'exemple 2', 14.9, 2], ['Llibre d\'exemple 3', 22, 3], ['Llibre d\'exemple 4', 9.9, 4]]
      .forEach(function (b) { d['Productes'].push(['', 'Nadal 2026', b[0], 'Llibres', 'Llibreria', b[1], '', b[2]]); });
    return d;
  }
  var fulls = carrega();
  function desa() { try { localStorage.setItem(CLAU, JSON.stringify(fulls)); } catch (e) {} }
  var magatzem = {
    llegir: function (n) { return (fulls[n] || []).map(function (f) { return f.slice(); }); },
    afegir: function (n, files) { fulls[n] = (fulls[n] || []).concat(files.map(function (f) { return f.slice(); })); desa(); },
    escriure: function (n, i, c, v) { var f = fulls[n][i]; while (f.length < c) f.push(''); f[c] = v; desa(); },
    esborrar: function (n, files) { files.slice().sort(function (a, b) { return b - a; }).forEach(function (i) { fulls[n].splice(i, 1); }); desa(); },
    bloqueja: function (fn) { return fn(); },
    uuid: function () { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
  };
  window.demoServidor = function (p) { return Nucli.respon(p, magatzem); };
  window.demoReinicia = function () { fulls = inicials(); desa(); };
})();
