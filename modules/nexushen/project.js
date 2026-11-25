/* NEXUSHEN development dossier: local metadata only; no payload execution. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('../goldhen/integrity.js')); }
  else { root.NexusProject = factory(root.NexusCore); }
}(typeof window !== 'undefined' ? window : this, function (core) {
  'use strict';
  var FORMAT = 'nexushen-development-project', KEY = 'nexushen.project.v1.primary', PREVIOUS = 'nexushen.project.v1.previous';
  var MAX_FILE = 33554432, MAX_FILES = 32, MAX_IMPORT = 262144;
  function fail(message) { throw new Error(message); }
  function object(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, max, label) { if (typeof v !== 'string' || v.length > max) { fail(label + ' invalide.'); } return v; }
  function blank() { return {name:'NEXUSHEN', version:'0.1-dev', declaredFirmware:'14.02', nativePayload:'not-built', origin:'', notes:'', files:[]}; }
  function clean(input) {
    if (!object(input) || input.name !== 'NEXUSHEN' || input.version !== '0.1-dev' || input.declaredFirmware !== '14.02' || input.nativePayload !== 'not-built') { fail('Identité du projet non reconnue.'); }
    var state = blank(), i, f, size;
    state.origin = str(input.origin, 1000, 'Origine des fichiers');
    state.notes = str(input.notes, 6000, 'Notes');
    if (!Array.isArray(input.files) || input.files.length > MAX_FILES) { fail('Inventaire trop volumineux ou invalide.'); }
    for (i = 0; i < input.files.length; i += 1) {
      f = input.files[i]; if (!object(f)) { fail('Fiche fichier invalide.'); }
      size = f.size;
      if (typeof size !== 'number' || !isFinite(size) || size < 0 || size > MAX_FILE || Math.floor(size) !== size) { fail('Taille de fichier invalide.'); }
      if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) { fail('Empreinte de fichier invalide.'); }
      if (typeof f.addedAt !== 'string' || f.addedAt.length > 40 || !isFinite(new Date(f.addedAt).getTime())) { fail('Date de fichier invalide.'); }
      state.files.push({name:str(f.name, 255, 'Nom de fichier'), size:size, sha256:f.sha256, addedAt:f.addedAt});
    }
    return state;
  }
  function canonical(value) {
    if (value === null || typeof value !== 'object') { return JSON.stringify(value); }
    var list = [], keys, i;
    if (Array.isArray(value)) { for (i = 0; i < value.length; i += 1) { list.push(canonical(value[i])); } return '[' + list.join(',') + ']'; }
    keys = Object.keys(value).sort();
    for (i = 0; i < keys.length; i += 1) { if (own(value, keys[i])) { list.push(JSON.stringify(keys[i]) + ':' + canonical(value[keys[i]])); } }
    return '{' + list.join(',') + '}';
  }
  function encode(state, date) {
    if (!core || typeof core.sha256 !== 'function') { fail('Calcul SHA-256 indisponible.'); }
    var body = {format:FORMAT, version:1, createdAt:date || new Date().toISOString(), state:clean(state)};
    body.checksum = core.sha256(canonical(body));
    return JSON.stringify(body, null, 2);
  }
  function decode(text) {
    if (typeof text !== 'string' || text.length > MAX_IMPORT) { fail('Fichier projet trop volumineux (256 Kio maximum).'); }
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { fail('Fichier JSON invalide.'); }
    if (!object(parsed) || parsed.format !== FORMAT || parsed.version !== 1) { fail('Ce fichier n’est pas une sauvegarde de préparation NEXUSHEN v1.'); }
    if (typeof parsed.createdAt !== 'string' || parsed.createdAt.length > 40 || !isFinite(new Date(parsed.createdAt).getTime())) { fail('Date de sauvegarde invalide.'); }
    var state = clean(parsed.state);
    var body = {format:parsed.format, version:parsed.version, createdAt:parsed.createdAt, state:state};
    if (typeof parsed.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.checksum) || core.sha256(canonical(body)) !== parsed.checksum) { fail('Empreinte différente : sauvegarde modifiée ou endommagée.'); }
    return {state:state, createdAt:parsed.createdAt};
  }
  function load(storage) {
    var candidates = [], keys = [KEY, PREVIOUS], i, text, bad = false;
    for (i = 0; i < keys.length; i += 1) {
      try { text = storage && storage.getItem(keys[i]); if (text) { candidates.push(decode(text)); } }
      catch (ignore) { bad = true; }
    }
    candidates.sort(function (a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
    return {state:candidates.length ? candidates[0].state : blank(), restored:candidates.length > 0, warning:bad};
  }
  function save(storage, state) {
    var text = encode(state), previous;
    try {
      if (!storage) { return {saved:false, text:text}; }
      previous = storage.getItem(KEY);
      if (previous) {
        try { decode(previous); storage.setItem(PREVIOUS, previous); } catch (ignorePrevious) {}
      }
      storage.setItem(KEY, text);
      return {saved:true, text:text};
    } catch (ignore) { return {saved:false, text:text}; }
  }
  return {format:FORMAT, key:KEY, previousKey:PREVIOUS, limits:{fileBytes:MAX_FILE, files:MAX_FILES, importBytes:MAX_IMPORT}, blank:blank, clean:clean, encode:encode, decode:decode, load:load, save:save};
}));
