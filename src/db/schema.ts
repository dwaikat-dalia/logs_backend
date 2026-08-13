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

export const logRollups = pgTable(
  'log_rollups',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    bucketStart: timestamp('bucket_start', {
      withTimezone: true,
    }).notNull(),

    service: varchar('service', {
      length: 255,
    }),

    level: varchar('level', {
      length: 10,
    }),

    count: integer('count')
      .notNull()
      .default(0),
  },
  (table) => ({
    bucketIdx: index('idx_log_rollups_bucket')
      .on(table.bucketStart),

    uniqueBucket: uniqueIndex(
      'uq_log_rollups_bucket_service_level'
    ).on(
      table.bucketStart,
      table.service,
      table.level
    ),
  })
);