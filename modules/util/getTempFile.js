const EXPORTED_SYMBOLS = ["getTempFile"];

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("chrome://greasemonkey-modules/content/constants.js");


const DIRECTORY_TEMP = GM_CONSTANTS.directoryService
    .get(GM_CONSTANTS.directoryServiceTempName, Ci.nsIFile);
const FILE_TYPE = Ci.nsIFile.NORMAL_FILE_TYPE;

function getTempFile(aRoot, aLeaf) {
  let file = (aRoot || DIRECTORY_TEMP).clone();
  file.append(aLeaf || GM_CONSTANTS.directoryTempName);
  file.createUnique(FILE_TYPE, GM_CONSTANTS.fileMask);

  return file;
}
