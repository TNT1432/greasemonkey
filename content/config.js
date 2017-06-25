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

Cu.import("chrome://greasemonkey-modules/content/miscapis.js");
Cu.import("chrome://greasemonkey-modules/content/prefmanager.js");
Cu.import("chrome://greasemonkey-modules/content/script.js");
Cu.import("chrome://greasemonkey-modules/content/third-party/MatchPattern.js");
Cu.import("chrome://greasemonkey-modules/content/util.js");


const TAG_USER_SCRIPT_CONFIG = "UserScriptConfig";

function Config() {
  this._saveTimer = null;
  this._scripts = null;
  this._configFile = GM_util.scriptDir();
  this._configFile.append("config.xml");
  this._globalExcludes = JSON.parse(GM_prefRoot.getValue("globalExcludes"));
  this._observers = [];
}

Config.prototype.GM_GUID = GM_CONSTANTS.addonGUID;

Config.prototype.initialize = function () {
  this._updateVersion();
  this._load();
};

Config.prototype.addObserver = function (aObserver, aScript) {
  let observers = aScript ? aScript._observers : this._observers;
  observers.push(aObserver);
};

Config.prototype.removeObserver = function (aObserver, aScript) {
  let observers = aScript ? aScript._observers : this._observers;
  let index = observers.indexOf(aObserver);
  if (index == -1) {
    throw new Error("Config: Observer not found.");
  }
  observers.splice(index, 1);
},

Config.prototype._notifyObservers = function (aScript, aEvent, aData) {
  let observers = this._observers.concat(aScript._observers);
  for (let i = 0, iLen = observers.length; i < iLen; i++) {
    let observer = observers[i];
    observer.notifyEvent(aScript, aEvent, aData);
  }
};

Config.prototype._changed = function (aScript, aEvent, aData, aDontSave) {
  if (!aDontSave) {
    this._save();
  }

  this._notifyObservers(aScript, aEvent, aData);
};

Config.prototype.installIsUpdate = function (aScript) {
  return this._find(aScript) > -1;
};

Config.prototype._find = function (aScript) {
  for (let i = 0, iLen = this._scripts.length; i < iLen; i++) {
    let script = this._scripts[i]; 
    if (script.id == aScript.id) {
      return i;
    }
  }

  return -1;
};

Config.prototype._load = function () {
  let domParser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
      .createInstance(Components.interfaces.nsIDOMParser);

  let configContents = "<" + TAG_USER_SCRIPT_CONFIG + "/>";
  if (this._configFile.exists()) {
    configContents = GM_util.getContents(this._configFile);
  }
  let doc = domParser.parseFromString(configContents, "text/xml");
  let nodes = doc.evaluate("/" + TAG_USER_SCRIPT_CONFIG + "/Script", doc, null,
      7 /* XPathResult.ORDERED_NODE_SNAPSHOT_TYPE */,
      null);

  this._scripts = [];
  for (let i = 0, node = null; node = nodes.snapshotItem(i); i++) {
    let script;
    try {
      script = new Script(node);
    } catch (e) {
      // If parsing the script node failed, fail gracefully by skipping it.
      GM_util.logError(e, false, e.fileName, e.lineNumber);
      continue;
    }
    if (script.allFilesExist()) {
      this._scripts.push(script);
    } else {
      // TODO:
      // Add a user prompt to restore the missing script here?
      // Perhaps sometime after update works,
      // and we know where to download the script from?
      node.parentNode.removeChild(node);
      this._changed(script, "missing-removed", null);
    }
  }
};

Config.prototype._save = function (aSaveNow) {
  // If we have not explicitly been told to save now, then defer execution
  // via a timer, to avoid locking up the UI.
  if (!aSaveNow) {
    // Reduce work in the case of many changes near to each other in time.
    if (this._saveTimer) {
      this._saveTimer.cancel(this._saveTimer);
    }

    this._saveTimer = Components.classes["@mozilla.org/timer;1"]
        .createInstance(Components.interfaces.nsITimer);

    // Dereference "this" for the closure.
    var _save = GM_util.hitch(this, "_save");

    this._saveTimer.initWithCallback({
      "notify": function () {
        _save(true);
      },
    }, 250, Ci.nsITimer.TYPE_ONE_SHOT);

    return undefined;
  }

  let doc = Components.classes["@mozilla.org/xmlextras/domparser;1"]
      .createInstance(Components.interfaces.nsIDOMParser)
      .parseFromString(
          "<" + TAG_USER_SCRIPT_CONFIG + "></" + TAG_USER_SCRIPT_CONFIG + ">",
          "text/xml");

  for (let i = 0, iLen = this._scripts.length; i < iLen; i++) {
    let scriptObj = this._scripts[i];
    doc.firstChild.appendChild(doc.createTextNode("\n\t"));
    doc.firstChild.appendChild(scriptObj.toConfigNode(doc));
  }

  doc.firstChild.appendChild(doc.createTextNode("\n"));

  let domSerializer = Components
      .classes["@mozilla.org/xmlextras/xmlserializer;1"]
      .createInstance(Components.interfaces.nsIDOMSerializer);
  GM_util.writeToFile(domSerializer.serializeToString(doc), this._configFile);
};

Config.prototype.install = function (
    aScript, aOldScript, aTempDir /* ignore */) {
  let existingIndex = this._find(aOldScript || aScript);
  if (!aOldScript && (existingIndex > -1)) {
    aOldScript = this.scripts[existingIndex];
  }

  if (aOldScript) {
    // Save the old script's state.
    aScript._enabled = aOldScript.enabled;
    aScript.checkRemoteUpdates = aOldScript.checkRemoteUpdates;
    aScript.userExcludes = aOldScript.userExcludes;
    aScript.userMatches = aOldScript.userMatches;
    aScript.userIncludes = aOldScript.userIncludes;

    // Uninstall the old script.
    this.uninstall(aOldScript, true);
  }

  aScript._dependhash = GM_util.hash(aScript._rawMeta);
  aScript._installTime = new Date().getTime();

  this._scripts.push(aScript);

  if (existingIndex > -1) {
    this.move(aScript, existingIndex - this._scripts.length + 1);
  }

  if (aOldScript) {
    this._changed(aScript, "modified", aOldScript.id);
  } else {
    this._changed(aScript, "install", existingIndex);
  }
};

Config.prototype.uninstall = function (aScript, aForUpdate) {
  if (typeof aForUpdate == "undefined") {
    aForUpdate = false;
  }

  let idx = this._find(aScript);
  if (idx > -1) {
    this._scripts.splice(idx, 1);
    aScript.uninstall(aForUpdate);
  }
};

/**
 * Moves an installed user script to a new position
 * in the array of installed scripts.
 *
 * @param script The script to be moved.
 * @param destination Can be either (a) a numeric offset for the script to be
 *                    moved by, or (b) another installed script to which
 *                    position the script will be moved.
 */
Config.prototype.move = function (aScript, aDestination) {
  let from = this._scripts.indexOf(aScript);
  let to = -1;

  // Make sure the user script is installed.
  if (from == -1) {
    return undefined;
  }

  if (typeof aDestination == "number") {
    // If destination is an offset.
    to = from + aDestination;
    to = Math.max(0, to);
    to = Math.min(this._scripts.length - 1, to);
  } else {
    // If destination is a script object.
    to = this._scripts.indexOf(aDestination);
  }

  if (to == -1) {
    return undefined;
  }

  let tmp = this._scripts.splice(from, 1)[0];
  this._scripts.splice(to, 0, tmp);
  this._changed(aScript, "move", to);
},

Object.defineProperty(Config.prototype, "globalExcludes", {
  "get": function Config_getGlobalExcludes() {
    return this._globalExcludes.concat();
  },
  "set": function Config_setGlobalExcludes(aVal) {
    this._globalExcludes = aVal.concat();
    GM_prefRoot.setValue("globalExcludes", JSON.stringify(this._globalExcludes));
  },
  "configurable": true,
  "enumerable": true,
});

Object.defineProperty(Config.prototype, "scripts", {
  "get": function Config_getScripts() {
    return this._scripts.concat();
  },
  "enumerable": true,
});

Config.prototype.getMatchingScripts = function (aTestFunc) {
  return this._scripts.filter(aTestFunc);
};

Config.prototype.updateModifiedScripts = function (
    aWhen, aUrl, aWindowId, aBrowser) {
  // Find any updated scripts or scripts with delayed injection.
  let scripts = this.getMatchingScripts(
      function (script) {
        return (script.runAt == aWhen)
            && (script.isModified() || (script.pendingExec.length != 0));
      });
  if (scripts.length == 0) {
    return undefined;
  }

  for (let i = 0, iLen = scripts.length; i < iLen; i++) {
    let script = scripts[i];
    if (script.pendingExec.length == 0) {
      let scope = {};
      Cu.import("chrome://greasemonkey-modules/content/parseScript.js", scope);
      let parsedScript = scope.parse(
          script.textContent, GM_util.getUriFromUrl(script.downloadURL));
      if (!parsedScript || parsedScript.parseErrors.length) {
        let msg = "(" + script.localized.name + ") "
            + GM_CONSTANTS.localeStringBundle.createBundle(
                GM_CONSTANTS.localeGreasemonkeyProperties)
                .GetStringFromName("error.parsingScript")
            + "\n" + (parsedScript
                ? parsedScript.parseErrors
                : GM_CONSTANTS.localeStringBundle.createBundle(
                    GM_CONSTANTS.localeGreasemonkeyProperties)
                    .GetStringFromName("error.unknown"));
        let chromeWin = GM_util.getBrowserWindow();
        if (chromeWin && chromeWin.gBrowser) {
          let buttons = [];
          buttons.push({
            "accessKey": GM_CONSTANTS.localeStringBundle.createBundle(
                GM_CONSTANTS.localeGreasemonkeyProperties)
                .GetStringFromName("notification.ok.accesskey"),
            "callback": function () {},
            "label": GM_CONSTANTS.localeStringBundle.createBundle(
                GM_CONSTANTS.localeGreasemonkeyProperties)
                .GetStringFromName("notification.ok.label"),
            "popup": null,
          });
          let notificationBox = chromeWin.gBrowser.getNotificationBox();
          let notification = notificationBox.appendNotification(
            msg,
            "parse-userscript",
            "chrome://greasemonkey/skin/icon16.png",
            notificationBox.PRIORITY_WARNING_MEDIUM,
            buttons
          );
          notification.persistence = -1;
        }
        GM_util.logError(msg, true, script.fileURL, null);
      }
      script.updateFromNewScript(parsedScript, aUrl, aWindowId, aBrowser);
    } else {
      // We are already downloading dependencies for this script
      // so add its window to the list.
      script.pendingExec.push({
        "browser": aBrowser,
        "url": aUrl,
        "windowId": aWindowId,
      });
    }
  }

  this._save();
};

Config.prototype.getScriptById = function (aScriptId) {
  for (let i = 0, iLen = this.scripts.length; i < iLen ; i++) {
    let script = this.scripts[i];
    if (aScriptId == script.id) {
      return script;
    }
  }
};

/**
 * Checks whether the version has changed since the last run and performs
 * any necessary upgrades.
 */
Config.prototype._updateVersion = function () {
  Cu.import("resource://gre/modules/AddonManager.jsm");
  AddonManager.getAddonByID(this.GM_GUID, GM_util.hitch(this, function (addon) {
    var oldVersion = GM_prefRoot.getValue("version");
    var newVersion = addon.version;

    // Update the stored current version so we don't do this work again.
    GM_prefRoot.setValue("version", newVersion);

    if (oldVersion == "0.0") {
      // This is the first launch.  Show the welcome screen.
      let chromeWin = GM_util.getBrowserWindow();
      if (chromeWin && chromeWin.gBrowser) chromeWin.setTimeout(function () {
        let url = "http://www.greasespot.net/p/welcome.html"
            + "?utm_source=xpi&utm_medium=xpi&utm_campaign=welcome"
            + "&utm_content=" + newVersion;
        // The setTimeout makes sure we do not execute too early
        // - sometimes the window isn't quite ready to add a tab yet.
        chromeWin.gBrowser.selectedTab = chromeWin.gBrowser.addTab(url);
      }, 1000);
    }

    let _versionMajor = "3";
    let _versionMinor = "5";
    if (newVersion.match(
        new RegExp("^" + _versionMajor + "\\." + _versionMinor, ""))
        && (oldVersion != newVersion)) {
      // See #1944.
      // Re-scan config to load new metadata values.
      var scope = {};
      Cu.import("chrome://greasemonkey-modules/content/parseScript.js", scope);
      for (let i = 0, iLen = this._scripts.length; i < iLen; i++) {
        let script = this._scripts[i];
        let parsedScript = scope.parse(
            script.textContent, GM_util.getUriFromUrl(script.downloadURL));
        try {
          script.updateFromNewScript(parsedScript);
        } catch (e) {
          // Ignore.
        }
      }
    }
  }));
};
