import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  shareCode: text("share_code").notNull().unique(),
  title: text("title").notNull(),
  destination: text("destination").notNull(),
  budget: real("budget").notNull(),
  createdAt: text("created_at").notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey(),
  tripId: text("trip_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  amount: real("amount").notNull(),
  time: text("time").notNull(),
  day: integer("day").notNull(),
  createdBy: text("created_by").notNull().default("我"),
});

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey(),
  tripId: text("trip_id").notNull(),
  time: text("time").notNull(),
  title: text("title").notNull(),
  place: text("place").notNull(),
  day: integer("day").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
});

export const tripMembers = sqliteTable("trip_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tripId: text("trip_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  lastSeen: text("last_seen").notNull(),
});

export const dayPhotos = sqliteTable("day_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tripId: text("trip_id").notNull(),
  day: integer("day").notNull(),
  place: text("place").notNull(),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull(),
  objectKey: text("object_key"),
});

export const tripSettings = sqliteTable("trip_settings", {
  tripId: text("trip_id").primaryKey(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tripArchives = sqliteTable("trip_archives", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  destination: text("destination").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  archivedAt: text("archived_at").notNull(),
});
