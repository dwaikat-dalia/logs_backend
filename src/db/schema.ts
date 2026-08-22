import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  check,
  index,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

// ==================================================
// Logs
// ==================================================

export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    timestamp: timestamp("timestamp", {
      withTimezone: true,
    }).notNull(),

    level: varchar("level", {
      length: 10,
    }).notNull(),

    service: varchar("service", {
      length: 255,
    }).notNull(),

    message: text("message").notNull(),

    attributes: jsonb("attributes")
      .default({})
      .notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },

  (table) => ({
    levelCheck: check(
      "logs_level_check",
      sql`${table.level} IN ('debug', 'info', 'warn', 'error')`
    ),

    timestampIdx: index("idx_logs_timestamp")
      .on(table.timestamp.desc()),
  })
);


// ==================================================
// Minute-level aggregation
// ==================================================

export const logsAggregateMinute = pgTable(
  "logs_aggregate_minute",
  {
    bucketStart: timestamp("bucket_start", {
      withTimezone: true,
    }).notNull(),

    service: varchar("service", {
      length: 255,
    }).notNull(),

    level: varchar("level", {
      length: 10,
    }).notNull(),

    count: bigint("count", {
      mode: "number",
    })
      .notNull()
      .default(0),
  },

  (table) => ({
    primaryKey: primaryKey({
      columns: [
        table.bucketStart,
        table.service,
        table.level,
      ],
    }),

    bucketIdx: index("idx_logs_aggregate_bucket")
      .on(table.bucketStart),

    serviceIdx: index("idx_logs_aggregate_service")
      .on(
        table.bucketStart,
        table.service
      ),

    levelIdx: index("idx_logs_aggregate_level")
      .on(
        table.bucketStart,
        table.level
      ),
  })
);