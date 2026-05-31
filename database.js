const Database = require("better-sqlite3");

const db = new Database("database.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  firstName TEXT,
  username TEXT,
  messages INTEGER DEFAULT 0,
  warnings INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY,
  title TEXT,
  joinedAt TEXT
);
`);

module.exports = db;