export type Course = {
    courseId: string;
    courseName: string;
    type: string
    createdAt: string;
    id: number;
    courseLayout: courseLayout;
    chapterContentSlides: ChapterContentSlide[];
}

export type courseLayout = {
    courseName: string;
    courseDescription: string;
    courseId: string;
    level: string;
    totalChapters: number;
    chapters: Chapter[];
}

export type Chapter = {
    chapterId: string;
    chapterTitle: string;
    subContent: string[];
}

export type ChapterContentSlide = {
    id: number;
    courseId: string;
    chapterId: string;
    slideId: string;
    slideIndex: number;
    audioUrl: string;
    narration: { fullText: string };
    captions?: any;
    html: string;
    revealData: string[];
    createdAt: string;
}