if (typeof Cc === "undefined") {
  var Cc = Components.classes;
}
if (typeof Ci === "undefined") {
  var Ci = Components.interfaces;
}
if (typeof Cu === "undefined") {
  var Cu = Components.utils;
}

Cu.import("chrome://greasemonkey-modules/content/extractMeta.js");
Cu.import("chrome://greasemonkey-modules/content/parseScript.js");
Cu.import("chrome://greasemonkey-modules/content/prefmanager.js");
Cu.import("chrome://greasemonkey-modules/content/util.js");


//////////////////////// Global constants and variables ////////////////////////

const CLIPBOARD = Cc["@mozilla.org/widget/clipboard;1"]
    .getService(Ci.nsIClipboard);
const METADATA_VALUE_ERROR = "Metadata Value Error";

var gClipText = null;
var gBundle = null;

////////////////////////////////// Functions ///////////////////////////////////

window.addEventListener("load", function window_load() {
  // Init the global string bundle.
  gBundle = document.getElementById("gm-browser-bundle");

  // Load default namespace from pref.
  document.getElementById("namespace").value =
      GM_prefRoot.getValue("newScript.namespace", "");

  // Default the includes with the current page's url.
  let content = window.opener.gBrowser;
  if (content) {
    var messageHandler = null;
    messageHandler = function (aMessage) {
      window.opener.messageManager.removeMessageListener(
          "greasemonkey:newscript-load-end", messageHandler);
      document.getElementById("include").value = aMessage.data.href;
    };
    window.opener.messageManager
        .addMessageListener("greasemonkey:newscript-load-end", messageHandler);

    content.selectedBrowser.messageManager
        .sendAsyncMessage("greasemonkey:newscript-load-start", {});
  }

  gClipText = getClipText();
  document.documentElement.getButton("extra2").collapsed =
      !(gClipText && extractMeta(gClipText));
}, false);

function doInstall() {
  let scriptSrc = createScriptSource();
  if (!scriptSrc) {
    return false;
  }
  let config = GM_util.getService().config;

  // Create a script object with parsed metadata, and...
  let scope = {};
  Cu.import("chrome://greasemonkey-modules/content/parseScript.js", scope);
  var script = scope.parse(scriptSrc);
  // ...make sure entered details will not ruin an existing file.
  if (config.installIsUpdate(script)) {
    let overwrite = confirm(gBundle.getString("newscript.exists"));
    if (!overwrite) {
      return false;
    }
  }

  // Finish making the script object ready to install
  // (put this created script into a file - only way to install it).
  GM_util.installScriptFromSource(scriptSrc, function () {
    // Persist namespace value.
    GM_prefRoot.setValue("newScript.namespace", script.namespace);
    // Now that async write is complete, close the window.
    close();
  });

  return false;
}

function getClipText() {
  let clipText = "";
  try {
    let transferable = Cc["@mozilla.org/widget/transferable;1"]
        .createInstance(Ci.nsITransferable);
    if ("init" in transferable) {
      transferable.init(null);
    }
    transferable.addDataFlavor("text/unicode");
    CLIPBOARD.getData(transferable, CLIPBOARD.kGlobalClipboard);
    let str = {};
    let strLen = {};
    transferable.getTransferData("text/unicode", str, strLen);
    if (str) {
      str = str.value.QueryInterface(Ci.nsISupportsString);
      clipText = str.data.substring(0, strLen.value / 2);
    }
  } catch (e) {
    dump("getClipText - Error reading clipboard (e.g. the image):"
        + "\n" + e + "\n");
  }

  return clipText;
}

function installFromClipboard() {
  GM_util.installScriptFromSource(gClipText);
}

// Assemble the XUL fields into a script template.
function createScriptSource() {
  var source = GM_prefRoot.getValue("newScript.template");
  var removeUnused = GM_prefRoot.getValue("newScript.removeUnused");

  function removeMetaLine(aMetaName) {
    if (!removeUnused) {
      return undefined;
    }
    let re = new RegExp("^//\\s*@" + aMetaName + ".*\\n?", "im");
    source = source.replace(re, "");
  }

  function replaceSingleVal(aMetaName, aOptional) {
    let replaceKey = "%" + aMetaName + "%";
    if (source.indexOf(replaceKey) == -1) {
      return undefined;
    }
    let replaceVal = document.getElementById(aMetaName).value;
    if (!aOptional && !replaceVal) {
      throw {
        "name": METADATA_VALUE_ERROR,
        "message": gBundle.getString("newscript.no" + aMetaName),
      };
    }
    if (aOptional && !replaceVal) {
      removeMetaLine(aMetaName);
    } else {
      source = source.replace(replaceKey, replaceVal);
    }
    return true;
  }

  function replaceMultiVal(aMetaName) {
    let replaceKey = "%" + aMetaName + "%";
    if (source.indexOf(replaceKey) == -1) {
      return undefined;
    };
    let replaceVal = document.getElementById(aMetaName).value.match(/[^\s]+/g);
    if (!replaceVal || (replaceVal.length == 0)) {
      removeMetaLine(aMetaName);
    } else {
      let re = new RegExp("(.+)" + replaceKey);
      let match = source.match(re);
      source = source.replace(replaceKey, replaceVal.join("\n" + match[1]));
    }
  }

  try {
    replaceSingleVal("name", false);
    replaceSingleVal("namespace", false);
    replaceSingleVal("description", true);
    replaceMultiVal("include");
    replaceMultiVal("exclude");
  } catch (e) {
    if (e.name && (e.name == METADATA_VALUE_ERROR)) {
      GM_util.alert(e.message);
      return false;
    } else {
      throw e;
    }
  }

  if (GM_util.getEnvironment().osWindows) {
    source = source.replace(/\n/g, "\r\n");
  }

  return source;
}
