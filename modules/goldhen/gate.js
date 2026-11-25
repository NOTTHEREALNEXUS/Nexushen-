/* NEXUSHEN local entry gate. Does not contain an exploit or load a payload. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.NexusGoldhenGate = api; }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var QUERY = '?afterglow=run&mode=goldhen&payload=goldhen_2.4b18.14.bin&log=1&nexus=0.4.3';
  var ARM_KEY = 'nexushen.goldhen.local.intent.v1';
  function firmware(ua) {
    var m = String(ua || '').match(/PlayStation 4[ /]([\d.]+)/i);
    return m ? m[1] : '';
  }
  function check(c) {
    if (c.protocol !== 'http:' && c.protocol !== 'https:') { return 'Ouvre cette page depuis le site NEXUSHEN en HTTP ou HTTPS.'; }
    if (firmware(c.userAgent) !== '14.02') { return 'Le lancement de ce module est réservé au navigateur de la PS4 en 14.02.'; }
    if (!c.topLevel) { return 'Ouvre la page GoldHEN directement dans le navigateur.'; }
    if (c.search !== QUERY) { return 'Adresse de lancement différente de celle du module. Reviens à la page GoldHEN.'; }
    var a = c.intent, age = a && c.now - a.createdAt;
    if (!a || a.version !== 1 || a.firmware !== '14.02' || typeof a.createdAt !== 'number' || !isFinite(age) || age < 0 || age > 120000) {
      return 'Le lancement n’est pas armé, ou a expiré. Reviens à la page GoldHEN et utilise son bouton.';
    }
    try {
      var ref = new URL(c.referrer), here = new URL(c.href);
      var folder = here.pathname.replace(/[^/]*$/, '');
      if (ref.origin !== here.origin || (ref.pathname !== folder + 'index.html' && ref.pathname !== folder)) {
        return 'Le lancement doit venir de la page GoldHEN de ce site.';
      }
    } catch (e) { return 'Le navigateur n’a pas transmis la page de départ. Reviens à la page GoldHEN.'; }
    return '';
  }
  return {query: QUERY, armKey: ARM_KEY, firmware: firmware, check: check};
}));
