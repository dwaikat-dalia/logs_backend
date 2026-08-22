CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ==================================================
-- Logs
-- ==================================================

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

CREATE INDEX IF NOT EXISTS idx_logs_timestamp
    ON logs (timestamp DESC);


-- ==================================================
-- Minute Aggregation
-- ==================================================

CREATE TABLE IF NOT EXISTS logs_aggregate_minute (
    bucket_start TIMESTAMPTZ NOT NULL,

    service VARCHAR(255) NOT NULL,

    level VARCHAR(10) NOT NULL,

    count BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (
        bucket_start,
        service,
        level
    )
);

CREATE INDEX IF NOT EXISTS idx_logs_aggregate_bucket
    ON logs_aggregate_minute (bucket_start);

CREATE INDEX IF NOT EXISTS idx_logs_aggregate_service
    ON logs_aggregate_minute (
        bucket_start,
        service
    );

CREATE INDEX IF NOT EXISTS idx_logs_aggregate_level
    ON logs_aggregate_minute (
        bucket_start,
        level
    );

    -- ==================================================
-- Aggregate trigger function
-- ==================================================

CREATE OR REPLACE FUNCTION update_logs_aggregate_minute()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO logs_aggregate_minute (
        bucket_start,
        service,
        level,
        count
    )
    SELECT
        date_trunc('minute', timestamp),
        service,
        level,
        COUNT(*)
    FROM new_rows
    GROUP BY
        date_trunc('minute', timestamp),
        service,
        level
    ON CONFLICT (
        bucket_start,
        service,
        level
    )
    DO UPDATE SET
        count =
            logs_aggregate_minute.count
            + EXCLUDED.count;

    RETURN NULL;
END;
$$;


-- ==================================================
-- Aggregate trigger
-- ==================================================

DROP TRIGGER IF EXISTS logs_aggregate_trigger
ON logs;

CREATE TRIGGER logs_aggregate_trigger
AFTER INSERT ON logs
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION update_logs_aggregate_minute();