const EXPORTED_SYMBOLS = ["extractMeta"];

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("chrome://greasemonkey-modules/content/constants.js");


const SCRIPT_PARSE_META_ALL_REGEXP = new RegExp(
    "^("
    + GM_CONSTANTS.scriptParseBOM
    + ")?"
    + GM_CONSTANTS.scriptParseMetaRegexp,
    "m");

// Get just the stuff between ==UserScript== lines.
function extractMeta(aSource) {
  let meta = aSource.match(SCRIPT_PARSE_META_ALL_REGEXP);
  if (meta) {
    return meta[2].replace(/^\s+/, "");
  }

  return "";
}
