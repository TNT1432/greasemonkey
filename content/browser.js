Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import('chrome://greasemonkey-modules/content/prefmanager.js');
Components.utils.import('chrome://greasemonkey-modules/content/util.js');

var gStringBundle = Components
    .classes["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .createBundle("chrome://greasemonkey/locale/gm-browser.properties");

var GM_GUID = "{e4a8a97b-f2ed-450b-b12d-ee082ba24781}";
var gGreasemonkeyVersion = "unknown";
Components.utils.import("resource://gre/modules/AddonManager.jsm");
AddonManager.getAddonByID(GM_GUID, function (addon) {
  gGreasemonkeyVersion = "" + addon.version;
});


// this file is the JavaScript backing for the UI wrangling which happens in
// browser.xul. It also initializes the Greasemonkey singleton which contains
// all the main injection logic, though that should probably be a proper XPCOM
// service and wouldn't need to be initialized in that case.

function GM_BrowserUI() {};

GM_BrowserUI.init = function() {
  window.addEventListener("load", GM_BrowserUI.chromeLoad, false);
  window.addEventListener("unload", GM_BrowserUI.chromeUnload, false);
  window.messageManager.addMessageListener('greasemonkey:open-in-tab',
      GM_BrowserUI.openInTab);
  window.messageManager.addMessageListener("greasemonkey:DOMContentLoaded",
      function (aMessage) {
        var contentType = aMessage.data.contentType;
        var href = aMessage.data.href;
        GM_BrowserUI.checkDisabledScriptNavigation(contentType, href);
      });
};

/**
 * The browser XUL has loaded. Find the elements we need and set up our
 * listeners and wrapper objects.
 */
GM_BrowserUI.chromeLoad = function(aEvent) {
  GM_BrowserUI.bundle = Components.classes["@mozilla.org/intl/stringbundle;1"]
      .getService(Components.interfaces.nsIStringBundleService)
      .createBundle("chrome://greasemonkey/locale/gm-browser.properties");

  // Update visual status when enabled state changes.
  GM_prefRoot.watch("enabled", GM_BrowserUI.refreshStatus);
  GM_BrowserUI.refreshStatus();

  document.getElementById("contentAreaContextMenu")
    .addEventListener("popupshowing", GM_BrowserUI.contextMenuShowing, false);

  GM_BrowserUI.gmSvc = GM_util.getService();
  // Reference this once, so that the getter is called at least once, and the
  // initialization routines will run, no matter what.
  GM_BrowserUI.gmSvc.config;

  // Initialize the chrome side handling of menu commands.
  GM_MenuCommander.initialize();

  GM_BrowserUI.showToolbarButton();

  // Make sure this is imported at least once, so its internal timer starts.
  Components.utils.import('chrome://greasemonkey-modules/content/stats.js');
};

/**
 * Opens the specified URL in a new tab.
 */
GM_BrowserUI.openTab = function(url) {
  gBrowser.selectedTab = gBrowser.addTab(url);
};

/**
 * Handles tab opening for a GM_openInTab API call.
 */
GM_BrowserUI.openInTab = function(aMessage) {
  var browser = aMessage.target;
  var tabBrowser = browser.getTabBrowser();
  // PaleMoon
  var scriptTab = null;
  if (tabBrowser.getTabForBrowser) { 
    scriptTab = tabBrowser.getTabForBrowser(browser);
  } else if (tabBrowser._getTabForBrowser) {
    // Firefox >= 23, Firefox < 35 (i.e. PaleMoon)
    // https://bugzilla.mozilla.org/show_bug.cgi?id=662008
    scriptTab = tabBrowser._getTabForBrowser(browser);
  }
  // SeaMonkey
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1149775
  if (!scriptTab || !scriptTab._tPos) {  
    var _sm_pm_windowTabs = browser.ownerDocument.defaultView.getBrowser().tabs;
    var _sm_pm_windowTab = null;
    for (var _sm_pm_tabIndex = 0,
        _sm_pm_windowTabsLength = _sm_pm_windowTabs.length;
        _sm_pm_tabIndex < _sm_pm_windowTabsLength; _sm_pm_tabIndex++) {
      _sm_pm_windowTab = _sm_pm_windowTabs[_sm_pm_tabIndex];
      if (_sm_pm_windowTab.linkedBrowser == browser) {
        scriptTab = _sm_pm_windowTab;
        scriptTab._tPos = _sm_pm_tabIndex;
        break;
      }
    }
  }
  var scriptTabIsCurrentTab = scriptTab == tabBrowser.mCurrentTab;
  // Work around a race condition in Firefox code with E10S disabled.
  // See #2107 and #2234
  // Todo: Remove timeout when http://bugzil.la/1200334 is resolved.
  GM_util.timeout(function () {
    var getBool = Services.prefs.getBoolPref;

    var prefBg = (aMessage.data.inBackground === null)
        ? getBool("browser.tabs.loadInBackground")
        : aMessage.data.inBackground;
    var prefRel = (aMessage.data.afterCurrent === null)
        ? getBool("browser.tabs.insertRelatedAfterCurrent")
        : aMessage.data.afterCurrent;

    var newTab = tabBrowser.addTab(
        aMessage.data.url,
        {
            'ownerTab': prefBg ? null : tabBrowser.selectedTab,
            'relatedToCurrent': scriptTabIsCurrentTab,
        });

    if (scriptTabIsCurrentTab && !prefBg) {
      tabBrowser.selectedTab = newTab;
    }

    if (prefRel) {
      tabBrowser.moveTabTo(newTab, scriptTab._tPos + 1);
    } else {
      tabBrowser.moveTabTo(newTab, tabBrowser.tabs.length - 1);
    }
  }, 0);
};

/**
 * The browser XUL has unloaded. Destroy references/watchers/listeners.
 */
GM_BrowserUI.chromeUnload = function() {
  GM_prefRoot.unwatch("enabled", GM_BrowserUI.refreshStatus);
  GM_MenuCommander.uninitialize();
};

/**
 * Called when the content area context menu is showing. We figure out whether
 * to show our context items.
 */
GM_BrowserUI.contextMenuShowing = function() {
  GM_BrowserUI.getUserScriptUrlUnderPointer(function(aUrl) {
    var contextItem = document.getElementById("greasemonkey-view-userscript");
    var contextSep = document.getElementById("greasemonkey-install-sep");
    contextItem.hidden = contextSep.hidden = !aUrl;
  });
};

GM_BrowserUI.getUserScriptUrlUnderPointer = function(callback) {
  var culprit = gContextMenu.target || document.popupNode;
  if (!culprit) {
    callback(null);
    return;
  }

  var mm = gBrowser.selectedBrowser.messageManager;
  var messageHandler;
  messageHandler = function (aMessage) {
    mm.removeMessageListener("greasemonkey:context-menu-end", messageHandler);

    var href = aMessage.data.href;
    if (href && href.match(/\.user\.js(\?|$)/i)) {
      callback(href);
    } else {
      callback(null);
    }
  };
  mm.addMessageListener("greasemonkey:context-menu-end", messageHandler);

  // Firefox < 25 (i.e. PaleMoon)
  // https://bugzilla.mozilla.org/show_bug.cgi?id=870180
  var _sm_pm_href = "";
  if (document.popupNode) {
    while (culprit && culprit.tagName
        && culprit.tagName.toLowerCase() != "a") {
      culprit = culprit.parentNode;
    }
    _sm_pm_href = culprit.href;
  }
  mm.sendAsyncMessage(
      "greasemonkey:context-menu-start",
      {"href": _sm_pm_href}, {"culprit": culprit});
};

GM_BrowserUI.refreshStatus = function() {
  var enabledEl = document.getElementById("gm_toggle_enabled");
  var checkedEl = document.getElementById("gm_toggle_checked");

  if (GM_util.getEnabled()) {
    checkedEl.setAttribute('checked', true);
    enabledEl.removeAttribute('disabled');
  } else {
    checkedEl.setAttribute('checked', false);
    enabledEl.setAttribute('disabled', 'yes');
  }
};

// Not used directly, kept for GreaseFire.  See #1507.
GM_BrowserUI.startInstallScript = function(aUri) {
  GM_util.showInstallDialog(aUri.spec, gBrowser);
};

GM_BrowserUI.viewContextItemClicked = function() {
  GM_BrowserUI.getUserScriptUrlUnderPointer(function(aUrl) {
    if (!aUrl) return;

    var scope = {};
    Components.utils.import(
        "chrome://greasemonkey-modules/content/remoteScript.js", scope);
    var rs = new scope.RemoteScript(aUrl);
    rs.downloadScript(function (aSuccess) {
      if (aSuccess) {
        rs.showSource(gBrowser);
      } else {
        alert(rs.errorMessage);
      }
    });
  });
};

GM_BrowserUI.showToolbarButton = function() {
  // See #1652.  During transition, this might be set, but not readable yet;
  // transition happens in an async callback to get addon version.  If existing
  // version is "0.0" (the default), this hasn't happened yet, so try later.
  if ('0.0' == GM_prefRoot.getValue("version")) {
    setTimeout(GM_BrowserUI.showToolbarButton, 50);
    return;
  }

  // Once, enforce that the toolbar button is present.  For discoverability.
  if (!GM_prefRoot.getValue('haveInsertedToolbarbutton')) {
    GM_prefRoot.setValue('haveInsertedToolbarbutton', true);

    var navbar = document.getElementById("nav-bar");
    var newset = navbar.currentSet + ",greasemonkey-tbb";
    navbar.currentSet = newset;
    navbar.setAttribute("currentset", newset);
    document.persist("nav-bar", "currentset");
  }
};

GM_BrowserUI.openOptions = function() {
  openDialog('chrome://greasemonkey/content/options.xul', null, 'modal,resizable');
};

GM_BrowserUI.checkDisabledScriptNavigation = function(aContentType, aHref) {
  if (GM_util.getEnabled()) return;
  if (!aHref.match(/\.user\.js$/)) return;
  if (aContentType.match(/^text\/(x|ht)ml/)) return;

  var buttons = [{
    'label': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.enable'),
    'accessKey': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.enable.accessKey'),
    'popup': null,
    'callback': function() {
      GM_util.setEnabled(true);
    }
  },{
    'label': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.enableAndInstall'),
    'accessKey': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.enableAndInstall.accessKey'),
    'popup': null,
    'callback': function() {
      GM_util.setEnabled(true);
      GM_util.showInstallDialog(aHref, gBrowser);
    }
  },{
    'label': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.install'),
    'accessKey': GM_BrowserUI.bundle.GetStringFromName('disabledWarning.install.accessKey'),
    'popup': null,
    'callback': function() {
      GM_util.showInstallDialog(aHref, gBrowser);
    }
  }];

  var notificationBox = gBrowser.getNotificationBox();
  var notification = notificationBox.appendNotification(
    GM_BrowserUI.bundle.GetStringFromName('greeting.msg'),
    "install-userscript",
    "chrome://greasemonkey/skin/icon16.png",
    notificationBox.PRIORITY_WARNING_MEDIUM,
    buttons
  );
  notification.persistence = -1;
};

GM_BrowserUI.init();


/**
 * Handle clicking one of the items in the popup. Left-click toggles the enabled
 * state, right-click opens in an editor.
 */
function GM_popupClicked(aEvent) {
  var script = aEvent.target.script;
  if (!script) return;

  if ('command' == aEvent.type) {
    // left-click: toggle enabled state
    script.enabled =! script.enabled;
  } else if ('click' == aEvent.type && aEvent.button == 2) {
    // right-click: open in editor
    GM_util.openInEditor(script);
  }

  closeMenus(aEvent.target);
}

/**
 * When a menu pops up, fill its contents with the list of scripts.
 */
function GM_showPopup(aEvent) {
  // Make sure this event was triggered by opening the actual monkey menu,
  // not one of its submenus.
  if (aEvent.currentTarget != aEvent.target) return;

  var mm = getBrowser().mCurrentBrowser.frameLoader.messageManager;

  // See #2276
  var aEventTarget = aEvent.target;

  var callback = null;
  callback = function(message) {
    mm.removeMessageListener("greasemonkey:frame-urls", callback);

    var urls = message.data.urls;
    asyncShowPopup(aEventTarget, urls);
  };

  mm.addMessageListener("greasemonkey:frame-urls", callback);
  mm.sendAsyncMessage("greasemonkey:frame-urls", {});
}

function getScripts() {
  function uniq(a) {
    var seen = {}, list = [], item;
    for (var i = 0; i < a.length; i++) {
      item = a[i];
      if (!seen.hasOwnProperty(item))
        seen[item] = list.push(item);
    }
    return list;
  }
  getScripts.uniq = uniq;

  function scriptsMatching(urls) {
    function testMatchURLs(script) {
      function testMatchURL(url) {
        return script.matchesURL(url);
      }
      return urls.some(testMatchURL);
    }
    return GM_util.getService().config.getMatchingScripts(testMatchURLs);
  }
  getScripts.scriptsMatching = scriptsMatching;

  function appendScriptAfter(script, point, noInsert) {
    if (script.needsUninstall) return;
    var mi = document.createElement("menuitem");
    mi.setAttribute("label", script.localized.name);
    if (script.noframes) {
      mi.setAttribute("tooltiptext", "noframes");
    }
    mi.script = script;
    mi.setAttribute("type", "checkbox");
    mi.setAttribute("checked", script.enabled.toString());
    if (!noInsert) {
      point.parentNode.insertBefore(mi, point.nextSibling);
    }
    return {"menuItem": mi, "noframes": script.noframes};
  }
  getScripts.appendScriptAfter = appendScriptAfter;
}
getScripts();

function asyncShowPopup(aEventTarget, urls) {
  var popup = aEventTarget;
  var scriptsFramedEl = popup.getElementsByClassName("scripts-framed-point")[0];
  var scriptsTopEl = popup.getElementsByClassName("scripts-top-point")[0];
  var scriptsSepEl = popup.getElementsByClassName("scripts-sep")[0];
  var noScriptsEl = popup.getElementsByClassName("no-scripts")[0];

  // Remove existing menu items, between separators.
  function removeMenuitemsAfter(el) {
    while (true) {
      var sibling = el.nextSibling;
      if (!sibling || 'menuseparator' == sibling.tagName) break;
      sibling.parentNode.removeChild(sibling);
    }
  }
  removeMenuitemsAfter(scriptsFramedEl);
  removeMenuitemsAfter(scriptsTopEl);

  urls = getScripts.uniq(urls);
  var runsOnTop = getScripts.scriptsMatching( [urls.shift()] ); // first url = top window
  var runsFramed = getScripts.scriptsMatching( urls ); // remainder are all its subframes

  // drop all runsFramed scripts already present in runsOnTop
  for (var i = 0; i < runsOnTop.length; i++) {
    var j = 0, item = runsOnTop[i];
    while (j < runsFramed.length) {
      if (item === runsFramed[j]) {
        runsFramed.splice(j, 1);
      } else {
        j++;
      }
    }
  }

  scriptsSepEl.collapsed = !(runsOnTop.length && runsFramed.length);
  noScriptsEl.collapsed = !!(runsOnTop.length || runsFramed.length);

  var point;
  if (runsFramed.length) {
    point = scriptsFramedEl;
    runsFramed.forEach(
        function (script) {
          point = getScripts.appendScriptAfter(script, point).menuItem;
        });
  }
  point = scriptsTopEl;
  runsOnTop.forEach(
      function (script) {
        point = getScripts.appendScriptAfter(script, point).menuItem;
      });

  // Propagate to commands sub-menu.
  GM_MenuCommander.onPopupShowing(aEventTarget);
}

/**
 * Clean up the menu after it hides to prevent memory leaks
 */
function GM_hidePopup(aEvent) {
  // Only handle the actual monkey menu event.
  if (aEvent.currentTarget != aEvent.target) return;
  // Propagate to commands sub-menu.
  GM_MenuCommander.onPopupHiding();
}

// Short-term workaround for #1406: Tab Mix Plus breaks opening links in
// new tabs because it depends on this function, and incorrectly checks for
// existance of GM_BrowserUI instead of it.
function GM_getEnabled() {
  return GM_util.getEnabled();
}

function GM_showTooltip(aEvent) {
  function setTooltip(aUrls) {
    var urls = getScripts.uniq(aUrls);
    var runsOnTop = getScripts.scriptsMatching( [urls.shift()] ); // first url = top window
    var runsFramed = getScripts.scriptsMatching( urls ); // remainder are all its subframes

    var versionElm = aEvent.target
        .getElementsByClassName("greasemonkey-tooltip-version")[0];
    versionElm.setAttribute("value",
        gStringBundle.GetStringFromName("tooltip.greasemonkeyVersion")
            .replace("%1", gGreasemonkeyVersion)
    );

    var enabled = GM_util.getEnabled();
    var enabledElm = aEvent.target
        .getElementsByClassName("greasemonkey-tooltip-enabled")[0];
    enabledElm.setAttribute("value", enabled
        ? gStringBundle.GetStringFromName("tooltip.enabled")
        : gStringBundle.GetStringFromName("tooltip.disabled")
    );

    if (enabled) {
      aEvent.target.classList.add("greasemonkey-tooltip-isActive");

      var total = 0;
      var totalEnable = 0;
      GM_util.getService().config.scripts.forEach(function (script) {
        total++;
        totalEnable = totalEnable + (script.enabled ? 1 : 0);
      });

      var total = totalEnable + "/" + total;
      var totalElm = aEvent.target
          .getElementsByClassName("greasemonkey-tooltip-total")[0];
      totalElm.setAttribute("value",
          gStringBundle.GetStringFromName("tooltip.total")
              .replace("%1", total)
      );

      var runsOnTopEnable = 0;
      var runsFramedEnable = 0;
      var runsFramedNoframesDisable = 0;

      var _runsFramed;
      var _runsFramedEnable;
      var point;
      if (runsFramed.length) {
        runsFramed.forEach(
            function (script) {
              _runsFramed = getScripts.appendScriptAfter(script, point, true);
              _runsFramedEnable = ((_runsFramed.menuItem
                  .getAttribute("checked") == "true") ? 1 : 0);
              runsFramedEnable = runsFramedEnable + _runsFramedEnable;
              if (_runsFramedEnable) {
                runsFramedNoframesDisable = runsFramedNoframesDisable
                    + ((!_runsFramed.noframes) ? 1 : 0);
              }
        });
      }
      runsOnTop.forEach(
          function (script) {
            runsOnTopEnable = runsOnTopEnable + ((getScripts
                .appendScriptAfter(script, point, true)
                .menuItem.getAttribute("checked") == "true") ? 1 : 0);
      });

      var activeFrames = runsFramedNoframesDisable + "/"
          + runsFramedEnable + "/" + runsFramed.length;
      var activeFramesElm = aEvent.target
          .getElementsByClassName("greasemonkey-tooltip-active")[1];
      activeFramesElm.setAttribute("value",
          gStringBundle.GetStringFromName("tooltip.activeFrames")
              .replace("%1", activeFrames)
      );
      var activeTop = runsOnTopEnable + "/" + runsOnTop.length;
      var activeTopElm = aEvent.target
          .getElementsByClassName("greasemonkey-tooltip-active")[0];
      activeTopElm.setAttribute("value",
          gStringBundle.GetStringFromName("tooltip.activeTop")
              .replace("%1", activeTop)
      );
    } else {
      aEvent.target.classList.remove("greasemonkey-tooltip-isActive");
    }
  }

  var mm = aEvent.target.ownerDocument.defaultView
      .gBrowser.mCurrentBrowser.frameLoader.messageManager;

  var callback = null;
  callback = function (aMessage) {
    mm.removeMessageListener("greasemonkey:frame-urls", callback);

    var urls = aMessage.data.urls;
    setTooltip(urls);
  };

  mm.addMessageListener("greasemonkey:frame-urls", callback);
  mm.sendAsyncMessage("greasemonkey:frame-urls", {});
}
