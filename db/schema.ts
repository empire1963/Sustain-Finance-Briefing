import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const sourceCache = sqliteTable('source_cache', {
  sourceId: text('source_id').primaryKey(),
  payload: text('payload').notNull(),
  checkedAt: integer('checked_at').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
  error: text('error'),
});

export const refreshLease = sqliteTable('refresh_lease', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
});

export const collectorState = sqliteTable('collector_state', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  checkedAt: integer('checked_at').notNull(),
});

export const readerPreferences = sqliteTable('reader_preferences', {
  userId: text('user_id').primaryKey(),
  preferences: text('preferences').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const savedStories = sqliteTable('saved_stories', {
  userId: text('user_id').notNull(),
  articleUrl: text('article_url').notNull(),
  payload: text('payload').notNull(),
  savedAt: integer('saved_at').notNull(),
}, table => [primaryKey({columns:[table.userId,table.articleUrl]})]);
