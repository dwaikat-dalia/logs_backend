import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  check,
  index,
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

    timestampIdx: index("idx_logs_timestamp")
      .on(table.timestamp.desc()),
  })
);