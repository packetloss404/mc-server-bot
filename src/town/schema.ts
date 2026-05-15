/**
 * Drizzle schema for the Autonomous Town Builder.
 *
 * Definitions mirror section 10 of TOWN_BUILDER_SPEC.md exactly. Types are
 * intentionally kept compatible with PostgreSQL (text PKs, integer epoch
 * millisecond timestamps, json stored as text, boolean as integer 0/1) so the
 * same logical schema can be migrated to Postgres later without rework.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const towns = sqliteTable('towns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  foundedAt: integer('founded_at').notNull(),
  capitalX: integer('capital_x'),
  capitalY: integer('capital_y'),
  capitalZ: integer('capital_z'),
  // 'founding' | 'village' | 'town'
  tier: text('tier'),
  // 'active' | 'dormant' | 'abandoned'
  status: text('status'),
  populationTarget: integer('population_target'),
  // 'allied' | 'rival' | 'neutral' | null
  allianceState: text('alliance_state'),
  // id of the seeding parent town, if any
  parentTownId: text('parent_town_id'),
  // founding preset id (medieval-communal | mid-century-civic)
  styleSeed: text('style_seed'),
  // serialised JSON: mayor info, sliders, etc.
  configJson: text('config_json'),
});

export const residents = sqliteTable('residents', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  botName: text('bot_name').notNull(),
  joinedAt: integer('joined_at').notNull(),
  currentRole: text('current_role'),
  // 'alive' | 'dead' | 'departed'
  status: text('status'),
});

export const districts = sqliteTable('districts', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  name: text('name'),
  // 'medieval-communal' | 'mid-century-civic'
  stylePreset: text('style_preset').notNull(),
  // serialised JSON polygon/AABB describing district bounds
  boundsJson: text('bounds_json'),
  foundedAt: integer('founded_at').notNull(),
  // boolean stored as integer 0/1 — Drizzle's `boolean mode` keeps the API
  // ergonomic while staying Postgres-portable
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
});

export const buildings = sqliteTable('buildings', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  districtId: text('district_id').references(() => districts.id),
  name: text('name'),
  // 'llm' | 'library' | 'mayor_directive'
  schematicSource: text('schematic_source'),
  schematicRef: text('schematic_ref'),
  originX: integer('origin_x'),
  originY: integer('origin_y'),
  originZ: integer('origin_z'),
  width: integer('width'),
  height: integer('height'),
  depth: integer('depth'),
  builtAt: integer('built_at'),
  destroyedAt: integer('destroyed_at'),
  // 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed'
  status: text('status'),
});

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  kind: text('kind').notNull(),
  // 'info' | 'minor' | 'major' | 'critical'
  severity: text('severity'),
  payloadJson: text('payload_json'),
  occurredAt: integer('occurred_at').notNull(),
  // 0..100; higher = more stream-worthy
  highlightScore: integer('highlight_score'),
});

export const chronicleEntries = sqliteTable('chronicle_entries', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  dayNumber: integer('day_number').notNull(),
  // 'daily' | 'milestone' | 'disaster' | 'voice'
  kind: text('kind'),
  body: text('body').notNull(),
  generatedAt: integer('generated_at'),
  model: text('model'),
});

export const botJournals = sqliteTable('bot_journals', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  botName: text('bot_name').notNull(),
  dayNumber: integer('day_number'),
  body: text('body').notNull(),
  generatedAt: integer('generated_at'),
});

export const disasters = sqliteTable('disasters', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  // 'raid' | 'lava' | 'lost_bot' | 'crash'
  kind: text('kind'),
  severity: text('severity'),
  occurredAt: integer('occurred_at'),
  // references markers.json — the park monument id
  memorialMarkerId: text('memorial_marker_id'),
  summary: text('summary'),
});

export const styleObservations = sqliteTable('style_observations', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  buildingId: text('building_id').references(() => buildings.id),
  paletteJson: text('palette_json'),
  recordedAt: integer('recorded_at'),
  included: integer('included', { mode: 'boolean' }).default(true),
});
