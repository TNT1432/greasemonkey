const EXPORTED_SYMBOLS = ["hash"];

if (typeof Cc === "undefined") {
  var Cc = Components.classes;
}
if (typeof Ci === "undefined") {
  var Ci = Components.interfaces;
}
if (typeof Cu === "undefined") {
  var Cu = Components.utils;
}

Cu.import("chrome://greasemonkey-modules/content/constants.js");

Cu.import("chrome://greasemonkey-modules/content/util.js");


function hash(unicode) {
  let unicodeConverter = Components
      .classes["@mozilla.org/intl/scriptableunicodeconverter"]
      .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
  unicodeConverter.charset = GM_CONSTANTS.fileScriptCharset;

  let data = unicodeConverter.convertToByteArray(unicode, {});
  let ch = Components.classes["@mozilla.org/security/hash;1"]
      .createInstance(Components.interfaces.nsICryptoHash);
  // SHA1: Backward compatibility for Sync
  ch.init(ch.SHA1);
  ch.update(data, data.length);
  // Hash as raw octets.
  let hash = ch.finish(false);

  let hex = [];
  for (let i = 0, iLen = hash.length; i < iLen; i++) {
    hex.push(("0" + hash.charCodeAt(i).toString(16)).slice(-2));
  }
  return hex.join("");
}
hash = GM_util.memoize(hash);
