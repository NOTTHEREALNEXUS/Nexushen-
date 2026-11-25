/* Local file verification and manual navigation only. ES5; no upstream script import. */
(function (win) {
  'use strict';
  var doc = win.document, C = win.NexusCore, G = win.NexusGoldhenGate;
  var start = doc.getElementById('launch'), verify = doc.getElementById('verify');
  var status = doc.getElementById('file-status'), fw = doc.getElementById('firmware');
  var ready = false, busy = false, current = null, stopped = false;
  var generation = 0, nextTimer = null;
  var actual = G && typeof G.firmware === 'function' ? G.firmware(win.navigator.userAgent) : '';
  fw.textContent = actual ? 'PS4 · firmware détecté : ' + actual : 'Consultation sur PC ou téléphone';
  doc.getElementById('device-note').textContent = actual === '14.02' ?
    'Après la vérification, le bouton lancera le module sur cette PS4.' :
    'Tu peux vérifier les fichiers ici. Pour lancer GoldHEN, ouvre cette même adresse depuis ta PS4 en 14.02.';
  function setStatus(message, error) { status.textContent = message; status.className = 'status' + (error ? ' error' : ''); }
  function request(url, binary, callback) {
    var xhr = new win.XMLHttpRequest(), finished = false, timeout;
    current = xhr;
    function done(err, value) {
      if (finished) { return; } finished = true; win.clearTimeout(timeout); if (current === xhr) { current = null; }
      if (!stopped) { callback(err, value); }
    }
    xhr.onload = function () { done(xhr.status === 200 ? null : new Error('HTTP ' + xhr.status + ' : ' + url), binary ? xhr.response : xhr.responseText); };
    xhr.onerror = function () { done(new Error('Lecture impossible : ' + url)); };
    xhr.onabort = function () { done(new Error('Lecture interrompue : ' + url)); };
    try {
      xhr.open('GET', url, true);
      if (binary) { xhr.responseType = 'arraybuffer'; }
      timeout = win.setTimeout(function () { done(new Error('Le serveur ne répond pas : ' + url)); xhr.abort(); }, 12000);
      xhr.send(null);
    } catch (e) { done(e); }
  }
  function finish(err, count) {
    busy = false; verify.disabled = false; ready = !err;
    start.disabled = !ready || actual !== '14.02';
    setStatus(err ? err.message + ' — Reviens à la page GoldHEN et relance la vérification. Si cela persiste, signale le fichier indiqué.' :
      count + ' fichiers vérifiés : tailles et SHA-256 conformes aux références publiées. Aucun lancement effectué.', !!err);
  }
  function checkFiles() {
    if (busy || stopped) { return; }
    var job = ++generation;
    win.clearTimeout(nextTimer); nextTimer = null;
    ready = false; start.disabled = true;
    if (!/^https?:$/.test(win.location.protocol)) { finish(new Error('Ouvre le module depuis le site NEXUSHEN en HTTP ou HTTPS')); return; }
    if (!C || !G || !win.XMLHttpRequest || !win.Uint8Array) { finish(new Error('La vérification des fichiers est indisponible dans ce navigateur')); return; }
    busy = true; verify.disabled = true; setStatus('Vérification des fichiers du module…', false);
    request('../assets.json', false, function (err, raw) {
      if (stopped || job !== generation) { return; }
      if (err) { finish(err); return; }
      var manifest, i = 0;
      try {
        manifest = JSON.parse(raw);
        if (manifest.format !== 'nexushen-local-goldhen-assets' || manifest.firmware !== '14.02' || !Array.isArray(manifest.files) || manifest.files.length < 9 || manifest.files.length > 32) { throw new Error('Liste des fichiers invalide'); }
        manifest.files.forEach(function (f) {
          if (!/^g2all\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(f.path) || /(^|\/)\.\.?($|\/)/.test(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256) || typeof f.size !== 'number' || f.size <= 0 || f.size > 2 * 1024 * 1024) { throw new Error('Référence de fichier invalide'); }
        });
      } catch (e) { finish(new Error('La liste des fichiers du module est incomplète ou invalide')); return; }
      function next() {
        if (stopped || job !== generation) { return; }
        nextTimer = null;
        if (i === manifest.files.length) { finish(null, i); return; }
        var item = manifest.files[i];
        setStatus('Vérification ' + (i + 1) + '/' + manifest.files.length + ' · ' + item.path.replace('g2all/', ''), false);
        request('../' + item.path, true, function (error, buffer) {
          if (stopped || job !== generation) { return; }
          if (error) { finish(error); return; }
          try {
            if (!buffer || buffer.byteLength !== item.size || C.sha256(new Uint8Array(buffer)) !== item.sha256) { throw new Error('Fichier absent, incomplet ou différent : ' + item.path); }
          } catch (e) { finish(e); return; }
          i++; nextTimer = win.setTimeout(next, 0);
        });
      }
      next();
    });
  }
  verify.addEventListener('click', checkFiles, false);
  start.addEventListener('click', function () {
    if (!ready || busy || actual !== '14.02' || start.disabled) { return; }
    try {
      win.sessionStorage.setItem(G.armKey, JSON.stringify({version: 1, firmware: actual, createdAt: new Date().getTime()}));
      if (win.NexusController) { win.NexusController.stop(); }
      start.disabled = true; win.location.assign('run.html' + G.query);
    } catch (e) {
      try { win.sessionStorage.removeItem(G.armKey); } catch (ignore) {}
      if (win.NexusController) { win.NexusController.refresh(); }
      ready = false; start.disabled = true;
      setStatus('Le navigateur ne permet pas de préparer le lancement : ' + e.message, true);
    }
  }, false);
  win.addEventListener('pagehide', function () { stopped = true; generation++; win.clearTimeout(nextTimer); nextTimer = null; if (current) { current.abort(); } }, false);
  win.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      stopped = false; busy = false;
      if (win.NexusController) { win.NexusController.refresh(); }
      checkFiles();
    }
  }, false);
  /* Reuse the dashboard's keyboard/gamepad navigation on the landing page only. */
  win.NexusApp = {
    getState: function () { return {settings: {controller: true}}; },
    page: function () { win.location.assign('../../../index.html#payloads'); },
    onChange: function () {}
  };
  checkFiles();
}(window));
