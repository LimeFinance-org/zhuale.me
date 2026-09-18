CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL,
  last_checkin TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
