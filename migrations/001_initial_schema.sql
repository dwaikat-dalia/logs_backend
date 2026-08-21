CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS pg_trgm;


DROP TABLE IF EXISTS log_rollups;


CREATE TABLE IF NOT EXISTS logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    timestamp TIMESTAMPTZ NOT NULL,

    level VARCHAR(10) NOT NULL
        CHECK (level IN ('debug', 'info', 'warn', 'error')),

    service VARCHAR(255) NOT NULL,

    message TEXT NOT NULL,

    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_logs_agg_filter
    ON logs (timestamp, service, level);


CREATE INDEX IF NOT EXISTS idx_logs_timestamp_desc
    ON logs (timestamp DESC, id DESC);


CREATE INDEX IF NOT EXISTS idx_logs_message_trgm
    ON logs USING GIN (message gin_trgm_ops);