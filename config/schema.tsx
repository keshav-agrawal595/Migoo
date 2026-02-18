import { integer, json, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
    courseThumbnail: varchar({ length: 1000 }),
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
    createdAt: timestamp("created_at").defaultNow(),
})
