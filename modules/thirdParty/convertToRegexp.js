/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is AdBlock for Mozilla.
 *
 * The Initial Developer of the Original Code is
 * Henrik Aasted Sorensen.
 * Portions created by the Initial Developer are Copyright (C) 2002
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 * Henrik Aasted Sorensen <henrik@aasted.org>
 * Stefan Kinitz <mcmurmel.blah@gmx.de>
 * Rue <quill@ethereal.net>
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ["GM_convertToRegexp"];

if (typeof Cc === "undefined") {
  var Cc = Components.classes;
}
if (typeof Ci === "undefined") {
  var Ci = Components.interfaces;
}
if (typeof Cu === "undefined") {
  var Cu = Components.utils;
}

Cu.import("chrome://greasemonkey-modules/content/util.js");


const TLD_REGEXP = /^([^:]+:\/\/[^\/]+)\.tld(\/.*)?$/;

// Exposed outer method takes regex as string, and handles the magic TLD.
// (Can't memoize a URI object, yet we want to do URL->URI outside this method,
// once for efficiency. Compromise: memoize just the internal string handling.)
function GM_convertToRegexp(aPattern, aUri, aForceGlob) {
  let reStr = GM_convertToRegexpInner(aPattern, aForceGlob);

  // Inner returns a RegExp, not str, for input regex (not glob) patterns.
  // Use those directly without magic TLD modifications.
  if (reStr instanceof RegExp) {
    return reStr;
  }

  if (aUri && reStr.match(TLD_REGEXP)) {
    let tld = null;
    try {
      tld = Cc["@mozilla.org/network/effective-tld-service;1"]
          .getService(Ci.nsIEffectiveTLDService)
          .getPublicSuffix(aUri);
    } catch (e) {
      // There are expected failure modes, i.e. bare hostname
      // - like http://localhost/ - has no TLD.
    }
    if (tld) {
      reStr = reStr.replace(TLD_REGEXP, "$1." + tld + "$2");
    }
  }

  return new RegExp(reStr, "i");
}

// Memoized internal implementation just does glob -> regex translation.
function GM_convertToRegexpInner(pattern, forceGlob) {
  let s = new String(pattern);

  if (!forceGlob && (s.substr(0, 1) == "/") && (s.substr(-1, 1) == "/")) {
    // Leading and trailing slash means raw regex.
    return new RegExp(s.substring(1, s.length - 1), "i");
  }

  let res = "^";

  for (let i = 0, iLen = s.length; i < iLen; i++) {
    switch(s[i]) {
      case "*" :
        res += ".*";
        break;
      case "." :
      case "?" :
      case "^" :
      case "$" :
      case "+" :
      case "{" :
      case "}" :
      case "[" :
      case "]" :
      case "|" :
      case "(" :
      case ")" :
      case "\\" :
        res += "\\" + s[i];
        break;
      case " " :
        // Remove spaces from URLs.
        break;
      default :
        res += s[i];
        break;
    }
  }

  return res + "$";
}
GM_convertToRegexpInner = GM_util.memoize(GM_convertToRegexpInner);