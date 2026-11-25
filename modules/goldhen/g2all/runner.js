/* Only this entry point may import the unchanged upstream module after a manual launch. */
(function (win) {
  'use strict';
  var doc = win.document, gate = win.NexusGoldhenGate, intent = null;
  var message = doc.getElementById('msgs');
  if (!gate || typeof gate.check !== 'function') { message.textContent = 'Module incomplet. Reviens à la page GoldHEN et relance la vérification des fichiers.'; return; }
  try {
    intent = JSON.parse(win.sessionStorage.getItem(gate.armKey) || 'null');
    win.sessionStorage.removeItem(gate.armKey);
  } catch (ignore) {}
  var reason = gate.check({protocol: win.location.protocol, userAgent: win.navigator.userAgent,
    topLevel: win.top === win, search: win.location.search, href: win.location.href,
    referrer: doc.referrer, intent: intent, now: new Date().getTime()});
  if (reason) { message.textContent = reason; return; }
  var script = doc.createElement('script');
  message.textContent = 'Lancement GoldHEN demandé. Attends le résultat du chargeur…';
  script.type = 'module'; script.src = 'slopkit/jb.js';
  script.onerror = function () { message.textContent = 'Impossible de charger le module. Reviens à la page GoldHEN et vérifie les fichiers.'; };
  doc.head.appendChild(script);
}(window));
