/* Local-only viewer; all recorded text is rendered with textContent. */
(function (win) {
  'use strict';
  var doc = win.document, journal = win.NexusJournal, selectedId = '', currentExport = '';
  win.NexusApp = {
    getState: function () { return {settings: {controller: true}}; },
    page: function () { win.location.assign('../index.html'); },
    onChange: function () {}
  };
  var outcomeLabels = {pending: 'Fin non confirmée — le navigateur n’a pas enregistré de résultat final.', browser_error: 'Une erreur du navigateur a été enregistrée.', module_load_error: 'Le navigateur a signalé une erreur de chargement du module.', page_left: 'La page a été quittée ; l’état de la console n’est pas connu.', loader_returned: 'Le chargeur a affiché un résultat ; l’activation reste à confirmer sur la console.', gate_rejected: 'La demande de lancement a été refusée avant le chargement.', navigation_failed: 'La navigation vers le chargeur a échoué.'};
  var reportLabels = {goldhen_confirmed: 'GoldHEN confirmé sur console', power_off_reported: 'Extinction signalée', freeze_reported: 'Blocage signalé', error_reported: 'Erreur affichée', unknown: 'Non déterminé'};
  var typeLabels = {visible_state: 'État visible', browser_error: 'Erreur JavaScript', unhandledrejection: 'Erreur asynchrone', preflight: 'Vérification des fichiers', launch: 'Lancement demandé', module_load_error: 'Chargement du module', page_left: 'Sortie de la page', stage: 'Étape', pagehide: 'Page masquée ou quittée', verification_passed: 'Fichiers vérifiés', verification_error: 'Erreur de vérification', launch_requested: 'Lancement demandé', runner_entered: 'Page de lancement ouverte', gate_rejected: 'Demande de lancement refusée', navigation_error: 'Erreur de navigation', observer_unavailable: 'Suivi des étapes indisponible'};
  function el(id) { return doc.getElementById(id); }
  function add(parent, tag, className, value) {
    var element = doc.createElement(tag);
    if (className) { element.className = className; }
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }
  function date(value) {
    var parsed = new Date(value);
    if (!isFinite(parsed.getTime())) { return value || 'Date indisponible'; }
    try { return parsed.toLocaleString('fr-FR'); } catch (ignore) { return value; }
  }
  function refreshController() {
    if (win.NexusController && typeof win.NexusController.refresh === 'function') { win.NexusController.refresh(); }
  }
  function renderStorage() {
    var status = journal.status();
    el('storage-status').className = 'storage' + (status.persistent ? '' : ' warning');
    el('storage-status').textContent = status.message || 'Journal conservé dans ce navigateur. Les réglages et les sauvegardes NEXUSHEN utilisent un espace distinct.';
  }
  function prepareExport() {
    currentExport = JSON.stringify(journal.exportData(selectedId), null, 2);
    el('report-json').value = currentExport;
  }
  function choose(id) {
    selectedId = id;
    try { if (win.history && typeof win.history.replaceState === 'function') { win.history.replaceState(null, '', '#' + id); } } catch (ignore) {}
    render();
  }
  function render() {
    var attempts = journal.list(), selected = selectedId ? journal.get(selectedId) : null, i, attempt, button, events, event, block, last;
    if (!selected && attempts.length) { selected = attempts[0]; selectedId = selected.id; }
    el('attempt-list').textContent = '';
    el('empty').hidden = attempts.length > 0;
    el('detail-panel').hidden = !selected;
    for (i = 0; i < attempts.length; i += 1) {
      attempt = attempts[i];
      button = doc.createElement('button');
      button.type = 'button';
      button.className = 'attempt' + (selected && selected.id === attempt.id ? ' selected' : '');
      button.setAttribute('aria-pressed', selected && selected.id === attempt.id ? 'true' : 'false');
      button.setAttribute('data-attempt-id', attempt.id);
      add(button, 'strong', '', date(attempt.startedAt));
      add(button, 'span', '', (attempt.meta.module || 'Module') + (attempt.report ? ' · ' + reportLabels[attempt.report.outcome] : ' · Résultat à compléter'));
      button.onclick = function () { choose(this.getAttribute('data-attempt-id')); };
      el('attempt-list').appendChild(button);
    }
    renderStorage();
    if (!selected) { return; }
    el('attempt-title').textContent = date(selected.startedAt);
    el('attempt-meta').textContent = (selected.meta.module || 'Module inconnu') + ' · NEXUSHEN ' + (selected.meta.version || selected.meta.release || 'version non renseignée') + ' · Firmware déclaré par le navigateur : ' + (selected.meta.firmware || 'non renseigné');
    el('attempt-status').textContent = outcomeLabels[selected.status] || outcomeLabels.pending;
    events = selected.events;
    last = events.length ? events[events.length - 1] : null;
    el('last-observation').textContent = last ? last.message + (last.detail ? '\n' + last.detail : '') : 'La demande a été enregistrée, sans autre étape disponible.';
    el('dropped').textContent = selected.droppedEvents ? selected.droppedEvents + ' ancien(s) événement(s) retiré(s) pour limiter la taille du journal. Jusqu’à 80 événements par tentative, dans la limite globale du journal.' : '';
    el('event-list').textContent = '';
    for (i = 0; i < events.length; i += 1) {
      event = events[i];
      block = doc.createElement('article');
      block.className = 'event';
      add(block, 'span', 'event-heading', date(event.at) + ' · ' + (typeLabels[event.type] || event.type || 'Observation'));
      add(block, 'p', 'event-message', event.message);
      if (event.detail) { add(block, 'pre', 'event-detail', event.detail); }
      el('event-list').appendChild(block);
    }
    el('outcome').value = selected.report ? selected.report.outcome : 'unknown';
    el('note').value = selected.report ? selected.report.note : '';
    el('report-status').textContent = selected.report ? 'Déclaration enregistrée le ' + date(selected.report.at) + ' : ' + reportLabels[selected.report.outcome] + '.' : '';
    el('export-status').textContent = '';
    prepareExport();
    refreshController();
  }
  function selectReport(message) {
    el('report-json').focus();
    el('report-json').select();
    try { el('report-json').setSelectionRange(0, el('report-json').value.length); } catch (ignore) {}
    el('export-status').textContent = message;
  }
  if (!journal) { el('storage-status').textContent = 'Le module de journal est absent. Recharge la page depuis le dossier NEXUSHEN complet.'; return; }
  try { selectedId = decodeURIComponent(win.location.hash.slice(1)); } catch (ignore) { selectedId = ''; }
  el('refresh').onclick = function () { journal.refresh(); render(); };
  el('report-form').onsubmit = function (event) {
    if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
    if (!journal.report(selectedId, el('outcome').value, el('note').value)) { el('report-status').textContent = 'Cette tentative n’est plus disponible. Actualise le journal.'; return false; }
    render();
    if (!journal.status().persistent) { el('report-status').textContent = 'Observation gardée en mémoire seulement. Copie ou exporte ce rapport avant de partir.'; }
    return false;
  };
  el('export').onclick = function () {
    var urlApi = win.URL || win.webkitURL, url, anchor;
    prepareExport();
    if (!win.Blob || !urlApi || typeof urlApi.createObjectURL !== 'function') { selectReport('Le téléchargement n’est pas disponible ici. Copie le texte sélectionné.'); return; }
    try {
      url = urlApi.createObjectURL(new win.Blob([currentExport], {type: 'application/json;charset=utf-8'}));
      anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = 'NEXUSHEN-log-' + selectedId + '.json';
      anchor.style.display = 'none';
      doc.body.appendChild(anchor);
      anchor.click();
      doc.body.removeChild(anchor);
      win.setTimeout(function () { urlApi.revokeObjectURL(url); }, 1000);
      el('export-status').textContent = 'Téléchargement demandé. Si le navigateur ne le propose pas, utilise Copier le rapport ou sélectionne le JSON.';
    } catch (ignore) {
      if (url) { try { urlApi.revokeObjectURL(url); } catch (ignored) {} }
      selectReport('Le téléchargement n’a pas abouti ici. Copie le texte sélectionné.');
    }
  };
  el('copy').onclick = function () {
    var copied = false;
    prepareExport();
    selectReport('Le rapport est sélectionné. Copie-le avec la commande Copier du navigateur.');
    try { copied = typeof doc.execCommand === 'function' && doc.execCommand('copy'); } catch (ignore) {}
    if (copied) { el('export-status').textContent = 'Rapport copié. Tu peux le partager toi-même.'; }
  };
  render();
}(window));
