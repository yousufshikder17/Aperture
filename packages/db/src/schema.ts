import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ComplexityAssessment,
  MasterResume,
  MatchScore,
  ReferenceList,
  ResumeTemplate,
} from "@aperture/shared";

export const tierEnum = pgEnum("tier", ["free", "pro"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "saved",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
]);
export const progressEnum = pgEnum("progress", [
  "not_started",
  "in_progress",
  "completed",
]);
export const levelEnum = pgEnum("level", [
  "beginner",
  "intermediate",
  "advanced",
]);
export const timeCommitmentEnum = pgEnum("time_commitment", [
  "hours",
  "days",
  "weeks",
  "months",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authSubject: text("auth_subject").unique(),
  email: text("email").notNull().unique(),
  tier: tierEnum("tier").notNull().default("free"),
  orgId: text("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Structured profile data remains separate from reference contacts.
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  masterResume: jsonb("master_resume").$type<MasterResume>(),
  referenceList: jsonb("reference_list").$type<ReferenceList>(),
  template: jsonb("template").$type<ResumeTemplate>(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    salary: text("salary"),
    description: text("description").notNull(),
    postedAt: timestamp("posted_at"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("listings_url_idx").on(t.url)],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    profileVersion: integer("profile_version").notNull(),
    score: jsonb("score").$type<MatchScore>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("matches_user_listing_idx").on(t.userId, t.listingId)],
);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => listings.id),
  status: applicationStatusEnum("status").notNull().default("saved"),
  appliedAt: timestamp("applied_at"),
  // append-only status history for response-rate analytics
  events: jsonb("events")
    .$type<{ status: string; at: string }[]>()
    .notNull()
    .default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Indexed registry entries. Complexity fields are filled by the batch indexer
// at index time so user-facing reads are plain lookups.
export const resources = pgTable(
  "resources",
  {
    id: text("id").primaryKey(), // registry slug
    title: text("title").notNull(),
    url: text("url").notNull(),
    kind: text("kind").notNull(),
    skills: jsonb("skills").$type<string[]>().notNull(),
    free: boolean("free").notNull().default(true),
    level: levelEnum("level"),
    timeCommitment: timeCommitmentEnum("time_commitment"),
    prerequisites: jsonb("prerequisites").$type<string[]>(),
    summary: text("summary"),
    complexity: jsonb("complexity").$type<ComplexityAssessment>(),
    indexedAt: timestamp("indexed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("resources_level_idx").on(t.level)],
);

export const resourceArchive = pgTable(
  "resource_archive",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    progress: progressEnum("progress").notNull().default("not_started"),
    notes: text("notes"),
    savedAt: timestamp("saved_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("archive_user_resource_idx").on(t.userId, t.resourceId)],
);

// Resume builder version history: full snapshot of the master resume per
// version. Joined with improvement_history (same profileVersion key) to show
// ATS score / match-rate improvement per version.
export const resumeVersions = pgTable(
  "resume_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    version: integer("version").notNull(),
    resume: jsonb("resume").$type<MasterResume>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("resume_versions_user_version_idx").on(t.userId, t.version),
  ],
);

// Append-only snapshots: every profile version gets a score snapshot after the
// async recalculation job runs. Powers improvement-over-time views.
export const improvementHistory = pgTable("improvement_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  profileVersion: integer("profile_version").notNull(),
  profileStrength: real("profile_strength"),
  avgMatchScore: real("avg_match_score"),
  avgAtsScore: real("avg_ats_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Freemium enforcement (checked BEFORE any Claude spend).
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    month: text("month").notNull(), // YYYY-MM
    matchesUsed: integer("matches_used").notNull().default(0),
    savesUsed: integer("saves_used").notNull().default(0),
  },
  (t) => [uniqueIndex("usage_user_month_idx").on(t.userId, t.month)],
);
