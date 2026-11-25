/* NEXUSHEN: observe browser messages only; never interpret them as a kernel trace. */
(function (win) {
  'use strict';
  var active = null;
  win.NexusGoldhenObserver = {
    start: function (attempt) {
      if (active) { return active; }
      var journal = win.NexusJournal, doc = win.document;
      var note = doc.getElementById('log-note'), link = doc.getElementById('open-run-logs');
      var showReport = doc.getElementById('show-run-report'), reportPanel = doc.getElementById('run-report');
      var reportText = doc.getElementById('run-report-json');
      var nodes = [doc.getElementById('msgs'), doc.getElementById('state'), doc.getElementById('out')];
      var timer = null, last = '', lastMessage = '', lastState = '', observer = null, closed = false, explicitError = false;
      function call(method, args) {
        try { if (journal && typeof journal[method] === 'function') { return journal[method].apply(journal, args); } } catch (ignore) {}
      }
      if (!attempt || !call('get', [attempt])) {
        attempt = call('start', [{module: 'goldhen', version: '0.4.3',
          firmware: '14.02', userAgent: win.navigator.userAgent, source: 'runner'}]);
      }
      if (link && attempt) { link.href = '../../../diagnostics/index.html#' + encodeURIComponent(attempt); }
      function updateNote() {
        var state = call('status', []);
        if (note) { note.textContent = attempt ?
          'Journal actif : étapes du navigateur uniquement. Ouvre Logs pour voir ou exporter cet essai.' :
          'Le journal est indisponible dans ce navigateur. Le lancement reste manuel.'; }
        if (note && state && state.persistent === false) {
          note.textContent = 'Journal en mémoire : il peut disparaître à la fermeture de cette page.';
        }
        if (showReport) { showReport.hidden = !state || state.persistent !== false; }
      }
      function tail(node, limit) {
        var parts = [], left = limit, visited = 0;
        function walk(current) {
          var child, fragment;
          if (!current || left <= 0 || visited >= 256) { return; }
          visited++;
          if (current.nodeType === 3 || current.nodeType === 4) {
            fragment = String(current.nodeValue || '').slice(-left);
            parts.unshift(fragment); left -= fragment.length;
          } else if (current.nodeName === 'BR') { parts.unshift('\n'); left--; }
          else {
            child = current.lastChild;
            while (child && left > 0 && visited < 256) { walk(child); child = child.previousSibling; }
          }
        }
        walk(node);
        return parts.join('');
      }
      function snapshot() {
        timer = null;
        var message = tail(nodes[0], 350), state = tail(nodes[1], 200), output = tail(nodes[2], 1000);
        var combined = message + '\n' + state + '\n' + output;
        lastMessage = message; lastState = state;
        if (combined !== last) {
          last = combined;
          call('record', [attempt, 'visible_state', message || state || 'Message du chargeur',
            (state ? 'État affiché : ' + state + '\n' : '') + output]);
          updateNote();
        }
      }
      function flush() { if (timer !== null) { win.clearTimeout(timer); timer = null; } snapshot(); }
      function changed() {
        if (closed) { return; }
        if (tail(nodes[0], 350) !== lastMessage || tail(nodes[1], 200) !== lastState) { flush(); return; }
        if (timer !== null) { return; }
        /* Coalesce output-only bursts; stages flush immediately. No heartbeat or polling. */
        timer = win.setTimeout(snapshot, 1000);
      }
      function failure(kind, text, detail) {
        flush();
        explicitError = true;
        call('record', [attempt, kind, text, detail || '']);
        call('finish', [attempt, kind === 'module_load_error' ? kind : 'browser_error']);
        updateNote();
      }
      function error(event) {
        var filename = String(event.filename || '').split(/[?#]/)[0].split('/').pop();
        failure('browser_error', String(event.message || 'Erreur JavaScript signalée par le navigateur'),
          (filename ? filename + ' ' : '') + 'ligne ' + (event.lineno || '?') + ', colonne ' + (event.colno || '?'));
      }
      function rejection(event) {
        var value;
        try { value = event.reason && event.reason.message ? event.reason.message : String(event.reason || 'Motif indisponible'); }
        catch (ignore) { value = 'Motif indisponible'; }
        failure('browser_error', 'Promesse JavaScript rejetée', value);
      }
      function pagehide() {
        flush(); closed = true;
        if (observer) { observer.disconnect(); }
        call('record', [attempt, 'page_left', 'La page de lancement a été quittée',
          'Une fermeture ou une navigation ne confirme ni une réussite, ni un kernel panic.']);
        if (!explicitError) { call('finish', [attempt, 'page_left']); }
      }
      call('record', [attempt, 'runner_entered', 'Demande manuelle acceptée', 'Le chargeur va être chargé.']);
      if (showReport && reportPanel && reportText) {
        showReport.onclick = function () {
          flush();
          reportText.value = JSON.stringify(call('exportData', [attempt]), null, 2);
          reportPanel.hidden = false; reportText.focus(); reportText.select();
        };
      }
      snapshot(); updateNote();
      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver(changed);
        nodes.forEach(function (node) {
          if (node) { observer.observe(node, {childList: true, characterData: true, subtree: true}); }
        });
      } else {
        call('record', [attempt, 'observer_unavailable', 'Suivi des messages indisponible', 'Les erreurs JavaScript restent observées.']);
      }
      win.addEventListener('error', error, false);
      win.addEventListener('unhandledrejection', rejection, false);
      win.addEventListener('pagehide', pagehide, false);
      win.addEventListener('pageshow', function (event) {
        if (!event.persisted) { return; }
        closed = true;
        if (observer) { observer.disconnect(); }
        if (note) { note.textContent = 'Ancienne page restaurée. Consulte Logs ; elle ne relance pas le module.'; }
      }, false);
      active = {failure: failure, flush: flush, id: attempt};
      return active;
    }
  };
}(window));
