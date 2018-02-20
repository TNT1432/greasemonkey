/* Add listeners to detect user scripts and open the installation dialog. */

(function() {

const userScriptTypes = [
   'text/plain',
   'application/ecmascript',
   'application/javascript',
   'application/x-javascript',
   'text/ecmascript',
   'text/javascript',
];
const contentTypeRe = new RegExp(`(${userScriptTypes.join('|')})(;.*)?`);

function catchParseUserScript(userScriptContent, url) {
  try {
    return parseUserScript(userScriptContent, url, true);
  } catch (err) {
    // It's not important why the parse failed or threw. Just treat it as the
    // parsing was unsuccessful and fetch more data.
    // Log the error so it isn't silently dismissed.
    // TODO: This may flood the console
    console.info('Detect script parse error', err);
    return false;
  }
}


// Examine headers before determining if script checking is needed
function checkHeaders(responseHeaders) {
  for (header of responseHeaders) {
    let headerName = header.name.toLowerCase();
    if ('content-type' === headerName && contentTypeRe.test(header.value)) {
      return true;
    }
  }
  return false;
}


// Check if enough content is available to open an install message
function checkScript(userScriptContent, url) {
  let scriptDetails = catchParseUserScript(userScriptContent, url);
  if (scriptDetails) {
    openInstallDialog(scriptDetails, url);
    return true;
  } else {
    return false;
  }
}


function detectUserScriptOnHeadersReceived(details) {
  if (!getGlobalEnabled() || !checkHeaders(details.responseHeaders)) {
    return {};
  }

  let decoder = new TextDecoder("utf-8");
  let encoder = new TextEncoder();
  let filter = chrome.webRequest.filterResponseData(details.requestId);

  let userScriptContent = '';

  filter.ondata = event => {
    userScriptContent = userScriptContent
        + decoder.decode(event.data, {'stream': true});
    if (checkScript(userScriptContent, details.url)) {
      // We have enough for the details. Since we use a new window for install
      // the filter can be flushed and disconnected so that Firefox handles
      // the rest of the data normally.
      filter.write(encoder.encode(userScriptContent));
      filter.disconnect();
    }
  };
  filter.onstop = event => {
    // One last check to see if we have a valid script.
    checkScript(userScriptContent, details.url);
    // Regardless, since we use a new window just flush the filter and close.
    filter.write(encoder.encode(userScriptContent));
    filter.close();
  };

  return {};
}
window.detectUserScriptOnHeadersReceived = detectUserScriptOnHeadersReceived;


// Open platform specific installation dialog
function openInstallDialog(scriptDetails, url) {
  chrome.runtime.getPlatformInfo(platform => {
    let installUrl = chrome.runtime.getURL('src/content/install-dialog.html')
        + '?' + escape(JSON.stringify(scriptDetails));

    if ('android' === platform.os) {
      chrome.tabs.create({'active': true, 'url': installUrl});
    } else {
      let options = {
        'height': 640,
        'titlePreface': _('$1 - Greasemonkey User Script', scriptDetails.name),
        'type': 'popup',
        'url': installUrl,
        'width': 480,
      };
      chrome.windows.create(options, newWindow => {
        // Fix for Fx57 bug where bundled page loaded using
        // browser.windows.create won't show contents unless resized.
        // See https://bugzilla.mozilla.org/show_bug.cgi?id=1402110
        chrome.windows.update(newWindow.id, {width: newWindow.width + 1});
      });
    }
  });
}

})();
