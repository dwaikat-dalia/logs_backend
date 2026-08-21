import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  index,
  check,
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
    levelCheck: check(
      "logs_level_check",
      sql`${table.level} IN ('debug', 'info', 'warn', 'error')`
    ),

    aggFilterIdx: index("idx_logs_agg_filter").on(
      table.timestamp,
      table.service,
      table.level
    ),

    timestampIdx: index("idx_logs_timestamp_desc").on(
      table.timestamp.desc(),
      table.id.desc()
    ),

    messageTrgmIdx: index("idx_logs_message_trgm")
      .using("gin", table.message)
      .with({ gin_trgm_ops: "gin_trgm_ops" }),
  })
);