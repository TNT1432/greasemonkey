const EXPORTED_SYMBOLS = ["getEnabled"];

if (typeof Cc === "undefined") {
  var Cc = Components.classes;
}
if (typeof Ci === "undefined") {
  var Ci = Components.interfaces;
}
if (typeof Cu === "undefined") {
  var Cu = Components.utils;
}

Cu.import("chrome://greasemonkey-modules/content/prefmanager.js");


function getEnabled() {
  return GM_prefRoot.getValue("enabled", true);
}
