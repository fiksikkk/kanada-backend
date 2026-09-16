CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE auth.users (
  id                     SERIAL PRIMARY KEY,
  username               TEXT NOT NULL UNIQUE,
  display_name           TEXT,
  password_hash          TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  scope_restricted       BOOLEAN NOT NULL DEFAULT false,
  totp_secret_enc        TEXT,
  totp_enabled           BOOLEAN NOT NULL DEFAULT false,
  totp_confirmed_at      TIMESTAMPTZ,
  failed_login_attempts  SMALLINT NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.totp_recovery_codes (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_secret   TEXT NOT NULL,
  ip_address    INET,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE auth.login_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INT REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.user_scope_access (
  user_id     INT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_id    TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_id)
);
