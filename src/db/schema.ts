import { pgTable, uuid, timestamp, varchar, text, jsonb, index } from 'drizzle-orm/pg-core';

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  level: varchar('level', { length: 20 }).notNull(),
  service: varchar('service', { length: 100 }).notNull(),
  message: text('message').notNull(),
  attributes: jsonb('attributes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    timestampIdx: index('logs_timestamp_idx').on(table.timestamp.desc()),
    serviceIdx: index('logs_service_idx').on(table.service),
    // attributesGinIdx: index('logs_attributes_gin_idx').using('gin', table.attributes),
  };
});