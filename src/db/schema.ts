import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
export const logs = pgTable(
  'logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    timestamp: timestamp('timestamp', {
      withTimezone: true,
    }).notNull(),

    level: varchar('level', {
      length: 10,
    }).notNull(),

    service: varchar('service', {
      length: 255,
    }).notNull(),

    message: text('message').notNull(),

    attributes: jsonb('attributes')
      .default({})
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  },

  (table) => ({
    timestampIdx: index('idx_logs_timestamp_desc')
      .on(table.timestamp.desc(), table.id.desc()),

    serviceIdx: index('idx_logs_service')
      .on(table.service),

    levelIdx: index('idx_logs_level')
      .on(table.level),
  })
);