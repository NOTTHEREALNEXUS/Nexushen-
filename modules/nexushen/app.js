(function (win) {
  'use strict';
  var doc = win.document, api = win.NexusProject, core = win.NexusCore, storage = null, busy = false, downloadUrl = null;
  function el(id) { return doc.getElementById(id); }
  function status(id, message, error) { var node = el(id); node.textContent = message; node.className = id === 'file-status' ? 'status' + (error ? ' error' : '') : 'muted'; }
  if (!api || !core) { status('file-status', 'Module incomplet : recharge la page et vérifie les fichiers du site.', true); return; }
  win.NexusApp = {
    getState: function () { return {settings:{controller:true}}; },
    page: function () { win.location.assign('../../index.html'); },
    onChange: function () {}
  };
  try { storage = win.localStorage; } catch (ignore) {}
  var restored = api.load(storage), state = restored.state;
  el('source-origin').value = state.origin;
  el('project-notes').value = state.notes;
  function refreshController() { try { if (win.NexusController && win.NexusController.refresh) { win.NexusController.refresh(); } } catch (ignore) {} }
  function readNotes() { state.origin = el('source-origin').value; state.notes = el('project-notes').value; }
  function persist(message) {
    readNotes();
    try {
      var result = api.save(storage, state);
      status('save-status', result.saved ? (message || 'Dossier enregistré dans ce navigateur.') : 'Stockage local indisponible : exporte le projet JSON pour conserver ce dossier.');
      return result.text;
    } catch (error) { status('save-status', error.message); return null; }
  }
  function renderFiles() {
    var list = el('source-list'), i;
    while (list.firstChild) { list.removeChild(list.firstChild); }
    if (!state.files.length) { var empty = doc.createElement('li'); empty.className = 'empty'; empty.textContent = 'Ton inventaire est vide. Ajoute tes sources ou une archive pour commencer.'; list.appendChild(empty); }
    for (i = 0; i < state.files.length; i += 1) {
      (function (index) {
        var file = state.files[index], item = doc.createElement('li'), title = doc.createElement('span'), meta = doc.createElement('span'), hash = doc.createElement('code'), remove = doc.createElement('button');
        title.className = 'source-title'; title.textContent = file.name;
        meta.className = 'file-meta'; meta.textContent = file.size + ' octets · empreinte calculée localement';
        hash.className = 'digest'; hash.textContent = 'SHA-256 : ' + file.sha256;
        remove.type = 'button'; remove.textContent = 'Retirer de l’inventaire'; remove.setAttribute('aria-label', 'Retirer ' + file.name + ' de l’inventaire');
        remove.onclick = function () { state.files.splice(index, 1); persist('Inventaire enregistré. Le fichier original reste sur ton appareil.'); renderFiles(); };
        item.appendChild(title); item.appendChild(meta); item.appendChild(hash); item.appendChild(remove); list.appendChild(item);
      }(i));
    }
    refreshController();
  }
  renderFiles();
  status('save-status', restored.restored ? 'Le dossier valide le plus récent a été restauré depuis ce navigateur.' : restored.warning ? 'Une sauvegarde locale n’a pas pu être lue. Tu peux importer ton dernier export JSON.' : 'Prêt à créer ton dossier. Ajoute tes fichiers et enregistre les notes.');
  status('file-status', state.files.length ? state.files.length + ' fichier(s) référencé(s). Le contenu des fichiers n’est pas conservé.' : 'Aucun fichier sélectionné.');
  el('save-project').onclick = function () { persist(); };
  el('source-origin').onchange = function () { persist(); };
  el('project-notes').onchange = function () { persist(); };
  function finishSelection(added, skipped, failed) {
    busy = false; el('source-files').disabled = false; el('project-import').disabled = false; el('source-files').value = '';
    status('file-status', added + ' ajouté(s), ' + skipped + ' doublon(s), ' + failed + ' non traité(s). ' + state.files.length + '/' + api.limits.files + ' fichiers référencés.', failed > 0);
    refreshController();
  }
  el('source-files').onchange = function () {
    if (busy) { return; }
    var chosen = this.files, queue = [], i, added = 0, skipped = 0, failed = 0, cursor = 0;
    if (!chosen || !chosen.length) { return; }
    if (!win.FileReader) { status('file-status', 'Ce navigateur ne permet pas de lire les fichiers. Prépare le dossier depuis ton téléphone ou ton PC.', true); return; }
    for (i = 0; i < chosen.length; i += 1) { queue.push(chosen[i]); }
    busy = true; this.disabled = true; el('project-import').disabled = true;
    function next() {
      if (cursor >= queue.length) { finishSelection(added, skipped, failed); return; }
      var file = queue[cursor], reader; cursor += 1;
      if (file.size > api.limits.fileBytes || state.files.length >= api.limits.files || file.name.length > 255) { failed += 1; win.setTimeout(next, 0); return; }
      status('file-status', 'Empreinte ' + cursor + '/' + queue.length + ' : ' + file.name);
      reader = new win.FileReader();
      reader.onload = function () {
        try {
          var digest = core.sha256(new Uint8Array(reader.result)), duplicate = false, j;
          for (j = 0; j < state.files.length; j += 1) { if (state.files[j].name === file.name && state.files[j].size === file.size && state.files[j].sha256 === digest) { duplicate = true; break; } }
          if (duplicate) { skipped += 1; }
          else { state.files.push({name:file.name, size:file.size, sha256:digest, addedAt:new Date().toISOString()}); added += 1; persist('Inventaire enregistré.'); renderFiles(); }
        } catch (ignoreHash) { failed += 1; }
        win.setTimeout(next, 0);
      };
      reader.onerror = reader.onabort = function () { failed += 1; win.setTimeout(next, 0); };
      try { reader.readAsArrayBuffer(file); } catch (ignoreRead) { failed += 1; win.setTimeout(next, 0); }
    }
    next();
  };
  el('export-project').onclick = function () {
    var text = persist(), urlApi = win.URL || win.webkitURL, anchor;
    if (!text) { return; }
    el('project-export-copy').hidden = false; el('export-text').value = text;
    try {
      if (!urlApi || !urlApi.createObjectURL || !win.Blob) { throw new Error('Download unavailable'); }
      if (downloadUrl) { urlApi.revokeObjectURL(downloadUrl); }
      downloadUrl = urlApi.createObjectURL(new win.Blob([text], {type:'application/json'}));
      anchor = doc.createElement('a'); anchor.href = downloadUrl; anchor.download = 'NEXUSHEN-projet-0.1-' + new Date().toISOString().slice(0, 10) + '.json';
      doc.body.appendChild(anchor); anchor.click(); doc.body.removeChild(anchor);
      status('save-status', 'Export préparé. Le JSON est aussi disponible ci-dessous si le téléchargement n’est pas pris en charge.');
    } catch (ignoreDownload) { status('save-status', 'Copie le JSON ci-dessous pour conserver le dossier sur ton appareil.'); }
    refreshController();
  };
  el('export-text').onclick = function () { this.select(); };
  el('project-import').onchange = function () {
    if (busy || !this.files || !this.files[0]) { return; }
    var file = this.files[0], input = this, reader;
    if (file.size > api.limits.importBytes) { status('import-status', 'Export trop volumineux : 256 Kio maximum.'); input.value = ''; return; }
    if (!win.FileReader) { status('import-status', 'Import indisponible dans ce navigateur. Utilise un téléphone ou un PC.'); input.value = ''; return; }
    reader = new win.FileReader(); input.disabled = true; el('source-files').disabled = true;
    function done() { input.disabled = false; input.value = ''; el('source-files').disabled = false; refreshController(); }
    reader.onload = function () {
      try {
        var parsed = api.decode(reader.result);
        state = parsed.state; el('source-origin').value = state.origin; el('project-notes').value = state.notes;
        persist('Projet restauré et enregistré dans ce navigateur.'); renderFiles();
        status('import-status', 'Dossier restauré : ' + state.files.length + ' fichier(s) référencé(s).');
        status('file-status', state.files.length + ' fichier(s) référencé(s). Les fichiers originaux doivent rester sur ton appareil.');
      } catch (error) { status('import-status', 'Import refusé : ' + error.message); }
      done();
    };
    reader.onerror = reader.onabort = function () { status('import-status', 'Lecture du fichier impossible. Le dossier courant est conservé.'); done(); };
    try { reader.readAsText(file); } catch (error) { status('import-status', 'Lecture du fichier impossible.'); done(); }
  };
}(window));
