/*
 * NEXUSHEN Origins 0.3 — portable, read-only analysis engine.
 * No dependencies, network, filesystem writes, eval, payload execution or
 * WebCrypto requirement. ES5 syntax; Uint8Array is used only for binary input.
 *
 * API:
 * sha256(string UTF-8 | Uint8Array | ArrayBuffer) -> lowercase hexadecimal.
 * analyzeIni(text) -> sections, entries, paths, issues, summary.
 *   sections: {name,line,kind}; entries include kind: setting | plugin.
 *   paths.path is a lexical normalized path, not a filesystem resolution.
 * compareConfigs(leftText,rightText) -> sharedPaths, differences, issues.
 *   differences.left/right are strings (joined values) or null when absent.
 * createBackup(state) -> JSON {format,version,createdAt,state,checksum}.
 *   checksum hashes canonical JSON of the first four fields, encoded UTF-8.
 * restoreBackup(text) -> validated state; throws Error on any invalid input.
 *   Restores v2 after verifying its original checksum, then adds v3 defaults.
 * inspectPayload(bytes, filename, references) -> bounded static metadata only.
 * validateEntryUrl(url) -> validated string or Error, never navigates.
 *
 * A matching digest establishes byte integrity, never provenance, trust,
 * firmware compatibility or authentication.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NexusCore = api;
  }
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var FORMAT = "nexushen-guardian-backup";
  var VERSION = 3;
  var MAX_BACKUP = 4 * 1024 * 1024;
  var MAX_CONFIG = 256 * 1024;
  var MAX_CONFIG_TOTAL = 2 * 1024 * 1024;
  var MAX_INI_LINES = 20000;
  var MAX_PAYLOAD = 32 * 1024 * 1024;
  var MAX_PAYLOAD_SCAN = 4 * 1024 * 1024;
  var HAS = Object.prototype.hasOwnProperty;
  var TO_STRING = Object.prototype.toString;

  function own(obj, key) { return HAS.call(obj, key); }
  function trim(s) { return s.replace(/^\s+|\s+$/g, ""); }
  function dict() { return Object.create(null); }
  function isArray(x) { return TO_STRING.call(x) === "[object Array]"; }
  function isObject(x) {
    return x !== null && typeof x === "object" && !isArray(x) &&
      TO_STRING.call(x) === "[object Object]";
  }

  function utf8(s) {
    var a = [], i, c, next;
    for (i = 0; i < s.length; i += 1) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (next >= 0xDC00 && next <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + next - 0xDC00;
          i += 1;
        } else {
          c = 0xFFFD;
        }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        c = 0xFFFD;
      }
      if (c < 0x80) {
        a.push(c);
      } else if (c < 0x800) {
        a.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c < 0x10000) {
        a.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        a.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63),
          0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return a;
  }

  function bytesOf(input) {
    if (typeof input === "string") { return utf8(input); }
    if (TO_STRING.call(input) === "[object ArrayBuffer]") {
      return new Uint8Array(input);
    }
    if (TO_STRING.call(input) === "[object Uint8Array]") { return input; }
    throw new Error("SHA-256 attend du texte ou des octets Uint8Array.");
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(input) {
    var bytes = bytesOf(input), len = bytes.length;
    var k = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var total = Math.ceil((len + 9) / 64) * 64;
    var high = Math.floor(len / 0x20000000), low = (len * 8) >>> 0;
    var w = new Array(64), i, j, offset, pos, v, s0, s1, a,b,c,d,e,f,g,hh,t1,t2;
    function readByte(at) {
      if (at < len) { return bytes[at]; }
      if (at === len) { return 0x80; }
      if (at >= total - 8 && at < total - 4) {
        return (high >>> ((total - 5 - at) * 8)) & 255;
      }
      if (at >= total - 4) {
        return (low >>> ((total - 1 - at) * 8)) & 255;
      }
      return 0;
    }
    for (offset = 0; offset < total; offset += 64) {
      for (i = 0; i < 16; i += 1) {
        v = 0;
        for (j = 0; j < 4; j += 1) {
          pos = offset + i * 4 + j;
          v = (v << 8) | readByte(pos);
        }
        w[i] = v;
      }
      for (i = 16; i < 64; i += 1) {
        s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      a=h[0]; b=h[1]; c=h[2]; d=h[3]; e=h[4]; f=h[5]; g=h[6]; hh=h[7];
      for (i = 0; i < 64; i += 1) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        t1 = (hh + s1 + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      h[0]=(h[0]+a)|0; h[1]=(h[1]+b)|0; h[2]=(h[2]+c)|0; h[3]=(h[3]+d)|0;
      h[4]=(h[4]+e)|0; h[5]=(h[5]+f)|0; h[6]=(h[6]+g)|0; h[7]=(h[7]+hh)|0;
    }
    var out = "", word;
    for (i = 0; i < h.length; i += 1) {
      word = (h[i] >>> 0).toString(16);
      out += ("00000000" + word).slice(-8);
    }
    return out;
  }

  function decodeUrlForCheck(value) {
    var result = value, next, i;
    for (i = 0; i < 8; i += 1) {
      if (/[\u0000-\u001f\u007f\\]/.test(result)) {
        throw new Error("L'adresse contient un contrôle ou antislash encodé.");
      }
      try {
        // Preserve literal percent signs produced by an earlier decode while
        // still checking any other encoded controls or traversal in the path.
        next = decodeURIComponent(i > 0 ? result.replace(/%(?![0-9a-f]{2})/gi, "%25") : result);
      }
      catch (e) {
        throw new Error("Encodage de l'adresse invalide.");
      }
      if (next === result) { return result; }
      result = next;
    }
    if (/[\u0000-\u001f\u007f\\]/.test(result) || /%[0-9a-f]{2}/i.test(result)) {
      throw new Error("Adresse trop imbriquée ou encodage non autorisé.");
    }
    return result;
  }

  function validIpv6(host) {
    var value = host, colon, tail, nums, i, parts, groups = [];
    if (value.indexOf(".") !== -1) {
      colon = value.lastIndexOf(":"); tail = value.substring(colon + 1); nums = tail.split(".");
      if (colon < 0 || nums.length !== 4) { return false; }
      for (i = 0; i < nums.length; i += 1) {
        if (!/^\d{1,3}$/.test(nums[i]) || Number(nums[i]) > 255) { return false; }
      }
      value = value.substring(0, colon + 1) + "0000:0000";
    }
    if (value.indexOf("::") !== value.lastIndexOf("::")) { return false; }
    if (value.indexOf("::") !== -1) {
      parts = value.split("::");
      if (parts[0]) { groups = groups.concat(parts[0].split(":")); }
      if (parts[1]) { groups = groups.concat(parts[1].split(":")); }
      if (groups.length >= 8) { return false; }
    } else {
      groups = value.split(":");
      if (groups.length !== 8) { return false; }
    }
    for (i = 0; i < groups.length; i += 1) { if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) { return false; } }
    return true;
  }

  function validateEntryUrl(value) {
    if (typeof value !== "string" || value.length > 2048) {
      throw new Error("Adresse invalide : maximum 2 048 caractères.");
    }
    if (/[\u0000-\u001f\u007f\\]/.test(value)) {
      throw new Error("L'adresse contient un caractère de contrôle ou un antislash.");
    }
    var url = trim(value);
    if (!url) { return ""; }
    if (/\s/.test(url) || /%(?![0-9a-f]{2})/i.test(url)) {
      throw new Error("L'adresse contient un espace non encodé ou un encodage invalide.");
    }
    // Check nested encoding without resolving or fetching the address.
    var decoded = decodeUrlForCheck(url), i;
    if (/[\u0000-\u001f\u007f\\]/.test(decoded) || /^\/\//.test(decoded)) {
      throw new Error("Adresse encodée non autorisée.");
    }
    var absolute = /^https?:\/\//i.test(url), match, host, port = "", labels, path;
    if (absolute) {
      match = /^https?:\/\/([^\/?#]+)([^?#]*)(?:[?#].*)?$/i.exec(url);
      if (!match || /[@%]/.test(match[1])) {
        throw new Error("Hôte invalide ou identifiants intégrés à l'adresse.");
      }
      host = match[1];
      if (host.charAt(0) === "[") {
        match = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(host);
        if (!match || !validIpv6(match[1])) { throw new Error("Hôte IPv6 invalide."); }
        port = match[2] || "";
      } else {
        match = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(host);
        if (!match || match[1].length > 253) { throw new Error("Nom d'hôte invalide."); }
        host = match[1].replace(/\.$/, "");
        labels = host.split(".");
        for (i = 0; i < labels.length; i += 1) {
          if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(labels[i])) {
            throw new Error("Nom d'hôte invalide.");
          }
        }
        port = match[2] || "";
      }
      if (port && (Number(port) < 1 || Number(port) > 65535)) {
        throw new Error("Port d'adresse hors de la plage 1–65535.");
      }
      path = url.replace(/^https?:\/\/[^\/?#]+/i, "").split(/[?#]/)[0];
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || /^[?#]/.test(url)) {
        throw new Error("Utilise un chemin relatif ou une adresse HTTP/HTTPS.");
      }
      path = url.split(/[?#]/)[0];
      if (decodeUrlForCheck(path).indexOf(":") !== -1 || !path) {
        throw new Error("Chemin relatif invalide.");
      }
    }
    path = decodeUrlForCheck(path);
    if (/(^|\/)\.\.(\/|$)/.test(path)) {
      throw new Error("Les chemins remontant avec « .. » sont refusés.");
    }
    return url;
  }

  function inspectPayload(input, filename, references) {
    var bytes = bytesOf(input);
    if (typeof input === "string") { throw new Error("L'inspection attend les octets du fichier, pas du texte."); }
    if (bytes.length > MAX_PAYLOAD) { throw new Error("Fichier trop volumineux pour l'inspection : maximum 32 Mio."); }
    if (typeof filename !== "string" || !filename || filename.length > 500 ||
        /[\u0000-\u001f\u007f]/.test(filename)) {
      throw new Error("Nom de fichier invalide.");
    }
    var digest = sha256(bytes), lowerName = filename.toLowerCase();
    var extension = /\.prx$/i.test(filename) ? ".prx" : (/\.bin$/i.test(filename) ? ".bin" : "");
    var result = {name:filename, size:bytes.length, sha256:digest, format:"Format non reconnu",
      identityHints:[], referenceMatches:[], firmwareHints:[], warnings:[]};
    var identitySeen = dict(), fwSeen = dict(), i, j, c, elfClass, machine, machineName, dataOrder;
    var isElf = bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 &&
      bytes[2] === 0x4c && bytes[3] === 0x46;
    if (isElf) {
      elfClass = bytes.length > 4 ? bytes[4] : 0;
      dataOrder = bytes.length > 5 ? bytes[5] : 0;
      result.format = "ELF" + (elfClass === 1 ? " 32 bits" : (elfClass === 2 ? " 64 bits" : " (classe inconnue)"));
      if (bytes.length >= 20 && (dataOrder === 1 || dataOrder === 2)) {
        machine = dataOrder === 1 ? bytes[18] + (bytes[19] << 8) : (bytes[18] << 8) + bytes[19];
        machineName = machine === 62 ? "x86-64" : (machine === 3 ? "x86" : (machine === 183 ? "AArch64" : "machine " + machine));
        result.format += " · " + machineName;
      } else { result.warnings.push("En-tête ELF trop court ou ordre des octets non reconnu ; métadonnées incomplètes."); }
      if ((elfClass === 2 && bytes.length < 64) || (elfClass === 1 && bytes.length < 52)) {
        result.warnings.push("L'en-tête ELF est tronqué."); 
      }
      if (extension) { result.format += " · extension " + extension; }
    } else if (extension === ".bin") {
      result.format = "Binaire brut ou format non reconnu (.bin)";
    } else if (extension === ".prx") {
      result.format = "Extension .prx · format interne non reconnu";
    }
    if (extension === ".prx") {
      result.warnings.push("Le nom .prx désigne normalement un module : il ne suffit pas à identifier un payload d'activation.");
    }
    if (!bytes.length) { result.warnings.push("Le fichier est vide."); }
    result.warnings.push("Nom, format et chaînes internes ne prouvent ni provenance, ni innocuité, ni compatibilité avec un firmware.");

    function identity(value, origin) {
      var names = [
        {pattern:/goldhen/i, name:"GoldHEN"}, {pattern:/phantomhen/i, name:"PhantomHEN"},
        {pattern:/nexushen/i, name:"NEXUSHEN"}, {pattern:/ps4debug(?:[-_ ]?ng)?/i, name:"PS4Debug"},
        {pattern:/nova[-_ ]?hen/i, name:"NovaHEN"}
      ], k, id;
      for (k = 0; k < names.length; k += 1) {
        id = names[k].name + ":" + origin;
        if (names[k].pattern.test(value) && !own(identitySeen, id)) {
          identitySeen[id] = true;
          result.identityHints.push(names[k].name + " (" + origin + ")");
        }
      }
    }
    function addFirmware(major, minor) {
      var fw = Number(major) + "." + minor;
      if (Number(major) < 1 || Number(major) > 99 || !/^\d{2}$/.test(minor)) { return; }
      if (!own(fwSeen, fw) && result.firmwareHints.length < 24) {
        fwSeen[fw] = true; result.firmwareHints.push(fw);
      }
    }
    function inspectString(s) {
      if (s.length < 5) { return; }
      identity(s, "chaîne interne");
      var m, re = /\b(?:firmware|fw|sdk|ps4)[ _:=/-]*(\d{1,2})[._](\d{2})\b/gi;
      while ((m = re.exec(s)) !== null) { addFirmware(m[1], m[2]); }
      if (/firmware|offset|patch|vm_map|sdk/i.test(s)) {
        re = /_(\d{3,4})(?:\b|_)/g;
        while ((m = re.exec(s)) !== null) {
          addFirmware(m[1].slice(0, -2), m[1].slice(-2));
        }
      }
    }
    identity(lowerName, "nom du fichier");
    var nameRe = /(\d{1,2})[._](\d{2})/g, nameMatch;
    while ((nameMatch = nameRe.exec(filename)) !== null) { addFirmware(nameMatch[1], nameMatch[2]); }
    if (result.identityHints.length || result.firmwareHints.length) {
      result.warnings.push("Les indices tirés du nom sont déclaratifs : renommer un fichier ne change pas son contenu.");
    }
    var ranges = bytes.length <= MAX_PAYLOAD_SCAN ? [[0, bytes.length]] :
      [[0, MAX_PAYLOAD_SCAN / 2], [bytes.length - MAX_PAYLOAD_SCAN / 2, bytes.length]];
    var run;
    for (i = 0; i < ranges.length; i += 1) {
      run = "";
      for (j = ranges[i][0]; j < ranges[i][1]; j += 1) {
        c = bytes[j];
        if (c >= 32 && c <= 126) {
          run += String.fromCharCode(c);
          if (run.length >= 512) { inspectString(run); run = run.slice(-64); }
        } else {
          inspectString(run); run = "";
        }
      }
      inspectString(run);
    }
    if (bytes.length > MAX_PAYLOAD_SCAN) {
      result.warnings.push("Chaînes inspectées sur les 2 premiers et 2 derniers Mio seulement ; l'empreinte couvre tout le fichier.");
    }
    if (result.firmwareHints.length) {
      result.warnings.push("Les versions repérées sont des mentions de texte ou de symboles, sans validation matérielle.");
    }
    var refs = isArray(references) ? references : [], ref;
    for (i = 0; i < refs.length && i < 2000 && result.referenceMatches.length < 32; i += 1) {
      ref = refs[i];
      if (ref && typeof ref.sha256 === "string" && ref.sha256.toLowerCase() === digest) {
        result.referenceMatches.push({
          name:typeof ref.name === "string" ? ref.name.slice(0, 500) : "Référence sans nom",
          sha256:digest,
          origin:typeof ref.origin === "string" ? ref.origin.slice(0, 1000) :
            (typeof ref.path === "string" ? ref.path.slice(0, 1000) : "")
        });
      }
    }
    return result;
  }

  function withoutComment(text) {
    var quote = "", i, c, previous = "";
    for (i = 0; i < text.length; i += 1) {
      c = text.charAt(i);
      if (quote) {
        if (c === quote && previous !== "\\") { quote = ""; }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if ((c === ";" || c === "#") && (i === 0 || /\s/.test(previous))) {
        return trim(text.substring(0, i));
      }
      previous = c;
    }
    return trim(text);
  }

  function unquote(value) {
    var first = value.charAt(0);
    if (value.length >= 2 && (first === '"' || first === "'") &&
        value.charAt(value.length - 1) === first) {
      return value.substring(1, value.length - 1);
    }
    return value;
  }

  function normalizePath(path) {
    var p = unquote(trim(path)).replace(/\\/g, "/");
    var absolute = p.charAt(0) === "/", parts = p.split("/"), stack = [], i, part;
    for (i = 0; i < parts.length; i += 1) {
      part = parts[i];
      if (!part || part === ".") { continue; }
      if (part === "..") {
        if (stack.length && stack[stack.length - 1] !== "..") { stack.pop(); }
        else if (!absolute) { stack.push(part); }
      } else { stack.push(part); }
    }
    return (absolute ? "/" : "") + stack.join("/") || (absolute ? "/" : ".");
  }

  function pathOwner(path) {
    var owners = [
      {path:"/data/GoldHEN", name:"GoldHEN"},
      {path:"/data/hen", name:"PhantomHEN / NovaHEN"},
      {path:"/data/NEXUSHEN", name:"NEXUSHEN"}
    ], i;
    for (i = 0; i < owners.length; i += 1) {
      if (path === owners[i].path || path.indexOf(owners[i].path + "/") === 0) {
        return owners[i].name;
      }
    }
    return "Autre";
  }

  function issue(severity, code, message, line) {
    return {severity:severity, code:code, message:message, line:line || 0};
  }

  function analyzeIni(text) {
    if (typeof text !== "string") { throw new Error("La configuration doit être du texte."); }
    if (text.length > MAX_CONFIG || utf8(text).length > MAX_CONFIG) {
      throw new Error("Configuration trop volumineuse : maximum 256 Kio.");
    }
    var lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    if (lines.length > MAX_INI_LINES) { throw new Error("Configuration trop longue : maximum 20 000 lignes."); }
    var sections = [], entries = [], paths = [], issues = [];
    var section = "", sectionSeen = dict(), keys = dict(), ownerSeen = dict();
    var i, line, match, equals, key, value, entry, keyId, normalized, rawPath;
    var ownerNames = [], duplicates = 0, commentCount = 0, pluginCount = 0;

    function addPath(item) {
      rawPath = unquote(trim(item.value));
      normalized = normalizePath(rawPath);
      var owner = pathOwner(normalized);
      paths.push({section:item.section, key:item.key, value:item.value,
        path:normalized, line:item.line, owner:owner});
      if (owner !== "Autre") { ownerSeen[owner] = true; }
      if (rawPath.charAt(0) !== "/" && !/^[a-zA-Z]:[\\/]/.test(rawPath)) {
        issues.push(issue("warning", "relative_path",
          "Chemin relatif : son emplacement dépend du programme qui lit la configuration.", item.line));
      }
      if (/(^|[\\/])\.\.([\\/]|$)/.test(rawPath)) {
        issues.push(issue("warning", "path_traversal",
          "Le chemin contient « .. ». Vérifier le dossier réellement visé avant utilisation.", item.line));
      }
      if (rawPath.indexOf("\\") !== -1) {
        issues.push(issue("info", "path_separator",
          "Le chemin contient des antislashs ; vérifier le format attendu par le programme PS4.", item.line));
      }
    }

    for (i = 0; i < lines.length; i += 1) {
      if (lines[i].indexOf("\u0000") !== -1) {
        issues.push(issue("error", "nul_character", "Caractère NUL dans cette ligne ; contenu suspect ou fichier non textuel.", i + 1));
      }
      line = trim(lines[i]);
      if (!line) { continue; }
      if (line.charAt(0) === ";" || line.charAt(0) === "#") { commentCount += 1; continue; }
      line = withoutComment(line);
      if (!line) { continue; }
      match = /^\[([^\]]+)\]$/.exec(line);
      if (match) {
        section = trim(match[1]);
        if (!section) {
          issues.push(issue("error", "empty_section", "Nom de section vide.", i + 1));
          continue;
        }
        if (own(sectionSeen, section)) {
          issues.push(issue("info", "repeated_section", "Section répétée : vérifier le comportement du lecteur de configuration.", i + 1));
        }
        sectionSeen[section] = true;
        sections.push({name:section, line:i + 1, kind:/^CUSA\d{5}$/i.test(section) ? "titleid" : "general"});
        continue;
      }
      equals = line.indexOf("=");
      if (equals < 0 && /\.prx["']?$/i.test(line)) {
        entry = {section:section, key:"@plugin", value:unquote(line), line:i + 1, kind:"plugin"};
        entries.push(entry);
        pluginCount += 1;
        addPath(entry);
        continue;
      }
      if (equals < 0) {
        issues.push(issue("warning", "unparsed_line",
          "Ligne non reconnue comme section, clé=valeur ou chemin de plugin .prx.", i + 1));
        continue;
      }
      key = trim(line.substring(0, equals));
      value = unquote(trim(line.substring(equals + 1)));
      if (!key) {
        issues.push(issue("error", "empty_key", "Clé vide avant le signe =.", i + 1));
        continue;
      }
      entry = {section:section, key:key, value:value, line:i + 1, kind:"setting"};
      entries.push(entry);
      keyId = section.length + ":" + section + key;
      if (own(keys, keyId)) {
        duplicates += 1;
        issues.push(issue("warning", "duplicate_key",
          "Clé « " + key + " » répétée dans la même section ; le résultat dépend du lecteur de configuration.", i + 1));
      }
      keys[keyId] = true;
      if (/port$/i.test(key)) {
        if (!/^\d+$/.test(value)) {
          issues.push(issue("warning", "port_not_integer", "Le port n'est pas un entier positif explicite.", i + 1));
        } else if (Number(value) > 65535 || Number(value) < 1) {
          issues.push(issue("warning", "port_out_of_range", "Port hors de la plage usuelle 1–65535 ; vérifier le sens attendu par ce service.", i + 1));
        }
      }
      if (value && (/(^|_)(path|dir|directory)$/i.test(key) ||
          /^(\/|\.{1,2}[\\/]|[a-zA-Z]:[\\/])/.test(value) || /\.prx$/i.test(value))) {
        addPath(entry);
      }
    }
    for (key in ownerSeen) { if (own(ownerSeen, key)) { ownerNames.push(key); } }
    if (ownerNames.length > 1) {
      issues.push(issue("info", "mixed_roots",
        "Plusieurs dossiers de projets sont référencés. Cela justifie une vérification, mais ne démontre ni conflit ni corruption.", 0));
    }
    return {
      sections:sections, entries:entries, paths:paths, issues:issues,
      summary:{lineCount:lines.length, sectionCount:sections.length, entryCount:entries.length,
        pathCount:paths.length, duplicateCount:duplicates, pluginCount:pluginCount,
        commentCount:commentCount, owners:ownerNames}
    };
  }

  function compareConfigs(aText, bText) {
    var a = analyzeIni(aText), b = analyzeIni(bText);
    var left = dict(), right = dict(), union = dict(), leftPaths = dict(), rightPaths = dict();
    var differences = [], sharedPaths = [], issues = [], i, key, lv, rv, item;
    function groupEntries(source, destination) {
      var j, e, id;
      for (j = 0; j < source.length; j += 1) {
        e = source[j];
        id = JSON.stringify([e.section, e.key]);
        if (!own(destination, id)) {
          destination[id] = {section:e.section, key:e.key, values:[]};
        }
        destination[id].values.push(e.value);
        union[id] = true;
      }
    }
    function groupPaths(source, destination) {
      var j, e;
      for (j = 0; j < source.length; j += 1) {
        e = source[j];
        if (!own(destination, e.path)) { destination[e.path] = []; }
        destination[e.path].push({section:e.section, key:e.key, line:e.line, owner:e.owner});
      }
    }
    groupEntries(a.entries, left); groupEntries(b.entries, right);
    for (key in union) {
      if (!own(union, key)) { continue; }
      lv = own(left, key) ? left[key].values : null;
      rv = own(right, key) ? right[key].values : null;
      if (JSON.stringify(lv) !== JSON.stringify(rv)) {
        item = left[key] || right[key];
        differences.push({section:item.section, key:item.key,
          left:lv === null ? null : lv.join(" | "), right:rv === null ? null : rv.join(" | "),
          leftValues:lv, rightValues:rv, kind:lv === null ? "added" : (rv === null ? "removed" : "changed")});
      }
    }
    groupPaths(a.paths, leftPaths); groupPaths(b.paths, rightPaths);
    for (key in leftPaths) {
      if (own(leftPaths, key) && own(rightPaths, key)) {
        sharedPaths.push({path:key, left:leftPaths[key], right:rightPaths[key]});
      }
    }
    if (sharedPaths.length) {
      issues.push(issue("info", "shared_paths",
        "Des chemins identiques sont déclarés dans les deux configurations. Ils peuvent désigner des ressources partagées volontairement ; les accès réels ne sont pas observés.", 0));
    }
    function copyIssues(source, side) {
      var j, e;
      for (j = 0; j < source.length; j += 1) {
        e = source[j];
        issues.push({severity:e.severity, code:e.code, message:e.message, line:e.line, side:side});
      }
    }
    copyIssues(a.issues, "left"); copyIssues(b.issues, "right");
    return {sharedPaths:sharedPaths, differences:differences, issues:issues,
      summary:{leftEntries:a.entries.length, rightEntries:b.entries.length,
        differenceCount:differences.length, sharedPathCount:sharedPaths.length}};
  }

  function safeTree(value, depth) {
    var k;
    if (depth > 20) { throw new Error("Structure de sauvegarde trop profonde."); }
    if (value !== null && typeof value === "object") {
      for (k in value) {
        if (!own(value, k)) { continue; }
        if (k === "__proto__" || k === "constructor" || k === "prototype") {
          throw new Error("Clé interdite dans la sauvegarde : " + k);
        }
        safeTree(value[k], depth + 1);
      }
    }
  }

  function allowedKeys(obj, allowed, label) {
    var k;
    if (!isObject(obj)) { throw new Error(label + " doit être un objet."); }
    for (k in obj) {
      if (own(obj, k) && allowed.indexOf(k) === -1) {
        throw new Error("Champ non reconnu dans " + label + " : " + k);
      }
    }
  }

  function textField(obj, key, max, fallback, required) {
    var s = own(obj, key) ? obj[key] : fallback;
    if (typeof s !== "string" || s.length > max || (required && !trim(s)) || s.indexOf("\u0000") !== -1) {
      throw new Error("Champ texte invalide : " + key);
    }
    return s;
  }

  function listField(state, key, limit) {
    var value = own(state, key) ? state[key] : [];
    if (!isArray(value) || value.length > limit) {
      throw new Error("Liste invalide ou trop longue : " + key);
    }
    return value;
  }

  function boolField(obj, key, fallback) {
    var value = own(obj, key) ? obj[key] : fallback;
    if (typeof value !== "boolean") { throw new Error("Réglage booléen invalide : " + key); }
    return value;
  }

  function validateState(state, schemaVersion) {
    safeTree(state, 0);
    var legacy = schemaVersion === 2;
    allowedKeys(state, legacy ? ["settings","apps","notes","inventory","configs","tests"] :
      ["settings","apps","notes","inventory","configs","tests","payloads"], "state");
    var settings = own(state, "settings") ? state.settings : {};
    allowedKeys(settings, legacy ? ["accent","firmware","environment"] :
      ["accent","firmware","environment","tvMode","controller","motion","startup","background","goldhenHost"], "settings");
    var accent = textField(settings, "accent", 20, "blue", false);
    if (["blue","red","purple","green"].indexOf(accent) === -1 && !/^#[0-9a-f]{6}$/i.test(accent)) {
      throw new Error("Couleur de l'interface non reconnue.");
    }
    var background = textField(settings, "background", 20, "grid", false);
    if (["grid","plain","orbit"].indexOf(background) === -1) { throw new Error("Fond de l'interface non reconnu."); }
    var result = {
      settings:{
        accent:accent,
        firmware:textField(settings, "firmware", 32, "", false),
        environment:textField(settings, "environment", 80, "", false),
        tvMode:boolField(settings, "tvMode", false),
        controller:boolField(settings, "controller", true),
        motion:boolField(settings, "motion", true),
        startup:boolField(settings, "startup", false),
        background:background,
        goldhenHost:validateEntryUrl(textField(settings, "goldhenHost", 2048, "", false))
      },
      apps:[], notes:[], inventory:[], configs:[], tests:[], payloads:[]
    };
    var groups = ["apps","notes","inventory","configs","tests","payloads"];
    var limits = {apps:300, notes:500, inventory:1000, configs:20, tests:100, payloads:30};
    var fields = {
      apps:["id","name","note"], notes:["id","text","createdAt"],
      inventory:["id","name","size","sha256","source"],
      configs:["id","name","text"], tests:["id","label","status","note"],
      payloads:["id","name","kind","fileName","size","sha256","expectedSha256","firmware","entryUrl","note"]
    };
    var g, j, name, list, item, output, seen, id, size, digest, status, configTotal = 0;
    for (g = 0; g < groups.length; g += 1) {
      name = groups[g]; list = listField(state, name, limits[name]); seen = dict();
      for (j = 0; j < list.length; j += 1) {
        item = list[j];
        allowedKeys(item, fields[name], name + "[" + j + "]");
        id = textField(item, "id", 120, "", true);
        if (own(seen, id)) { throw new Error("Identifiant répété dans " + name + "."); }
        seen[id] = true;
        output = {id:id};
        if (name === "apps") {
          output.name = textField(item, "name", 200, "", true);
          output.note = textField(item, "note", 2000, "", false);
        } else if (name === "notes") {
          output.text = textField(item, "text", 8000, "", true);
          output.createdAt = textField(item, "createdAt", 64, "", false);
        } else if (name === "inventory") {
          output.name = textField(item, "name", 500, "", true);
          size = own(item, "size") ? item.size : 0;
          if (typeof size !== "number" || !isFinite(size) || size < 0 ||
              size > 9007199254740991 || Math.floor(size) !== size) {
            throw new Error("Taille de fichier invalide.");
          }
          output.size = size;
          digest = textField(item, "sha256", 64, "", false);
          if (digest && !/^[a-f0-9]{64}$/i.test(digest)) { throw new Error("Empreinte SHA-256 invalide."); }
          output.sha256 = digest.toLowerCase();
          output.source = textField(item, "source", 1000, "", false);
        } else if (name === "configs") {
          output.name = textField(item, "name", 500, "", true);
          output.text = textField(item, "text", MAX_CONFIG, "", false);
          size = utf8(output.text).length;
          configTotal += size;
          if (size > MAX_CONFIG || configTotal > MAX_CONFIG_TOTAL) {
            throw new Error("Configurations trop volumineuses : 256 Kio chacune, 2 Mio au total.");
          }
        } else if (name === "tests") {
          output.label = textField(item, "label", 300, "", true);
          status = textField(item, "status", 32, "untested", false);
          if (["untested","pass","fail","partial"].indexOf(status) === -1) {
            throw new Error("Statut de test non reconnu.");
          }
          output.status = status;
          output.note = textField(item, "note", 4000, "", false);
        } else if (name === "payloads") {
          output.name = textField(item, "name", 200, "", true);
          output.kind = textField(item, "kind", 20, "custom", false);
          if (["goldhen","nexushen","debug","custom"].indexOf(output.kind) === -1) {
            throw new Error("Catégorie de payload non reconnue.");
          }
          output.fileName = textField(item, "fileName", 500, "", false);
          size = own(item, "size") ? item.size : 0;
          if (typeof size !== "number" || !isFinite(size) || size < 0 ||
              size > 9007199254740991 || Math.floor(size) !== size) {
            throw new Error("Taille de fichier invalide.");
          }
          output.size = size;
          digest = textField(item, "sha256", 64, "", false);
          if (digest && !/^[a-f0-9]{64}$/i.test(digest)) { throw new Error("Empreinte SHA-256 invalide."); }
          output.sha256 = digest.toLowerCase();
          digest = textField(item, "expectedSha256", 64, "", false);
          if (digest && !/^[a-f0-9]{64}$/i.test(digest)) { throw new Error("Empreinte SHA-256 attendue invalide."); }
          output.expectedSha256 = digest.toLowerCase();
          output.firmware = textField(item, "firmware", 32, "", false);
          output.entryUrl = validateEntryUrl(textField(item, "entryUrl", 2048, "", false));
          output.note = textField(item, "note", 4000, "", false);
        }
        result[name].push(output);
      }
    }
    return result;
  }

  function canonical(value) {
    var type = typeof value, keys, parts, i;
    if (value === null || type === "string" || type === "boolean") { return JSON.stringify(value); }
    if (type === "number") {
      if (!isFinite(value)) { throw new Error("Nombre non fini dans la sauvegarde."); }
      return JSON.stringify(value);
    }
    if (isArray(value)) {
      parts = [];
      for (i = 0; i < value.length; i += 1) { parts.push(canonical(value[i])); }
      return "[" + parts.join(",") + "]";
    }
    if (isObject(value)) {
      keys = Object.keys(value).sort(); parts = [];
      for (i = 0; i < keys.length; i += 1) {
        parts.push(JSON.stringify(keys[i]) + ":" + canonical(value[keys[i]]));
      }
      return "{" + parts.join(",") + "}";
    }
    throw new Error("Valeur non prise en charge dans la sauvegarde.");
  }

  function checkBackupSize(text) {
    if (text.length > MAX_BACKUP || utf8(text).length > MAX_BACKUP) {
      throw new Error("Sauvegarde trop volumineuse : maximum 4 Mio.");
    }
  }

  function createBackup(state) {
    var clean = validateState(state, VERSION);
    var body = {format:FORMAT, version:VERSION, createdAt:new Date().toISOString(), state:clean};
    body.checksum = sha256(canonical(body));
    var out = JSON.stringify(body, null, 2);
    checkBackupSize(out);
    return out;
  }

  function restoreBackup(text) {
    if (typeof text !== "string") { throw new Error("La sauvegarde doit être un fichier JSON texte."); }
    checkBackupSize(text);
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error("Fichier JSON invalide."); }
    safeTree(parsed, 0);
    allowedKeys(parsed, ["format","version","createdAt","state","checksum"], "sauvegarde");
    if (parsed.format !== FORMAT || (parsed.version !== VERSION && parsed.version !== 2)) {
      throw new Error("Format ou version de sauvegarde non pris en charge.");
    }
    if (typeof parsed.createdAt !== "string" || parsed.createdAt.length > 64 ||
        !isFinite(new Date(parsed.createdAt).getTime())) {
      throw new Error("Date de sauvegarde invalide.");
    }
    if (typeof parsed.checksum !== "string" || !/^[a-f0-9]{64}$/.test(parsed.checksum)) {
      throw new Error("Empreinte de sauvegarde absente ou invalide.");
    }
    var body = {format:parsed.format, version:parsed.version, createdAt:parsed.createdAt, state:parsed.state};
    if (sha256(canonical(body)) !== parsed.checksum) {
      throw new Error("L'empreinte ne correspond pas : sauvegarde modifiée ou endommagée.");
    }
    // Keep the untouched version and state in the checksum check above.
    // Only after it succeeds may a v2 state receive v3 defaults.
    return validateState(parsed.state, parsed.version);
  }

  return {
    version:"0.3.0",
    limits:{backupBytes:MAX_BACKUP, configBytes:MAX_CONFIG, totalConfigBytes:MAX_CONFIG_TOTAL,
      configLines:MAX_INI_LINES, payloadBytes:MAX_PAYLOAD, payloadCount:30, payloadScanBytes:MAX_PAYLOAD_SCAN},
    sha256:sha256,
    analyzeIni:analyzeIni,
    compareConfigs:compareConfigs,
    createBackup:createBackup,
    restoreBackup:restoreBackup,
    inspectPayload:inspectPayload,
    validateEntryUrl:validateEntryUrl,
    normalizePath:normalizePath,
    pathOwner:pathOwner
  };
}));
