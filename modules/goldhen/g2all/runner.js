/* Only this entry point may import the unchanged upstream module after a manual launch. */
(function (win) {
  'use strict';
  var doc = win.document, gate = win.NexusGoldhenGate, intent = null, attempt = '', observer = null;
  var message = doc.getElementById('msgs');
  if (!gate || typeof gate.check !== 'function') { message.textContent = 'Module incomplet. Reviens à la page GoldHEN et relance la vérification des fichiers.'; return; }
  try {
    intent = JSON.parse(win.sessionStorage.getItem(gate.armKey) || 'null');
    win.sessionStorage.removeItem(gate.armKey);
  } catch (ignore) {}
  var reason = gate.check({protocol: win.location.protocol, userAgent: win.navigator.userAgent,
    topLevel: win.top === win, search: win.location.search, href: win.location.href,
    referrer: doc.referrer, intent: intent, now: new Date().getTime()});
  attempt = intent && typeof intent.attemptId === 'string' ? intent.attemptId : '';
  if (reason) {
    message.textContent = reason;
    try {
      if (attempt && win.NexusJournal) {
        win.NexusJournal.record(attempt, 'gate_rejected', 'Lancement refusé', reason);
        win.NexusJournal.finish(attempt, 'gate_rejected');
      }
    } catch (ignoreRejectLog) {}
    var rejectedNote = doc.getElementById('log-note');
    if (rejectedNote) { rejectedNote.textContent = 'Aucun module lancé. Reviens à la page GoldHEN.'; }
    return;
  }
  var script = doc.createElement('script');
  message.textContent = 'Lancement GoldHEN demandé. Attends le résultat du chargeur…';
  try {
    if (win.NexusGoldhenObserver) { observer = win.NexusGoldhenObserver.start(attempt); }
  } catch (ignoreObserver) {}
  if (!observer) {
    var unavailableNote = doc.getElementById('log-note');
    if (unavailableNote) { unavailableNote.textContent = 'Le journal n’a pas pu démarrer dans ce navigateur.'; }
  }
  script.type = 'module'; script.src = 'slopkit/jb.js';
  script.onerror = function () {
    message.textContent = 'Impossible de charger le module. Reviens à la page GoldHEN et vérifie les fichiers.';
    if (observer) { observer.failure('module_load_error', message.textContent); }
  };
  doc.head.appendChild(script);
}(window));
