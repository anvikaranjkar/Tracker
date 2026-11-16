BEGIN;
CREATE TABLE IF NOT EXISTS showup_accounts (
  id uuid PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  profile jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS showup_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES showup_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS showup_sessions_expiry ON showup_sessions(expires_at);
CREATE TABLE IF NOT EXISTS showup_auth_limits (
  key text NOT NULL,
  bucket bigint NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, bucket)
);
CREATE INDEX IF NOT EXISTS showup_auth_expiry ON showup_auth_limits(bucket);
CREATE TABLE IF NOT EXISTS showup_pacts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES showup_accounts(id),
  friend_id uuid REFERENCES showup_accounts(id),
  invite_hash text UNIQUE,
  invite_expires_at timestamptz,
  document jsonb NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS showup_pacts_owner ON showup_pacts(owner_id);
CREATE INDEX IF NOT EXISTS showup_pacts_friend ON showup_pacts(friend_id);
COMMIT;
