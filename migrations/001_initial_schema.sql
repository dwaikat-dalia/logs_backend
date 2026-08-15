CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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

-- ==========================================
-- Logs indexes
-- ==========================================

-- Required for sorting + cursor pagination
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_desc
    ON logs (timestamp DESC, id DESC);

-- Service filtering
CREATE INDEX IF NOT EXISTS idx_logs_service
    ON logs (service);

-- Level filtering
CREATE INDEX IF NOT EXISTS idx_logs_level
    ON logs (level);

-- Attribute + service + level + time filtering
CREATE INDEX IF NOT EXISTS idx_logs_user_service_level_time
    ON logs (
        (attributes->>'user_id'),
        service,
        level,
        timestamp DESC,
        id DESC
    );

-- Case-insensitive substring search on message
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm
    ON logs USING GIN (message gin_trgm_ops);


-- ==========================================
-- Rollups
-- ==========================================

CREATE TABLE IF NOT EXISTS log_rollups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    bucket_start TIMESTAMPTZ NOT NULL,

    service VARCHAR(255),

    level VARCHAR(10),

    count INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT uq_log_rollups_bucket_service_level
        UNIQUE (bucket_start, service, level)
);

CREATE INDEX IF NOT EXISTS idx_log_rollups_bucket
    ON log_rollups (bucket_start);