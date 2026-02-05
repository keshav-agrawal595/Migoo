"use client"
import { Course } from '@/type/CourseType';
import axios from 'axios';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import CourseChapters from './_components/CourseChapters';
import CourseInfoCard from './_components/CourseInfoCard';

function CoursePage() {
    const { courseId } = useParams();
    const [courseDetails, setCourseDetails] = useState<Course>();
    const isGenerating = useRef(false);

    useEffect(() => {
        GetCourseDetails();
    }, [courseId])

    const GetCourseDetails = async () => {
        const loadingToast = toast.loading("Fetching Course Details...");
        try {
            const res = await axios.get(`/api/course?courseId=${courseId}`);

            // ADD THESE DEBUG LOGS:
            console.log("=== DEBUG: Course Data Structure ===");
            console.log("1. Course ID:", res.data?.courseId);
            console.log("2. Course Name:", res.data?.courseName);
            console.log("3. Course Layout exists?", !!res.data?.courseLayout);
            console.log("4. Chapters in Layout:", res.data?.courseLayout?.chapters?.length);
            console.log("5. ChapterContentSlides exists?", !!res.data?.chapterContentSlides);
            console.log("6. ChapterContentSlides type:", typeof res.data?.chapterContentSlides);
            console.log("7. ChapterContentSlides value:", res.data?.chapterContentSlides);
            console.log("8. ChapterContentSlides length:", res.data?.chapterContentSlides?.length);
            console.log("9. First slide:", res.data?.chapterContentSlides?.[0]);
            console.log("=== END DEBUG ===");

            setCourseDetails(res.data);
            toast.success("Course Details Fetched Successfully!", {
                id: loadingToast
            });

            if (!res.data?.chapterContentSlides || res.data.chapterContentSlides.length === 0) {
                if (!isGenerating.current) {
                    console.log("✅ CONDITION TRUE: No slides found, generating content...");
                    GenerateVideoContent(res.data);
                } else {
                    console.log("⚠️ Generation already in progress, skipping...");
                }
            } else {
                console.log("❌ CONDITION FALSE: Slides already exist in database!");
                console.log("Number of existing slides:", res.data.chapterContentSlides.length);
                console.log("To regenerate content, you need to:");
                console.log("1. Clear the chapterContentSlides table in your database");
                console.log("2. OR modify the condition to always regenerate");
                console.log("3. OR add a 'Regenerate' button");
            }
        } catch (error) {
            console.error("❌ Error fetching course:", error);
            toast.error("Failed to fetch course details", {
                id: loadingToast
            });
        }
    }

    const GenerateVideoContent = async (course: Course) => {
        console.log("🎬 Starting Video Content Generation for course:", course.courseId);
        isGenerating.current = true;

        if (!course?.courseLayout?.chapters || course.courseLayout.chapters.length === 0) {
            console.log("⚠️ No chapters found to generate content for");
            return;
        }

        for (let i = 0; i < course.courseLayout.chapters.length; i++) {
            const chapter = course.courseLayout.chapters[i];
            console.log(`📝 Processing Chapter ${i + 1}:`, chapter.chapterTitle);

            const loadingToast = toast.loading(`Generating Video Content for Chapter ${i + 1}...`);

            try {
                console.log(`📤 Sending request for Chapter ${chapter.chapterId}`);
                const res = await axios.post(`/api/generate-video-content`, {
                    chapter: chapter,
                    courseId: course.courseId,
                    courseName: course.courseName // Add this for the prompt
                });

                console.log(`✅ Chapter ${i + 1} Response:`, res.data);
                console.log(`🔊 Audio URLs for Chapter ${i + 1}:`,
                    res.data.data?.map((slide: any) => slide.audioUrl)
                );

                toast.success(`Video Content for Chapter ${i + 1} Generated Successfully!`, {
                    id: loadingToast
                });

            } catch (error: any) {
                console.error(`❌ Error generating content for Chapter ${i + 1}:`, error);
                toast.error(`Failed to generate content for Chapter ${i + 1}: ${error.message}`, {
                    id: loadingToast
                });
            }
        }

        // Mark generation as complete
        console.log("✅ All chapters processed!");
        isGenerating.current = false;

        // Refresh course data to show the newly generated slides
        console.log("🔄 Refreshing course data to load generated slides...");
        await GetCourseDetails();
    }

    return (
        <div className='flex flex-col items-center'>
            <CourseInfoCard course={courseDetails} />
            <CourseChapters course={courseDetails} />
        </div>
    )
}

export default CoursePage