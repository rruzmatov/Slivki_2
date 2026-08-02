const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function backupCorruptJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const backup = `${filePath}.corrupt-${Date.now()}-${randomBytes(3).toString("hex")}`;
  try {
    fs.copyFileSync(filePath, backup, fs.constants.COPYFILE_EXCL);
    return backup;
  } catch (error) {
    console.error(`JSON backup error (${path.basename(filePath)}):`, error?.message || error);
    return null;
  }
}

module.exports = { backupCorruptJson };
