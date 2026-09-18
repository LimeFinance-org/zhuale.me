-- The legacy table stored readable registration fields before the browser-side
-- encryption boundary. The old D1 data was explicitly considered disposable.
-- Rebuild the table so pre-trigger accounts contain only ciphertext and
-- operational metadata. Readable fields are nullable and are used only for
-- records created by the explicit /api/sos trigger.
CREATE TABLE users_privacy (
  id TEXT NOT NULL PRIMARY KEY,
  encrypted_data TEXT,
  name TEXT,
  contact_name TEXT,
  contact_method TEXT,
  note TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL,
  last_checkin TEXT NOT NULL,
  created_at TEXT NOT NULL
);

DROP TABLE users;
ALTER TABLE users_privacy RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
