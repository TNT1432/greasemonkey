/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["GM_cookie"];

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

Cu.importGlobalProperties(["URL"]);

Cu.import("resource://gre/modules/Services.jsm");

Cu.import("chrome://greasemonkey-modules/content/util.js");


const CURRENT_HOST_ONLY = true;

function getHostFromUrl(aUrl) {
  try {
    return new URL(aUrl).host;
  } catch (e) {
    return null;
  }
}

function getSanitizeHost(aHost) {
  if (aHost == null || aHost == "") {
    return null;
  }

  return aHost.split(":")[0];
}

function isCookieAtHost(aCookie, aHost) {
  if (aCookie.host == null) {
    return aHost == null;
  }
  if (aCookie.host.startsWith(".")) {
    return ("." + aHost).endsWith(aCookie.host);
  }
  if (aCookie.host === "") {
    return aHost.startsWith("file://" + aCookie.path);
  }

  return aCookie.host == aHost;
}

function GM_cookie(
    aWrappedContentWin, aSandbox, aFileURL, aUrl, aWhat, aDetails) {
  var cookiesService = null;
  try {
    // http://bugzil.la/1221488
    cookiesService = Services.cookies;
  } catch (e) {
    throw new aWrappedContentWin.Error(
        'GM_cookie("' + aWhat + '"): '
        + "Electrolysis (e10s) is not supported.",
        aFileURL, null);
  }

  let host = getHostFromUrl(aUrl);
  // let sandboxPrincipal = Cu.getObjectPrincipal(aSandbox);
  let sanitizeHost = getSanitizeHost(host);
  let what = aWhat.toLowerCase();

  function _delete(aWhat, aWrappedContentWin, aFileURL, aHost, aDetails) {
    let details = {
      "host": aHost,
      "name": undefined,
    };

    if (typeof aDetails == "object") {
      if (!CURRENT_HOST_ONLY) {
        details.host = aDetails.host ? String(aDetails.host) : details.host;
      }
      details.name = aDetails.name ? String(aDetails.name) : details.name;
    }

    if (typeof details.name === "undefined") {
      throw new aWrappedContentWin.Error(
          // GM_cookie - TODO:
          /*
          GM_CONSTANTS.localeStringBundle.createBundle(
              GM_CONSTANTS.localeGreasemonkeyProperties)
              .GetStringFromName("error.cookie.argument.name")
              .replace("%1", aWhat)
              .replace("%2", typeof details.name),
          */
          'GM_cookie("' + aWhat + '") - the argument.name is: '
          + typeof details.name,
          aFileURL, null);
    }

    let result = 0;

    let enm;
    // Firefox 49+
    // http://bugzil.la/1267910
    try {
      let { originAttributes } = aWrappedContentWin.document.nodePrincipal;
      enm = cookiesService.getCookiesFromHost(details.host, originAttributes);
    } catch (e) {
      enm = cookiesService.getCookiesFromHost(details.host);
    }

    while (enm.hasMoreElements()) {
      let cookie = enm.getNext().QueryInterface(Ci.nsICookie2);
      if (isCookieAtHost(cookie, details.host)) {
        if (cookie.name == details.name) {
          try {
            // Firefox 49+
            // http://bugzil.la/1267910
            try {
              cookiesService.remove(
                  cookie.host, cookie.name, cookie.path, false,
                  cookie.originAttributes);
            } catch (e) {
              cookiesService.remove(
                  cookie.host, cookie.name, cookie.path, false);
            }
          } catch (e) {
            throw new aWrappedContentWin.Error(
                'GM_cookie("' + aWhat + '"):'
                + "\n" + e.message,
                aFileURL, null);
          }
          result++;
        }
      }
    }

    return result;
  }

  function _list(aWhat, aWrappedContentWin, aSandbox, aHost, aDetails) {
    let details = {
      "host": aHost,
    };

    if (typeof aDetails == "object") {
      if (!CURRENT_HOST_ONLY) {
        details.host = aDetails.host ? String(aDetails.host) : details.host;
      }
    }

    let enm;
    // Firefox 49+
    // http://bugzil.la/1267910
    try {
      let { originAttributes } = aWrappedContentWin.document.nodePrincipal;
      enm = cookiesService.getCookiesFromHost(details.host, originAttributes);
    } catch (e) {
      enm = cookiesService.getCookiesFromHost(details.host);
    }

    let cookies = [];
    while (enm.hasMoreElements()) {
      let cookie = enm.getNext().QueryInterface(Ci.nsICookie2);
      if (isCookieAtHost(cookie, details.host)) {
        cookies.push({
          "creationTime": cookie.creationTime,
          "expires": cookie.expires,
          "expiry": cookie.expiry,
          "host": cookie.host,
          "isDomain": cookie.isDomain,
          "isHttpOnly": cookie.isHttpOnly,
          "isSecure": cookie.isSecure,
          "isSession": cookie.isSession,
          "lastAccessed": cookie.lastAccessed,
          "name": cookie.name,
          "path": cookie.path,
          "policy": cookie.policy,
          "rawHost": cookie.rawHost,
          "sameSite": cookie.sameSite,
          "status": cookie.status,
          "value": cookie.value,
        });
      }
    }

    return Cu.cloneInto(cookies, aSandbox);
  }

  function _set(aWhat, aWrappedContentWin, aFileURL, aHost, aDetails) {
    let details = {
      "domain": aHost,
    };

    if (typeof aDetails == "object") {
      if (!CURRENT_HOST_ONLY) {
        details.domain = aDetails.domain
            ? "." + String(aDetails.domain)
            : details.domain;
      }
      details.path = aDetails.path ? String(aDetails.path) : "/";
      details.name = aDetails.name ? String(aDetails.name) : undefined;
      details.value = aDetails.value ? String(aDetails.value) : undefined;
      details.secure = !!aDetails.secure;
      details.httpOnly = !!aDetails.httpOnly;
      details.session = !!aDetails.session;
      details.expirationDate = aDetails.expirationDate
          ? Number(aDetails.expirationDate)
          : Date.parse("Jan 17, 2038") / 1000;
      details.sameSite = aDetails.sameSite ? String(aDetails.sameSite) : null;
    } else {
      throw new aWrappedContentWin.Error(
          // GM_cookie - TODO:
          /*
          GM_CONSTANTS.localeStringBundle.createBundle(
              GM_CONSTANTS.localeGreasemonkeyProperties)
              .GetStringFromName("error.cookie.argument")
              .replace("%1", aWhat)
              .replace("%2", typeof aDetails),
          */
          'GM_cookie("' + aWhat + '") - the argument '
          + "is not Object: " + typeof aDetails,
          aFileURL, null);
    }

    if (typeof details.name === "undefined") {
      throw new aWrappedContentWin.Error(
          // GM_cookie - TODO:
          /*
          GM_CONSTANTS.localeStringBundle.createBundle(
              GM_CONSTANTS.localeGreasemonkeyProperties)
              .GetStringFromName("error.cookie.argument.name")
              .replace("%1", aWhat)
              .replace("%2", typeof details.name),
          */
          'GM_cookie("' + aWhat + '") - the argument.name is: '
          + typeof details.name,
          aFileURL, null);
    }
    if (typeof details.value === "undefined") {
      throw new aWrappedContentWin.Error(
          // GM_cookie - TODO:
          /*
          GM_CONSTANTS.localeStringBundle.createBundle(
              GM_CONSTANTS.localeGreasemonkeyProperties)
              .GetStringFromName("error.cookie.argument.value")
              .replace("%1", aWhat)
              .replace("%2", typeof details.value),
          */
          'GM_cookie("' + aWhat + '") - the argument.value is: '
          + typeof details.value,
          aFileURL, null);
    }

    try {
      // Firefox 49+
      // http://bugzil.la/1267910
      try {
        cookiesService.add(
            details.domain,
            details.path,
            details.name,
            details.value,
            details.secure,
            details.httpOnly,
            details.session,
            details.expirationDate,
            aWrappedContentWin.document.nodePrincipal.originAttributes);
            /*
            aWrappedContentWin.document.nodePrincipal.originAttributes,
            details.sameSite);
            */
      } catch (e) {
        cookiesService.add(
            details.domain,
            details.path,
            details.name,
            details.value,
            details.secure,
            details.httpOnly,
            details.session,
            details.expirationDate);
            /*
            details.expirationDate,
            details.sameSite);
            */
      }

      return true;
    } catch (e) {
      throw new aWrappedContentWin.Error(
          'GM_cookie("' + aWhat + '"):'
          + "\n" + e.message,
          aFileURL, null);
    }
  }

  switch (what) {
    case "delete":
      return _delete(
          what, aWrappedContentWin, aFileURL, sanitizeHost,
          aDetails);
      // break;
    case "list":
      return _list(
          what, aWrappedContentWin, aSandbox, sanitizeHost,
          aDetails);
      // break;
    case "set":
      return _set(
          what, aWrappedContentWin, aFileURL, sanitizeHost,
          aDetails);                          
      // break;
    default:
      throw new aWrappedContentWin.Error(
          // GM_cookie - TODO:
          /*
          GM_CONSTANTS.localeStringBundle.createBundle(
              GM_CONSTANTS.localeGreasemonkeyProperties)
              .GetStringFromName("error.cookie.unsupportedType")
              .replace("%1", aWhat),
          */
          "GM_cookie() - unsupported type: " + aWhat,
          aFileURL, null);
      break;
  }
};
