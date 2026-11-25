/* NEXUSHEN browser journal. Observations and user reports are kept separate. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.NexusJournal = api; }
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';
  var KEY = 'nexushen.logs.v1';
  /* Serialized JSON characters (UTF-16 length), not a byte-size promise. */
  var MAX_ATTEMPTS = 12, MAX_EVENTS = 80, MAX_SERIALIZED_CHARS = 96 * 1024;
  var browserOutcomes = ['browser_error', 'module_load_error', 'page_left', 'loader_returned', 'gate_rejected', 'navigation_failed'];
  var reportedOutcomes = ['goldhen_confirmed', 'power_off_reported', 'freeze_reported', 'error_reported', 'unknown'];
  var metaKeys = ['module', 'version', 'release', 'firmware', 'userAgent', 'source', 'entry'];

  function text(value, limit) {
    var valueText;
    if (value === null || typeof value === 'undefined') { return ''; }
    try { valueText = String(value); } catch (ignore) { return ''; }
    return valueText.length > limit ? valueText.slice(0, limit - 1) + '\u2026' : valueText;
  }
  function member(list, value) { return list.indexOf(value) !== -1; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
  function cleanMeta(meta) {
    var result = {}, i, key;
    meta = meta && typeof meta === 'object' ? meta : {};
    for (i = 0; i < metaKeys.length; i += 1) {
      key = metaKeys[i];
      if (typeof meta[key] === 'string' || typeof meta[key] === 'number') { result[key] = text(meta[key], key === 'userAgent' ? 320 : 100); }
    }
    return result;
  }
  function cleanEvent(event) {
    if (!event || typeof event !== 'object') { return null; }
    return {at: text(event.at, 32), type: text(event.type, 40), message: text(event.message, 400), detail: text(event.detail, 1400)};
  }
  function cleanAttempt(attempt) {
    var result, events, event, i;
    if (!attempt || typeof attempt !== 'object' || !validId(attempt.id)) { return null; }
    result = {id: attempt.id, startedAt: text(attempt.startedAt, 32), meta: cleanMeta(attempt.meta), status: member(browserOutcomes, attempt.status) ? attempt.status : 'pending', endedAt: text(attempt.endedAt, 32), events: [], droppedEvents: 0, report: null};
    events = Array.isArray(attempt.events) ? attempt.events : [];
    for (i = Math.max(0, events.length - MAX_EVENTS); i < events.length; i += 1) {
      event = cleanEvent(events[i]);
      if (event) { result.events.push(event); }
    }
    result.droppedEvents = typeof attempt.droppedEvents === 'number' && isFinite(attempt.droppedEvents) ? Math.max(0, Math.min(1000000, Math.floor(attempt.droppedEvents))) : 0;
    if (events.length > MAX_EVENTS) { result.droppedEvents += events.length - MAX_EVENTS; }
    if (attempt.report && member(reportedOutcomes, attempt.report.outcome)) {
      result.report = {at: text(attempt.report.at, 32), outcome: attempt.report.outcome, note: text(attempt.report.note, 1200)};
    }
    return result;
  }
  function create(options) {
    var opts = options || {}, storage = null, attempts = [], sequence = 0, lastRaw = null, hasRaw = false;
    var persistent = false, malformed = false, dirty = false, storageMessage = '', clock = typeof opts.now === 'function' ? opts.now : function () { return new Date().getTime(); };
    var suffix = Math.random().toString(36).slice(2, 8) || 'local';
    try { storage = Object.prototype.hasOwnProperty.call(opts, 'storage') ? opts.storage : root.localStorage; }
    catch (ignore) { storage = null; }
    function now() {
      var result;
      try { result = Number(clock()); } catch (ignore) { result = NaN; }
      if (!isFinite(result) || Math.abs(result) > 8640000000000000) { result = new Date().getTime(); }
      return new Date(result).toISOString();
    }
    function serializeBounded() {
      var raw = JSON.stringify({version: 1, attempts: attempts}), estimated = raw.length, i, attempt, removed, oldDigits;
      if (estimated <= MAX_SERIALIZED_CHARS) { return raw; }
      /* Prefer retaining every attempt's last event. Prune oldest attempts' earlier events first. */
      for (i = attempts.length - 1; i >= 0 && estimated > MAX_SERIALIZED_CHARS; i -= 1) {
        attempt = attempts[i];
        while (attempt.events.length > 1 && estimated > MAX_SERIALIZED_CHARS) {
          removed = attempt.events.shift();
          oldDigits = String(attempt.droppedEvents).length;
          attempt.droppedEvents += 1;
          estimated -= JSON.stringify(removed).length + 1;
          estimated += String(attempt.droppedEvents).length - oldDigits;
        }
      }
      raw = JSON.stringify({version: 1, attempts: attempts});
      /* Bounded metadata ordinarily fits alone; retain the newest attempt in any future schema. */
      while (raw.length > MAX_SERIALIZED_CHARS && attempts.length > 1) {
        attempts.pop();
        raw = JSON.stringify({version: 1, attempts: attempts});
      }
      return raw;
    }
    function load() {
      var raw, data, cleaned = [], seen = {}, attempt, i;
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
        persistent = false;
        storageMessage = 'Stockage local indisponible : le journal de cette page reste seulement en mémoire.';
        return false;
      }
      try {
        raw = storage.getItem(KEY);
        if (hasRaw && raw === lastRaw) { persistent = true; storageMessage = ''; return true; }
        if (raw === null || raw === '') { attempts = []; lastRaw = raw; hasRaw = true; persistent = true; storageMessage = ''; return true; }
        data = JSON.parse(raw);
        if (!data || data.version !== 1 || !Array.isArray(data.attempts)) { throw new Error('format'); }
        for (i = 0; i < data.attempts.length && cleaned.length < MAX_ATTEMPTS; i += 1) {
          attempt = cleanAttempt(data.attempts[i]);
          if (attempt && !seen[attempt.id]) { seen[attempt.id] = true; cleaned.push(attempt); }
        }
        attempts = cleaned;
        serializeBounded();
        lastRaw = raw;
        hasRaw = true;
        persistent = true;
        storageMessage = '';
        return true;
      } catch (error) {
        persistent = false;
        malformed = error && (error.name === 'SyntaxError' || error.message === 'format');
        storageMessage = malformed ? 'Ancien journal illisible. Les nouveaux événements seront enregistrés séparément des réglages NEXUSHEN.' : 'Lecture du journal impossible : les événements restent en mémoire pour cette page.';
        return false;
      }
    }
    function sync() {
      /* A BFCache page may hold an older copy than the runner. Never replace unsaved memory. */
      if (!dirty) { load(); }
    }
    function save() {
      var raw = serializeBounded();
      if (!storage || typeof storage.setItem !== 'function') { dirty = true; return false; }
      try {
        storage.setItem(KEY, raw);
        lastRaw = raw;
        hasRaw = true;
        persistent = true; dirty = false; storageMessage = ''; return true;
      } catch (ignore) {
        persistent = false; dirty = true;
        storageMessage = 'Enregistrement local impossible : copie ou exporte le rapport avant de quitter cette page.';
        return false;
      }
    }
    function find(id) {
      var i;
      if (!validId(id)) { return null; }
      for (i = 0; i < attempts.length; i += 1) { if (attempts[i].id === id) { return attempts[i]; } }
      return null;
    }
    function record(id, type, message, detail) {
      var attempt;
      sync();
      attempt = find(id);
      if (!attempt) { return false; }
      attempt.events.push({at: now(), type: text(type, 40), message: text(message, 400), detail: text(detail, 1400)});
      if (attempt.events.length > MAX_EVENTS) { attempt.events.shift(); attempt.droppedEvents += 1; }
      save();
      return true;
    }
    load();
    return {
      key: KEY,
      start: function (meta) {
        var stamp = now(), id;
        sync();
        sequence += 1;
        id = 'attempt-' + stamp.replace(/[^0-9]/g, '') + '-' + suffix + '-' + sequence;
        attempts.unshift({id: id, startedAt: stamp, meta: cleanMeta(meta), status: 'pending', endedAt: '', events: [], droppedEvents: 0, report: null});
        if (attempts.length > MAX_ATTEMPTS) { attempts.length = MAX_ATTEMPTS; }
        save();
        return id;
      },
      record: record,
      finish: function (id, outcome) {
        var attempt;
        sync();
        attempt = find(id);
        if (!attempt || !member(browserOutcomes, outcome)) { return false; }
        if (outcome === 'page_left' && member(['browser_error', 'module_load_error', 'gate_rejected', 'navigation_failed'], attempt.status)) { return false; }
        attempt.status = outcome;
        attempt.endedAt = now();
        save();
        return true;
      },
      report: function (id, outcome, note) {
        var attempt;
        if (!member(reportedOutcomes, outcome)) { return false; }
        sync();
        attempt = find(id);
        if (!attempt) { return false; }
        attempt.report = {at: now(), outcome: outcome, note: text(note, 1200)};
        save();
        return true;
      },
      list: function () { return copy(attempts); },
      get: function (id) { var attempt = find(id); return attempt ? copy(attempt) : null; },
      refresh: function () { sync(); return copy(attempts); },
      exportData: function (id) {
        var attempt = id ? find(id) : null;
        return {format: 'nexushen-browser-journal', version: 1, exportedAt: now(), scope: 'browser-observations-and-user-reports', limitation: 'Ce journal ne contient pas de trace noyau. Une fin non confirmée ne prouve pas un kernel panic. Les observations ne déterminent pas la cause du crash.', persistentStorage: persistent, attempts: copy(id ? (attempt ? [attempt] : []) : attempts)};
      },
      status: function () { return {persistent: persistent, malformed: malformed, message: storageMessage, count: attempts.length, maxSerializedChars: MAX_SERIALIZED_CHARS}; }
    };
  }
  var api = create();
  api.create = create;
  api.outcomes = browserOutcomes.slice();
  api.reportedOutcomes = reportedOutcomes.slice();
  return api;
}));
