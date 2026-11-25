/* NEXUSHEN Origins — navigation spatiale locale, ES5, sans dépendance.
 * chooseTarget(rect, candidates, direction) retourne le candidat retenu ou null.
 * Un candidat est un rectangle ou {rect: rectangle, ...}; hidden/disabled et
 * focusable:false l'excluent. Cette fonction pure ne consulte jamais le DOM.
 * Le contrôleur navigateur s'initialise après NexusApp. refresh() reprend les
 * préférences; stop() suspend les commandes jusqu'à un refresh() explicite.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(null);
  } else {
    root.NexusController = factory(root);
  }
}(typeof window !== 'undefined' ? window : this, function (win) {
  'use strict';

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  function rectangle(value) {
    if (!value) { return null; }
    var left = finite(value.left) ? value.left : value.x;
    var top = finite(value.top) ? value.top : value.y;
    var right = finite(value.right) ? value.right : left + value.width;
    var bottom = finite(value.bottom) ? value.bottom : top + value.height;
    if (!finite(left) || !finite(top) || !finite(right) || !finite(bottom) || right <= left || bottom <= top) { return null; }
    return {left: left, top: top, right: right, bottom: bottom, cx: (left + right) / 2, cy: (top + bottom) / 2};
  }

  function chooseTarget(origin, candidates, direction) {
    var source = rectangle(origin), horizontal = direction === 'left' || direction === 'right';
    if (!source || !candidates || (!horizontal && direction !== 'up' && direction !== 'down')) { return null; }
    var sign = direction === 'left' || direction === 'up' ? -1 : 1;
    var best = null, bestScore = Infinity, i, item, target, forward, edge, gap, cross, score;
    for (i = 0; i < candidates.length; i++) {
      item = candidates[i];
      if (!item || item.hidden || item.disabled || item.focusable === false) { continue; }
      target = rectangle(item.rect || item);
      if (!target) { continue; }
      forward = sign * (horizontal ? target.cx - source.cx : target.cy - source.cy);
      if (forward <= 0.5) { continue; }
      if (horizontal) {
        edge = Math.max(0, sign > 0 ? target.left - source.right : source.left - target.right);
        gap = Math.max(0, Math.max(source.top, target.top) - Math.min(source.bottom, target.bottom));
        cross = Math.abs(target.cy - source.cy);
      } else {
        edge = Math.max(0, sign > 0 ? target.top - source.bottom : source.top - target.bottom);
        gap = Math.max(0, Math.max(source.left, target.left) - Math.min(source.right, target.right));
        cross = Math.abs(target.cx - source.cx);
      }
      /* Les éléments alignés sont privilégiés, sans saut vers un contrôle
       * éloigné lorsqu'un voisin diagonal est beaucoup plus proche. */
      score = edge * edge + 5 * gap * gap + 0.3 * cross * cross + 0.05 * forward * forward;
      if (score < bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  var api = {chooseTarget: chooseTarget};
  if (!win || !win.document) { return api; }

  var doc = win.document;
  var timer = null, inPoll = false, manualStop = false, pageSuspended = false;
  var enabled = false, apiFailed = false, highlighted = null, editing = null;
  var lastStatus = '', padKey = '', needsNeutral = true;
  var directionState = {name: '', next: 0};
  var actionState = {accept: false, back: false};
  var REPEAT_DELAY = 450, REPEAT_INTERVAL = 250, POLL_INTERVAL = 100;

  function app() { return win.NexusApp; }
  function element(id) { return doc.getElementById(id); }
  function isHiddenDocument() { return !!doc.hidden || doc.visibilityState === 'hidden'; }
  function allowed() { return enabled && !manualStop && !pageSuspended && !isHiddenDocument(); }

  function setStatus(value) {
    var target = element('controller-status');
    if (target && (value !== lastStatus || target.textContent !== value)) { target.textContent = value; }
    lastStatus = value;
  }

  function getPadMethod() {
    var nav = win.navigator;
    if (!nav) { return null; }
    if (typeof nav.getGamepads === 'function') { return nav.getGamepads; }
    if (typeof nav.webkitGetGamepads === 'function') { return nav.webkitGetGamepads; }
    return null;
  }

  function visible(node) {
    if (!node || node.nodeType !== 1) { return false; }
    var ancestor = node, style, rect;
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor.hidden || ancestor.getAttribute('hidden') !== null || ancestor.getAttribute('aria-hidden') === 'true' || ancestor.getAttribute('inert') !== null) { return false; }
      if (typeof win.getComputedStyle === 'function') {
        try { style = win.getComputedStyle(ancestor, null); } catch (ignoreStyle) { style = null; }
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')) { return false; }
      }
      ancestor = ancestor.parentNode;
    }
    try { rect = node.getBoundingClientRect(); } catch (ignoreRect) { return false; }
    return !!rectangle(rect);
  }

  function focusable(node) {
    if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') { return false; }
    var tabindex = node.getAttribute('tabindex'), parent = node.parentNode;
    if (tabindex !== null && parseInt(tabindex, 10) < 0) { return false; }
    if (String(node.tagName).toLowerCase() === 'input' && String(node.type).toLowerCase() === 'hidden') { return false; }
    while (parent && parent.nodeType === 1) {
      if (String(parent.tagName).toLowerCase() === 'fieldset' && parent.disabled) { return false; }
      parent = parent.parentNode;
    }
    return typeof node.focus === 'function';
  }

  function scope() {
    var boot = element('boot-overlay'), fallback = element('export-fallback');
    if (visible(boot)) { return boot; }
    if (visible(fallback)) { return fallback; }
    return doc;
  }

  function candidates() {
    var nodes = scope().querySelectorAll('a[href],button,input,textarea,select,[tabindex]');
    var result = [], i;
    for (i = 0; i < nodes.length; i++) {
      if (focusable(nodes[i])) { result.push({element: nodes[i], rect: nodes[i].getBoundingClientRect()}); }
    }
    return result;
  }

  function removeRing() {
    if (highlighted && typeof highlighted.className === 'string') {
      highlighted.className = highlighted.className.replace(/(^|\s)nexus-focus(?=\s|$)/g, ' ').replace(/^\s+|\s+$/g, '');
    }
    highlighted = null;
  }

  function ring(node) {
    if (node === highlighted) { return; }
    removeRing();
    if (!node || typeof node.className !== 'string') { return; }
    node.className += (node.className ? ' ' : '') + 'nexus-focus';
    highlighted = node;
  }

  function scrollToControl(node) {
    if (typeof node.scrollIntoView !== 'function') { return; }
    var rect = node.getBoundingClientRect();
    var height = win.innerHeight || doc.documentElement.clientHeight;
    var width = win.innerWidth || doc.documentElement.clientWidth;
    if (rect.top >= 12 && rect.bottom <= height - 12 && rect.left >= 8 && rect.right <= width - 8) { return; }
    try { node.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'auto'}); }
    catch (ignoreScrollOptions) { try { node.scrollIntoView(false); } catch (ignoreScroll) {} }
  }

  function focus(node) {
    if (!focusable(node)) { return false; }
    editing = null;
    try { node.focus(); } catch (ignoreFocus) { return false; }
    ring(node);
    scrollToControl(node);
    return true;
  }

  function initial(items) {
    var i, parent;
    for (i = 0; i < items.length; i++) {
      parent = items[i].element;
      while (parent && parent !== doc) {
        if (parent.id && parent.id.indexOf('page-') === 0) { return items[i]; }
        parent = parent.parentNode;
      }
    }
    return items.length ? items[0] : null;
  }

  function move(direction) {
    var items = candidates(), active = doc.activeElement, from = null, i, next;
    for (i = 0; i < items.length; i++) { if (items[i].element === active) { from = items[i]; break; } }
    if (!from) { next = initial(items); return next ? focus(next.element) : false; }
    next = chooseTarget(from.rect, items, direction);
    return next ? focus(next.element) : false;
  }

  function editable(node, allInputs) {
    var parent = node, tag, type;
    while (parent && parent.nodeType === 1) {
      if (parent.isContentEditable || parent.getAttribute('contenteditable') === 'true' || parent.getAttribute('contenteditable') === '') { return true; }
      tag = String(parent.tagName).toLowerCase();
      if (tag === 'textarea' || tag === 'select') { return true; }
      if (tag === 'input') {
        type = String(parent.type || 'text').toLowerCase();
        if (allInputs || !/^(button|submit|reset|checkbox|radio|file|color)$/.test(type)) { return true; }
      }
      parent = parent.parentNode;
    }
    return false;
  }

  function back(fromKeyboard) {
    var fallback = element('export-fallback'), boot = element('boot-overlay'), skip;
    /* L'application possède la fermeture et le focus de son dialogue export. */
    if (visible(fallback)) { return false; }
    if (visible(boot)) {
      skip = element('skip-boot');
      if (skip && !skip.disabled && typeof skip.click === 'function') { skip.click(); return true; }
      return false;
    }
    editing = null;
    removeRing();
    if (app() && typeof app().page === 'function') { app().page('overview'); return true; }
    return false;
  }

  function activate() {
    var items = candidates(), active = doc.activeElement, candidate = null, i;
    for (i = 0; i < items.length; i++) { if (items[i].element === active) { candidate = items[i]; break; } }
    if (!candidate) {
      candidate = initial(items);
      if (candidate) { focus(candidate.element); }
      return;
    }
    if (editable(active, false)) { editing = active; }
    if (typeof active.click === 'function') { active.click(); }
  }

  function keydown(event) {
    if (!allowed() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) { return; }
    var key = event.key || '', code = event.keyCode || event.which, direction = '';
    if (key === 'Escape' || key === 'Esc' || code === 27) {
      if (back(true)) { event.preventDefault(); }
      return;
    }
    if (key === 'ArrowLeft' || key === 'Left' || code === 37) { direction = 'left'; }
    if (key === 'ArrowUp' || key === 'Up' || code === 38) { direction = 'up'; }
    if (key === 'ArrowRight' || key === 'Right' || code === 39) { direction = 'right'; }
    if (key === 'ArrowDown' || key === 'Down' || code === 40) { direction = 'down'; }
    if (!direction) { return; } /* Entrée conserve son comportement natif. */
    if (editable(event.target, true)) { editing = event.target; return; }
    if (move(direction)) { event.preventDefault(); }
  }

  function focusin(event) {
    if (allowed() && focusable(event.target)) { ring(event.target); }
    else { removeRing(); }
    if (editing && editing !== event.target) { editing = null; }
  }

  function pointerEdit(event) {
    if (allowed() && editable(event.target, false)) { editing = event.target; }
    else { editing = null; }
  }

  function resetPad() {
    padKey = ''; needsNeutral = true;
    directionState.name = ''; directionState.next = 0;
    actionState.accept = false; actionState.back = false;
  }

  function stopPolling() {
    if (timer !== null) { win.clearTimeout(timer); timer = null; }
    resetPad();
  }

  function schedule() {
    if (timer === null && !inPoll && allowed() && getPadMethod() && !apiFailed) { timer = win.setTimeout(poll, POLL_INTERVAL); }
  }

  function pressed(pad, index) {
    var button = pad.buttons && pad.buttons[index];
    return typeof button === 'number' ? button > 0.5 : !!(button && (button.pressed || button.value > 0.5));
  }

  function padDirection(pad) {
    if (pressed(pad, 12)) { return 'up'; }
    if (pressed(pad, 13)) { return 'down'; }
    if (pressed(pad, 14)) { return 'left'; }
    if (pressed(pad, 15)) { return 'right'; }
    var x = pad.axes && finite(pad.axes[0]) ? pad.axes[0] : 0;
    var y = pad.axes && finite(pad.axes[1]) ? pad.axes[1] : 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < 0.65) { return ''; }
    return Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
  }

  function rising(name, down) {
    var result = down && !actionState[name];
    actionState[name] = down;
    return result;
  }

  function directionDue(direction, now) {
    if (!direction) { directionState.name = ''; directionState.next = 0; return false; }
    if (direction !== directionState.name) { directionState.name = direction; directionState.next = now + REPEAT_DELAY; return true; }
    if (now >= directionState.next) { directionState.next = now + REPEAT_INTERVAL; return true; }
    return false;
  }

  function poll() {
    timer = null;
    if (!allowed()) { return; }
    var method = getPadMethod(), pads, pad = null, i, key, direction, accept, goBack, now, moveDue;
    if (!method) { return; }
    inPoll = true;
    try {
      try { pads = method.call(win.navigator); }
      catch (unavailable) {
        apiFailed = true;
        setStatus('Navigation clavier disponible. La détection de manette est inaccessible dans ce navigateur.');
        return;
      }
      for (i = 0; pads && i < pads.length; i++) { if (pads[i] && pads[i].connected !== false) { pad = pads[i]; break; } }
      if (!pad) {
        resetPad();
        setStatus('Navigation clavier disponible. Aucune manette détectée ; appuie sur une touche pour la rendre visible au navigateur.');
        return;
      }
      key = String(pad.index) + ':' + String(pad.id || 'gamepad');
      if (key !== padKey) { resetPad(); padKey = key; }
      setStatus('Manette détectée. Croix directionnelle ou stick : se déplacer ; bouton principal : valider ; bouton retour : accueil. Compatibilité PS4 réelle non vérifiée.');
      direction = padDirection(pad); accept = pressed(pad, 0); goBack = pressed(pad, 1);
      /* Une connexion, ou un bouton déjà tenu lors de la connexion, ne doit
       * jamais déclencher un lien ni un contrôle. Attendre une position neutre. */
      if (needsNeutral) {
        if (!direction && !accept && !goBack) { needsNeutral = false; }
        return;
      }
      now = new Date().getTime();
      accept = rising('accept', accept); goBack = rising('back', goBack);
      moveDue = directionDue(direction, now);
      if (goBack) { back(false); }
      else if (accept) { activate(); }
      else if (moveDue && !(editing && editing === doc.activeElement)) { move(direction); }
    } finally {
      inPoll = false;
      schedule();
    }
  }

  function refreshConfiguration() {
    var state;
    try { state = app() && typeof app().getState === 'function' ? app().getState() : null; }
    catch (ignoreState) { state = null; }
    enabled = !!(state && state.settings && state.settings.controller !== false);
    if (!enabled || manualStop) {
      stopPolling(); removeRing(); editing = null;
      setStatus('Commandes directionnelles désactivées. La souris, le tactile et la navigation clavier native restent disponibles.');
      return;
    }
    if (isHiddenDocument() || pageSuspended) {
      stopPolling();
      setStatus('Navigation suspendue tant que cet onglet est masqué.');
      return;
    }
    if (highlighted && !focusable(highlighted)) { removeRing(); }
    if (!getPadMethod()) {
      stopPolling();
      setStatus('Flèches et Entrée disponibles. L’API de manette n’est pas proposée par ce navigateur.');
      return;
    }
    if (!apiFailed) { schedule(); }
  }

  api.refresh = function () { manualStop = false; apiFailed = false; refreshConfiguration(); };
  api.stop = function () { manualStop = true; refreshConfiguration(); };

  doc.addEventListener('keydown', keydown, false);
  doc.addEventListener('focusin', focusin, false);
  doc.addEventListener('mousedown', pointerEdit, false);
  doc.addEventListener('touchstart', pointerEdit, false);
  doc.addEventListener('visibilitychange', function () { apiFailed = false; refreshConfiguration(); }, false);
  win.addEventListener('gamepadconnected', function () { apiFailed = false; refreshConfiguration(); }, false);
  win.addEventListener('gamepaddisconnected', function () { resetPad(); refreshConfiguration(); }, false);
  win.addEventListener('pagehide', function () { pageSuspended = true; stopPolling(); }, false);
  win.addEventListener('pageshow', function () { pageSuspended = false; apiFailed = false; refreshConfiguration(); }, false);
  if (app() && typeof app().onChange === 'function') { app().onChange(refreshConfiguration); }
  refreshConfiguration();
  return api;
}));
