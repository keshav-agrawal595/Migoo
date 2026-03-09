import { integer, json, pgTable, real, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    credits: integer().default(2)
});

export const coursesTable = pgTable("courses", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),
    courseId: varchar({ length: 255 }).notNull().unique(),
    courseName: varchar({ length: 255 }).notNull(),
    userInput: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 255 }).notNull(),
    courseLayout: json().notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    courseThumbnail: text(),
})

export const courseImages = pgTable("course_images", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId),
    imageIndex: integer().notNull(),
    imagePrompt: varchar({ length: 500 }).notNull(),
    imageUrl: varchar({ length: 1000 }).notNull(),
    width: integer().default(1024),
    height: integer().default(576),
    createdAt: timestamp("created_at").defaultNow(),
})

export const chapterContentSlides = pgTable("chapter_content_slides", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId),
    chapterId: varchar({ length: 255 }).notNull(),
    slideId: varchar({ length: 255 }).notNull().unique(),
    slideIndex: integer().notNull(),
    audioUrl: varchar({ length: 500 }),
    imageUrl: varchar({ length: 500 }),
    narration: json().notNull(),
    captions: json(),
    html: text(),
    revealData: json().notNull(),
    audioDuration: real("audio_duration"),
    createdAt: timestamp("created_at").defaultNow(),
})

// ── Short Video Series ──────────────────────────────────────
export const shortVideoSeries = pgTable("short_video_series", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seriesId: varchar({ length: 255 }).notNull().unique(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),

    // Step 1: Niche
    niche: varchar({ length: 500 }).notNull(),

    // Step 2: Voice
    language: varchar({ length: 20 }).notNull(),
    voice: varchar({ length: 100 }).notNull(),

    // Step 3: Music
    music: varchar({ length: 100 }).notNull(),

    // Step 4: Video Style
    videoStyle: varchar("video_style", { length: 100 }).notNull(),

    // Step 5: Caption Style
    captionStyle: varchar("caption_style", { length: 100 }).notNull(),

    // Step 6: Series Details
    title: varchar({ length: 500 }).notNull(),
    duration: varchar({ length: 20 }).notNull(),       // '30-50' or '60-70'
    platform: varchar({ length: 50 }).notNull(),        // 'youtube' | 'instagram' | 'email'
    publishTime: timestamp("publish_time").notNull(),

    // Status tracking
    status: varchar({ length: 50 }).default("pending"), // pending | generating | completed | failed
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
})

