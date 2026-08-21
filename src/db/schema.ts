import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

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
    // Sorting + cursor pagination
    timestampIdx: index("idx_logs_timestamp_desc")
      .on(
        table.timestamp.desc(),
        table.id.desc()
      ),

    // Attribute + service + level + time filtering
    userServiceLevelTimeIdx: index(
      "idx_logs_user_service_level_time"
    ).on(
      sql`(${table.attributes}->>'user_id')`,
      table.service,
      table.level,
      table.timestamp.desc(),
      table.id.desc()
    ),

    // Case-insensitive substring search
    messageTrgmIdx: index(
      "idx_logs_message_trgm"
    )
      .using("gin", table.message)
      .with({ gin_trgm_ops: "gin_trgm_ops" }),
  })
);

export const logRollups = pgTable(
  "log_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    bucketStart: timestamp("bucket_start", {
      withTimezone: true,
    }).notNull(),

    service: varchar("service", {
      length: 255,
    }),

    level: varchar("level", {
      length: 10,
    }),

    // Rollup resolution: 1m, 1h, etc.
    bucketSize: varchar("bucket_size", {
      length: 2,
    })
      .notNull()
      .default("1h"),

    count: integer("count")
      .notNull()
      .default(0),
  },

  (table) => ({
    bucketIdx: index("idx_log_rollups_bucket")
      .on(table.bucketStart),

    uniqueBucket: uniqueIndex(
      "uq_log_rollups_size_bucket_service_level"
    ).on(
      table.bucketSize,
      table.bucketStart,
      table.service,
      table.level
    ),
  })
);