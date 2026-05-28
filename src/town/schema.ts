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
  // TownBrain paused flag — persisted so an operator pause survives restart.
  paused: integer('paused', { mode: 'boolean' }).default(false),
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
  // Caller-supplied natural-key (e.g. `lost_bot:<residentId>`) — when set,
  // insertDisaster returns the existing row instead of inserting a duplicate.
  dedupeKey: text('dedupe_key'),
});

export const styleObservations = sqliteTable('style_observations', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  buildingId: text('building_id').references(() => buildings.id),
  paletteJson: text('palette_json'),
  recordedAt: integer('recorded_at'),
  included: integer('included', { mode: 'boolean' }).default(true),
});

/**
 * Phase 6-B — approvals queue.
 *
 * Anything that emits a `*:pending_approval` event creates a row here. The
 * brain's approvalLoop tallies open rows on every tick and resolves them
 * (approved/denied/expired). Two approval paths are supported:
 *   - Mayor-direct: mayor decides via API.
 *   - Resident vote: open for `expiresAt - createdAt` (default 90s); the
 *     brain tallies majority once the window closes.
 *
 * `payloadJson` is the original proposal blob (e.g. an ExpansionManager
 * `ChildProposal`) — replayed verbatim by the resolver hook on approval.
 */
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  townId: text('town_id').references(() => towns.id),
  // 'expansion' | 'construction' | 'decree' | 'milestone' | <future>
  kind: text('kind').notNull(),
  // Original proposal blob — the resolveOnce handler decodes this.
  payloadJson: text('payload_json'),
  // 'open' | 'approved' | 'denied' | 'expired'
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  // 'approved' | 'denied' | null (null until mayor decides or vote tallies)
  mayorDecision: text('mayor_decision'),
  // { yes: string[], no: string[] } — bot-name lists keyed by choice
  votesJson: text('votes_json'),
  // Phase 8-followup #57 — handler descriptor for resolveOnce rehydration.
  // Serialised `{ kind, payload, target }` (see ApprovalManager.HandlerDescriptor).
  // Lets the brain re-register the resolveOnce hook after a restart, so a row
  // that approves while the process is down still executes on the next boot.
  handlerDescriptorJson: text('handler_descriptor_json'),
});

/**
 * Phase 7-A — inter-town relationships (directed edges).
 *
 * Supersedes the legacy `towns.alliance_state` column (which is a single
 * global posture per town — kept in place for back-compat). One row per
 * ordered `(town_id_a, town_id_b)` pair carries A's directed stance toward
 * B: state ('allied' | 'rival' | 'neutral'), a 0..100 trust score, the last
 * time something happened on the edge, and a serialised list of recent
 * RelationshipEvents so the dashboard can render history without a separate
 * events feed.
 *
 * DiplomacyManager owns mutation; the brain's diplomacyLoop reads peers via
 * TownManager.listTowns() and feeds in interactions.
 */
export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  // Directed edge — A's stance toward B.
  townIdA: text('town_id_a').references(() => towns.id),
  townIdB: text('town_id_b').references(() => towns.id),
  // 'allied' | 'rival' | 'neutral'
  state: text('state').notNull(),
  trust: integer('trust').notNull(),
  lastInteractionAt: integer('last_interaction_at').notNull(),
  // JSON: Array<{ kind: string; at: number; payload?: unknown }>
  // Kept compact — DiplomacyManager caps the list length.
  eventsJson: text('events_json'),
});
