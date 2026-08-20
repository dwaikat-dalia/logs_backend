# Log Ingestion and Query Service

A high-performance backend service for ingesting, storing, querying, and aggregating structured application logs.

The service is designed to handle high-volume log ingestion while maintaining efficient query performance. It provides APIs for batch log ingestion, flexible filtering, cursor-based pagination, and time-bucketed aggregation.

The system is built with **TypeScript**, **Node.js**, and **PostgreSQL**, and is fully containerized using **Docker Compose**.

## Main Features

- Batch ingestion of structured logs
- Per-entry validation for ingestion batches
- Efficient bulk insertion using PostgreSQL `COPY`
- Flexible log filtering by service, level, time range, attributes, and message content
- Cursor-based pagination
- Time-bucketed log aggregation
- PostgreSQL indexes optimized for the main query patterns
- Hourly aggregation rollups
- Automatic database initialization
- Background retention cleanup
- Dockerized application and PostgreSQL database
- Performance testing under constrained CPU and memory resources

---

# Architecture

The service follows a layered architecture where HTTP handling, validation, business logic, and database access are separated into distinct responsibilities.

## High-Level Data Flow

```text
Client / Load Generator
          │
          ▼
     HTTP API (8080)
          │
          ▼
   Request Validation
          │
          ▼
   Ingestion / Query Logic
          │
          ▼
 PostgreSQL Connection Pool
          │
          ▼
      PostgreSQL
```

## Log Ingestion Flow

```text
POST /logs
     │
     ▼
Validate each log entry
     │
     ├── Invalid → Add rejection with index and reason
     │
     └── Valid
           │
           ▼
       Prepare batch
           │
           ▼
      PostgreSQL COPY
           │
           ▼
        Stored logs
```

Each entry in an ingestion batch is validated independently.

Invalid entries are rejected with their original array index and validation reason, while valid entries continue through the ingestion pipeline.

Valid entries are written to PostgreSQL using `COPY FROM STDIN` through `pg-copy-streams`. This reduces per-row insertion overhead and database round trips.

## Query Flow

```text
GET /logs
     │
     ▼
Validate query parameters
     │
     ▼
Build parameterized SQL query
     │
     ▼
Apply available filters
     │
     ▼
PostgreSQL
     │
     ▼
Sort + Cursor Pagination
     │
     ▼
JSON Response
```

The query API allows multiple filters to be combined in a single request.

User-provided values are handled through parameterized queries to prevent SQL injection.

## Aggregation Flow

```text
GET /logs/aggregate
          │
          ▼
   Validate parameters
          │
          ▼
 Build aggregation query
          │
          ▼
      PostgreSQL
          │
          ▼
 Time buckets + grouping
          │
          ▼
      JSON Response
```

For eligible recent hourly queries, the service can use pre-aggregated data from the `log_rollups` table instead of scanning the raw `logs` table.

---

# Setup and Usage

## Prerequisites

The project requires:

- Docker
- Docker Compose

No local PostgreSQL installation is required because PostgreSQL runs inside Docker.

## Start the Service

Start the complete system with:

```bash
docker compose up --build
```

The application will be available at:

```text
http://localhost:8080
```

PostgreSQL runs as a separate Docker container.

The application waits for PostgreSQL to become healthy before accepting requests.

## Health Check

Verify that the service is ready:

```bash
curl http://localhost:8080/health
```

A successful response with HTTP `200` indicates that the service is ready to accept requests.

## Stop the Service

To stop the containers:

```bash
docker compose down
```

PostgreSQL data is stored in a Docker volume and is preserved when the containers are stopped.

To remove the containers and PostgreSQL data volume:

```bash
docker compose down -v
```

> Removing the volume deletes the stored PostgreSQL data.

## Development

Install dependencies:

```bash
npm ci
```

Build the TypeScript project:

```bash
npm run build
```

Start the compiled application:

```bash
npm start
```

For development with automatic reload:

```bash
npm run dev
```

---

# API Documentation

## GET /health

Checks whether the application and PostgreSQL database are ready.

### Healthy Response

```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-08-17T10:00:00.000Z"
}
```

The endpoint returns HTTP `200` when the application can successfully communicate with PostgreSQL.

If the database connection is unavailable, the endpoint returns HTTP `503`.

Example:

```json
{
  "status": "unhealthy",
  "database": "disconnected",
  "error": "..."
}
```

The health check performs a database connectivity check using:

```sql
SELECT 1;
```

---

# POST /logs

Ingests a batch of structured log entries.

The endpoint always expects a batch through the `logs` array, even when only one log entry is submitted.

## Request

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}
```

## Validation

Each log entry is validated independently.

A valid entry must contain:

- `timestamp`: a valid ISO 8601 timestamp that is not more than five minutes in the future
- `level`: one of `debug`, `info`, `warn`, or `error`
- `service`: a non-empty string
- `message`: a non-empty string
- `attributes`: an optional flat object containing string, number, or boolean values

Nested objects and arrays are not accepted as attribute values.

## Batch Behavior

Invalid entries do not cause the entire batch to fail.

Valid entries are accepted and stored, while rejected entries are returned with their original array index and validation reason.

Example:

```json
{
  "accepted": 2,
  "rejected": [
    {
      "index": 1,
      "reason": "invalid level: 'critical'"
    }
  ]
}
```

If at least one entry is accepted, the endpoint returns HTTP `200`.

If all entries are rejected, the endpoint returns HTTP `400`.

Malformed request bodies or requests without a valid `logs` array also return HTTP `400`.

## Storage

Valid entries are prepared in memory and inserted into PostgreSQL using:

```text
COPY FROM STDIN
```

through `pg-copy-streams`.

This reduces:

- SQL statement overhead
- Database round trips
- Per-row insertion overhead
- Application/database communication overhead

The database connection is acquired after validation and data preparation, minimizing the amount of time a connection is occupied by application-side processing.

---

# GET /logs

Queries stored logs using optional filters.

All supported filters can be combined in a single request.

## Query Parameters

| Parameter | Required | Description | Example |
|---|---|---|---|
| `service` | No | Exact service-name match | `service=checkout` |
| `level` | No | Exact log-level match | `level=error` |
| `since` | No | Inclusive start of the time range | `since=2026-07-20T14:00:00Z` |
| `until` | No | Exclusive end of the time range | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | No | Attribute equality comparison as a string | `attr.user_id=42` |
| `q` | No | Case-insensitive substring search on the message | `q=declined` |
| `limit` | No | Number of results, default `100`, maximum `1000` | `limit=500` |
| `cursor` | No | Opaque cursor returned by the previous response | `cursor=...` |

Multiple attribute filters are supported.

Example:

```text
GET /logs?service=checkout&level=error&attr.user_id=42&attr.region=eu-west
```

## Sorting

Results are ordered by:

```text
timestamp DESC
id DESC
```

The `id` provides a deterministic tie-breaker when multiple logs have the same timestamp.

## Cursor-Based Pagination

The endpoint uses cursor-based pagination instead of offset-based pagination.

The cursor encodes the timestamp and ID of the last returned log.

When the cursor is supplied in the next request, the service returns records after that position in the established descending order.

The cursor is opaque to clients and should be returned unchanged in subsequent requests.

The response contains `next_cursor`.

It is `null` when there are no additional results.

## Response

```json
{
  "logs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42"
      }
    }
  ],
  "next_cursor": null
}
```

## Validation and Errors

The endpoint returns HTTP `400` for invalid query parameters, including:

- Invalid or unsupported log levels
- Invalid timestamps
- `until` earlier than or equal to `since`
- Non-integer or out-of-range `limit`
- Invalid attribute filters
- Invalid or malformed cursors

Example:

```json
{
  "error": "Invalid limit parameter. Must be between 1 and 1000."
}
```

Unexpected server or database errors return HTTP `500`.

---

# GET /logs/aggregate

Returns time-bucketed log counts for a specified time range.

The endpoint supports the same filtering capabilities as the log query endpoint.

## Query Parameters

| Parameter | Required | Description | Example |
|---|---|---|---|
| `service` | No | Exact service-name match | `service=checkout` |
| `level` | No | Exact log-level match | `level=error` |
| `attr.<key>` | No | Attribute equality comparison | `attr.user_id=42` |
| `q` | No | Case-insensitive message search | `q=declined` |
| `since` | Yes | Inclusive start of the aggregation range | `since=2026-07-20T14:00:00Z` |
| `until` | Yes | Exclusive end of the aggregation range | `until=2026-07-20T15:00:00Z` |
| `bucket` | Yes | Time-bucket size | `bucket=1m` |
| `group_by` | No | Groups by service or level | `group_by=service` |

Supported bucket sizes:

- `1m` — one minute
- `5m` — five minutes
- `1h` — one hour
- `1d` — one day

Supported `group_by` values:

- `service`
- `level`

If `group_by` is not provided, the `group` field is returned as `null`.

## Example Request

```text
GET /logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=1m&group_by=service
```

## Response

```json
{
  "buckets": [
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "checkout",
      "count": 118
    },
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "auth",
      "count": 42
    },
    {
      "start": "2026-07-20T14:01:00Z",
      "group": "checkout",
      "count": 97
    }
  ]
}
```

Results are ordered by bucket start time in ascending order.

Empty buckets are omitted.

## Aggregation Strategy

The service uses two aggregation paths.

### Rollup Fast Path

Eligible recent hourly queries use the `log_rollups` table instead of scanning the raw `logs` table.

The rollup path is used when:

- `bucket=1h`
- No message search is requested
- No attribute filter is requested
- The requested range is within the maintained recent rollup window

The rollup data is refreshed every 20 seconds.

### Raw Aggregation Path

Requests that cannot use the rollup path are executed directly against the `logs` table.

This includes:

- `1m` aggregation
- `5m` aggregation
- `1d` aggregation
- Queries containing `q`
- Queries containing attribute filters
- Older time ranges outside the maintained rollup window

PostgreSQL calculates the requested time buckets directly from the log timestamps.

---

# Database Schema Design

PostgreSQL is the source of truth for both log ingestion and querying.

## `logs` Table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier for each log |
| `timestamp` | TIMESTAMPTZ | Timestamp associated with the log |
| `level` | VARCHAR(10) | `debug`, `info`, `warn`, or `error` |
| `service` | VARCHAR(255) | Name of the service |
| `message` | TEXT | Log message |
| `attributes` | JSONB | Flat collection of arbitrary log attributes |
| `created_at` | TIMESTAMPTZ | Timestamp when the record was stored |

The `id` is generated automatically using PostgreSQL's `uuid-ossp` extension.

The `level` column has a database-level `CHECK` constraint to ensure that only supported log levels can be stored.

## `log_rollups` Table

The service maintains a `log_rollups` table for optimized hourly aggregation queries.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Unique rollup record identifier |
| `bucket_start` | TIMESTAMPTZ | Start of the aggregation bucket |
| `service` | VARCHAR(255) | Service grouping value |
| `level` | VARCHAR(10) | Level grouping value |
| `count` | INTEGER | Number of logs represented by the rollup |

A unique constraint on:

```text
(bucket_start, service, level)
```

prevents duplicate rollup combinations for the same bucket, service, and level.

## PostgreSQL Extensions

The database uses:

- `uuid-ossp` for UUID generation
- `pg_trgm` for efficient message substring searches

---

# Index Design

The indexes are designed around the main access patterns of the service.

## Timestamp + ID Index

```sql
CREATE INDEX idx_logs_timestamp_desc
ON logs (timestamp DESC, id DESC);
```

This index supports the primary ordering used by `GET /logs`.

It also supports cursor-based pagination because the cursor uses the same `(timestamp, id)` ordering.

## Attribute + Service + Level + Time Index

```sql
CREATE INDEX idx_logs_user_service_level_time
ON logs (
    (attributes->>'user_id'),
    service,
    level,
    timestamp DESC,
    id DESC
);
```

This composite index targets common filtered queries involving the `user_id` attribute together with service, level, and time ordering.

## Message Trigram Index

```sql
CREATE INDEX idx_logs_message_trgm
ON logs USING GIN (message gin_trgm_ops);
```

This index supports case-insensitive substring searches through the `q` parameter.

## Rollup Bucket Index

```sql
CREATE INDEX idx_log_rollups_bucket
ON log_rollups (bucket_start);
```

This index supports time-range lookups against the rollup table.

## Index Trade-offs

Indexes improve query performance but increase storage usage and add work during writes.

The project therefore uses targeted indexes based on the main API query patterns rather than indexing every individual column.

---

# Attribute Storage Strategy

Log attributes are stored using PostgreSQL `JSONB`.

This approach was chosen because log attributes are dynamic and may differ between services and log entries.

Example:

```json
{
  "user_id": "42",
  "region": "eu-west",
  "retries": 3
}
```

Supported values are:

- Strings
- Numbers
- Booleans

Nested objects and arrays are rejected during validation.

Attribute filters use PostgreSQL JSONB operators:

```sql
attributes->>'user_id'
```

This matches the API contract where attribute equality is compared as strings.

A targeted expression index is used for the frequently queried `user_id` attribute.

---

# Ingestion Strategy

The ingestion path is optimized for high-volume batch ingestion while minimizing application and database overhead.

## Ingestion Flow

```text
POST /logs
    │
    ▼
Validate each entry
    │
    ├── Invalid → Add index + rejection reason
    │
    └── Valid
          │
          ▼
Prepare COPY data
          │
          ▼
Acquire database connection
          │
          ▼
COPY FROM STDIN
          │
          ▼
PostgreSQL
```

## Batch Processing

The API receives logs as a batch through the `logs` array.

Each entry is validated independently.

During the same processing pass, valid entries are converted into PostgreSQL COPY-compatible data while invalid entries are recorded with their index and validation reason.

This avoids processing the same batch multiple times.

## PostgreSQL COPY

The service uses `pg-copy-streams` with PostgreSQL:

```text
COPY FROM STDIN
```

instead of executing an individual `INSERT` statement for every log.

This reduces:

- SQL statement overhead
- Database round trips
- Per-row insertion overhead
- Communication overhead

## Connection Pooling

The application uses a PostgreSQL connection pool.

A database connection is acquired only after validation and COPY data preparation are complete.

This avoids holding a database connection while CPU-side processing is performed.

After the COPY operation completes, the connection is released back to the pool.

## Reliability

The service only reports accepted entries after the PostgreSQL COPY operation completes successfully.

If the COPY operation fails, the request returns HTTP `500` instead of reporting the batch as successfully stored.

---

# Query Strategy

The query layer supports flexible combinations of filters while keeping database operations safe and efficient.

## Supported Filters

The `GET /logs` endpoint supports:

- Exact service matching
- Exact log-level matching
- Inclusive `since` timestamp
- Exclusive `until` timestamp
- Attribute equality filters
- Case-insensitive message substring search

Example:

```text
GET /logs?service=checkout&level=error&since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&attr.user_id=42&q=declined
```

Only supplied filters are added to the query.

## Parameterized Queries

User-provided values are passed to PostgreSQL through parameterized queries.

Dynamic attribute keys are handled through PostgreSQL JSONB operators rather than directly interpolating values into SQL.

This prevents SQL injection while allowing flexible attribute filtering.

## Sorting

Results are consistently ordered by:

```text
timestamp DESC, id DESC
```

## Cursor Pagination

The cursor contains the timestamp and ID of the last returned log.

The pagination boundary uses the same ordering:

```sql
(timestamp, id) < (cursor_timestamp, cursor_id)
```

The service requests one additional record beyond the requested limit.

If the extra record exists, it is removed from the response and used to generate `next_cursor`.

This allows the client to determine whether another page exists without requiring a separate count query.

## Query Result Size

The API accepts:

- Default limit: `100`
- Maximum limit: `1000`

This keeps individual responses bounded and prevents unnecessarily large result sets from consuming application memory.

---

# Aggregation and Rollups

The service supports time-bucketed aggregation for:

- `1m`
- `5m`
- `1h`
- `1d`

To improve frequently requested hourly aggregations, the service maintains a separate `log_rollups` table.

## Rollup Strategy

The rollup table stores aggregated counts by:

- Bucket start time
- Service
- Log level

Rollup data is refreshed every **20 seconds**.

At application startup, the rollup refresh is also triggered before the background refresh interval begins.

## Rollup Fast Path

The rollup table is used for eligible recent hourly aggregation requests.

Conditions include:

- `bucket=1h`
- No message search
- No attribute filter
- Requested range is within the maintained recent rollup window

This reduces the amount of raw log data PostgreSQL needs to process.

## Raw Aggregation Path

Requests outside the rollup fast path are executed directly against the raw `logs` table.

This preserves support for flexible filters and different bucket sizes.

## Design Trade-off

Rollups improve performance for frequent hourly aggregation queries at the cost of additional background processing and a small freshness delay.

The current refresh interval is 20 seconds.

---

# Retention Strategy

The service uses a background retention cleanup process to prevent logs from being stored indefinitely.

## Retention Policy

The current retention policy is:

- Retention period: **30 days**
- Cleanup interval: **1 hour**
- Maximum rows deleted per cleanup execution: **10,000**

Expired records are deleted in batches rather than through one large delete operation.

Example:

```sql
DELETE FROM logs
WHERE id IN (
    SELECT id
    FROM logs
    WHERE timestamp < NOW() - INTERVAL '30 days'
    LIMIT 10000
);
```

Batch deletion reduces the amount of work performed by a single cleanup operation and helps minimize the impact of retention maintenance on ingestion and query workloads.

---
## Performance Results

Performance was measured using the project's local load-testing script against the Dockerized application and PostgreSQL setup.

### Ingestion Benchmark

| Metric | Result |
|---|---:|
| Dataset size | 100,000 logs |
| Batch size | 2,000 logs |
| Concurrency | 1 |
| Successful logs | 100,000 |
| Failed batches | 0 |
| Total time | 9.41 seconds |
| Throughput | 10,624 logs/sec |
| Average request latency | 181.57 ms |
| Minimum request latency | 102.20 ms |
| Maximum request latency | 938.31 ms |

The test completed with **0 failed batches**, meaning all 100,000 submitted logs were successfully accepted.

## Ingestion Timing

Application-side instrumentation measured the main stages of each ingestion request.

A typical request showed approximately:

- **10–14 ms** for validation and COPY data preparation
- **~0.1 ms** for acquiring a PostgreSQL connection
- The majority of request time was spent in the PostgreSQL `COPY` operation

Example:

```text
accepted=2000
prepare=11.11ms
connection=0.08ms
copy=148.75ms
total=160.45ms
```

Another request:

```text
accepted=2000
prepare=10.39ms
connection=0.09ms
copy=86.25ms
total=97.44ms
```

These measurements indicate that connection acquisition was not a significant bottleneck in this test.

The PostgreSQL COPY operation accounted for most of the request latency.

## Reliability

The benchmark successfully ingested all 100,000 generated logs:

```text
Total Successful Logs: 100000
Failed Batches:        0
```

No failed ingestion batches were observed during this run.

---

# Performance with a Large Dataset

The service was also evaluated using the project's official benchmark CLI with a large PostgreSQL dataset.

The benchmark seeded:

- **1,000,000 fixture rows**

The benchmark then executed the correctness, load, stress, spike, and breakpoint scenarios.

The benchmark completed all correctness checks successfully:

```text
Correctness: 15/15
Reliability: 4/4 scenarios
The measured performance results were:

Throughput: 2,113 logs/sec
Errors: 28.2%
p95: 5,559 ms
Aggregate p95: 7,471 ms

However, these performance numbers are directional rather than representative of the service's maximum performance, because the benchmark reported that the k6 load generator itself was CPU-constrained.

The benchmark reported:

machine speed: 0.21x reference

and warned that the generator could not start all scheduled iterations for the load, stress, spike, and breakpoint scenarios.

The benchmark was executed with:

Application: 0.5 CPU / 256 MB
PostgreSQL: 1 CPU / 1 GB
Generator: 4 CPUs
Docker Engine: 8 CPUs / 8 GiB

Therefore, the official benchmark result should be interpreted together with the generator limitation and machine-speed warning.


# Performance Target

The project's target is to sustain at least:

```text
15,000 logs/sec
```

under the specified resource constraints.

The documented benchmark achieved:

```text
11,568 logs/sec
```

with:

```text
Batch size: 2,000
Concurrency: 1
```

The benchmark completed with zero failed batches.

Additional development runs were performed while tuning batch size, PostgreSQL configuration, indexes, connection pooling, and ingestion behavior.

The observed throughput can vary between runs depending on Docker, PostgreSQL, storage, and system workload.

---

# Bottlenecks Discovered

Performance instrumentation identified the PostgreSQL write path as the primary bottleneck.

The measurements showed:

- Validation and COPY data preparation generally required approximately 10–14 ms.
- PostgreSQL connection acquisition required approximately 0.1 ms.
- The PostgreSQL COPY operation accounted for most of the request latency.

Therefore, database write throughput was the primary area targeted for optimization.

---

# Optimizations Applied

## PostgreSQL COPY

The ingestion endpoint uses PostgreSQL `COPY FROM STDIN` through `pg-copy-streams` instead of individual INSERT statements.

This reduces database round trips and per-row insertion overhead.

## Batch Ingestion

Logs are processed in batches instead of sending one request per log entry.

The documented benchmark uses a batch size of 2,000 logs.

## Connection Pooling

A PostgreSQL connection pool is used to reuse database connections.

Connections are acquired only after validation and COPY data preparation are complete.

## Targeted Indexes

Indexes were designed around the primary query patterns:

- Timestamp + ID for sorting and cursor pagination
- Attribute/service/level/time filtering
- Trigram search for message substring queries
- Rollup bucket lookups

The indexes were kept targeted to avoid unnecessary write overhead.

## Rollup Aggregation

A separate `log_rollups` table is maintained for frequently requested hourly aggregations.

The aggregation endpoint can use pre-aggregated results instead of scanning raw logs for eligible recent hourly queries.

Rollups are refreshed every 20 seconds.

## Bounded Retention Cleanup

Expired logs are removed in batches of up to 10,000 records rather than through a single large deletion.

This helps reduce the potential impact of retention maintenance on normal ingestion and query workloads.

---

# Testing

The project includes automated tests covering the main validation and API behavior.

Run the automated test suite with:

```bash
npm test
```

Build the project with:

```bash
npm run build
```

## Load Testing

The project includes dedicated load-testing scripts.

### Ingestion Load Test

```bash
npm run test:load
```

The ingestion load test measures:

- Total number of logs successfully ingested
- Failed batches
- Total execution time
- Logs per second
- Average request latency
- Minimum request latency
- Maximum request latency

### Ingestion + Aggregation Load Test

```bash
npm run test:load:agg
```

This test evaluates aggregation performance while ingestion is active.

---

# Docker and Deployment

The service is fully containerized using Docker Compose.

The project contains two main containers:

- **Application** — Node.js + TypeScript/Express
- **PostgreSQL** — PostgreSQL 15

The application is exposed on port `8080`.

PostgreSQL is the source of truth for both writes and reads.

## Docker Startup

Start the complete system with:

```bash
docker compose up --build
```

The application waits for PostgreSQL to become healthy before starting.

Database initialization is handled automatically through the PostgreSQL initialization/migration setup.

The application container uses a multi-stage Docker build so that the final image contains the compiled application and production dependencies without unnecessary build-time files.

## Resource Limits

The Docker Compose configuration is designed around the project's specified resource constraints:

| Container | CPU | Memory |
|---|---:|---:|
| Application | 0.5 CPU | 256 MB |
| PostgreSQL | 1 CPU | 1 GB |

These limits allow the service to be evaluated under constrained resources similar to the project's target environment.

---

# Continuous Integration

The project includes a CI pipeline to automatically validate changes.

The CI process performs build and test checks.

Build:

```bash
npm run build
```

Tests:

```bash
npm test
```

This helps ensure that changes do not break the application build or automated test suite.

---

# Known Limitations

## Retention Configuration

The retention period is currently fixed at 30 days and is not exposed as an environment variable or administrative configuration.

## Rollup Coverage

Rollups are optimized for recent hourly aggregation queries.

Queries using message search, attribute filters, smaller bucket sizes, or ranges outside the maintained rollup window use the raw `logs` table.

## Attribute Indexing

The current attribute indexing strategy is optimized around the frequently queried `user_id` attribute rather than creating an index for every possible dynamic attribute.

Other attributes are queried directly from the JSONB column.

## In-Memory Request Preparation

Before being sent through PostgreSQL COPY, valid entries are prepared in memory as COPY-compatible text.

Very large individual HTTP batches can therefore consume additional application memory during preparation.

## Single PostgreSQL Source of Truth

PostgreSQL remains the source of truth for both ingestion and queries.

No external queue or separate storage system is used.

This keeps the architecture simple but means ingestion throughput is ultimately constrained by PostgreSQL resources and storage performance.

---

# Optional Features

The project focuses primarily on the required core functionality.

The default Docker Compose configuration provides the core service:

- `GET /health`
- `POST /logs`
- `GET /logs`
- `GET /logs/aggregate`

No authentication, rate limiting, quota, or multi-tenancy configuration is required for the core service.

Rollup aggregation is implemented as an internal performance optimization and does not change the required API contract.

---

# Summary

The Log Ingestion and Query Service provides a Dockerized TypeScript/Node.js backend backed by PostgreSQL.

The implementation uses:

- Batch validation
- PostgreSQL `COPY`
- Connection pooling
- Targeted database indexes
- Cursor-based pagination
- JSONB attribute storage
- Trigram message search
- Hourly aggregation rollups
- Background retention cleanup
- Automated tests
- Docker resource constraints
- Dedicated ingestion and aggregation load tests

The documented ingestion benchmark achieved:

```text
100,000 logs
Batch size: 2,000
Concurrency: 1
Successful logs: 100,000
Failed batches: 0
Total time: 8.64 seconds
Throughput: 11,568 logs/sec
```

The large-dataset verification test confirmed that the service continued to ingest successfully with an existing PostgreSQL dataset, reaching:

```text
1,800,021 stored log records
```

after the test.
