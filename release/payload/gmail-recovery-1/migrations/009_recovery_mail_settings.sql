BEGIN;
CREATE TABLE IF NOT EXISTS recovery_mail_settings (
  id smallint PRIMARY KEY CHECK (id=1),
  provider text NOT NULL DEFAULT 'gmail',
  from_name text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  app_password_enc text NOT NULL DEFAULT '',
  reply_to text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO recovery_mail_settings(id,provider,from_name,from_email,app_password_enc,reply_to,enabled)
SELECT
  1,
  'gmail',
  COALESCE(data#>>'{gohouse-data,config,recoveryFromName}',data#>>'{gohouse-data,config,brandName}',''),
  COALESCE(data#>>'{gohouse-data,config,recoveryFromEmail}',''),
  '',
  COALESCE(data#>>'{gohouse-data,config,recoveryReplyTo}',''),
  false
FROM app_state
WHERE id=1
ON CONFLICT(id) DO NOTHING;

REVOKE ALL ON recovery_mail_settings FROM PUBLIC;
COMMIT;
