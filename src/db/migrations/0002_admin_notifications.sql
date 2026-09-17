CREATE TABLE auth.admin_notifications (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error')),
  title       TEXT NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = непрочитано. Статус общий на всех админов (не per-user) -
  -- см. план: несколько админов делят одну очередь, а не персональные копии.
  read_at     TIMESTAMPTZ
);

CREATE INDEX admin_notifications_unread_idx
  ON auth.admin_notifications (created_at)
  WHERE read_at IS NULL;
