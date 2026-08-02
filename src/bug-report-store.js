const fs = require("node:fs");
const path = require("node:path");
const { backupCorruptJson } = require("./json-file-safety");

const MAX_REPORTS = 2000;

class BugReportStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.maxReports = Math.max(1, Number(options.maxReports) || MAX_REPORTS);
  }

  append(report) {
    const reports = this.load();
    reports.push(report);
    const retained = reports.slice(-this.maxReports);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, reports: retained }, null, 2), "utf8");
    fs.renameSync(temporary, this.filePath);
    return report;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(state?.reports) ? state.reports : [];
    } catch (error) {
      const backup = backupCorruptJson(this.filePath);
      throw new Error(`Bug report storage is corrupted; backup: ${backup ? path.basename(backup) : "не создан"}; ${error.message}`);
    }
  }
}

module.exports = { BugReportStore, MAX_REPORTS };
