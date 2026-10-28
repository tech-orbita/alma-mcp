CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE mutation_operations (
  operation text NOT NULL CHECK (operation IN ('crear_cita', 'reagendar_cita', 'cancelar_cita')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  request_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'uncertain')),
  response jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (operation, idempotency_key),
  CHECK ((status = 'succeeded' AND response IS NOT NULL AND error IS NULL) OR status <> 'succeeded'),
  CHECK ((status IN ('failed', 'uncertain') AND error IS NOT NULL) OR status NOT IN ('failed', 'uncertain'))
);

CREATE INDEX mutation_operations_status_created_idx
  ON mutation_operations (status, created_at);

CREATE TABLE consumed_slot_tokens (
  token_hash char(64) PRIMARY KEY,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation, idempotency_key)
    REFERENCES mutation_operations (operation, idempotency_key)
    ON DELETE RESTRICT
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlation_id uuid NOT NULL,
  operation text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'uncertain')),
  entity_type text NOT NULL CHECK (entity_type IN ('cita')),
  entity_id text,
  idempotency_fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);

COMMENT ON TABLE audit_events IS
  'Auditoría mínima de mutaciones. No almacena conversaciones, tokens ni datos de contacto.';
