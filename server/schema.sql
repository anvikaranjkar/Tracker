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
ALTER TABLE showup_pacts ADD COLUMN IF NOT EXISTS invite_token text;

CREATE TABLE IF NOT EXISTS showup_pact_members (
  pact_id uuid NOT NULL REFERENCES showup_pacts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES showup_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (pact_id, account_id)
);
CREATE INDEX IF NOT EXISTS showup_pact_members_account ON showup_pact_members(account_id, pact_id);
INSERT INTO showup_pact_members(pact_id, account_id)
  SELECT id, owner_id FROM showup_pacts
  UNION ALL SELECT id, friend_id FROM showup_pacts WHERE friend_id IS NOT NULL
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS showup_pact_invites (
  pact_id uuid NOT NULL REFERENCES showup_pacts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES showup_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(pact_id, account_id)
);
CREATE INDEX IF NOT EXISTS showup_pact_invites_account ON showup_pact_invites(account_id, expires_at);

CREATE TABLE IF NOT EXISTS showup_push_subscriptions (
  endpoint text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES showup_accounts(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  last_reminder date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS showup_push_account ON showup_push_subscriptions(account_id);
COMMIT;
