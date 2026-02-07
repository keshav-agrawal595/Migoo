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

            console.log("=== DEBUG: Course Data Structure ===");
            console.log("1. Course ID:", res.data?.courseId);
            console.log("2. Course Name:", res.data?.courseName);
            console.log("3. Course Layout exists?", !!res.data?.courseLayout);
            console.log("4. Chapters in Layout:", res.data?.courseLayout?.chapters?.length);
            console.log("5. ChapterContentSlides exists?", !!res.data?.chapterContentSlides);
            console.log("6. ChapterContentSlides length:", res.data?.chapterContentSlides?.length);
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
                console.log("\n💡 TO REGENERATE CONTENT:");
                console.log("1. Clear the chapter_content_slides table in your database");
                console.log("2. OR modify the TESTING_MODE in generate-video-content/route.ts");
                console.log("3. OR add a 'Regenerate' button to the UI");
            }
        } catch (error) {
            console.error("❌ Error fetching course:", error);
            toast.error("Failed to fetch course details", {
                id: loadingToast
            });
        }
    }

    const GenerateVideoContent = async (course: Course) => {
        console.log("\n" + "═".repeat(80));
        console.log("🎬 Starting Video Content Generation");
        console.log("═".repeat(80));
        console.log("Course ID:", course.courseId);
        console.log("Course Name:", course.courseName);
        console.log("Total Chapters:", course.courseLayout.chapters.length);
        console.log("═".repeat(80) + "\n");

        isGenerating.current = true;

        if (!course?.courseLayout?.chapters || course.courseLayout.chapters.length === 0) {
            console.log("⚠️ No chapters found to generate content for");
            toast.error("No chapters found in course layout");
            return;
        }

        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < course.courseLayout.chapters.length; i++) {
            const chapter = course.courseLayout.chapters[i];

            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 Processing Chapter ${i + 1}/${course.courseLayout.chapters.length}`);
            console.log(`${'='.repeat(80)}`);
            console.log(`Chapter ID: ${chapter.chapterId}`);
            console.log(`Chapter Title: ${chapter.chapterTitle}`);
            console.log(`Sub-content items: ${chapter.subContent?.length}`);
            console.log(`${'='.repeat(80)}`);

            const loadingToast = toast.loading(
                `Generating Video Content for Chapter ${i + 1}/${course.courseLayout.chapters.length}: ${chapter.chapterTitle}`,
                { duration: Infinity }
            );

            try {
                console.log(`📤 Sending request for Chapter ${chapter.chapterId} (index ${i})...`);

                const res = await axios.post(`/api/generate-video-content`, {
                    chapter: chapter,
                    courseId: course.courseId,
                    courseName: course.courseName,
                    chapterIndex: i  // ⚠️ CRITICAL: Pass chapter index for testing mode
                });

                console.log(`✅ Chapter ${i + 1} Response:`, res.data);

                if (res.data.skipped) {
                    skippedCount++;
                    console.log(`⏭️ Chapter ${i + 1} was skipped:`, res.data.reason || res.data.message);
                    toast.info(`Chapter ${i + 1} skipped: ${res.data.message}`, {
                        id: loadingToast,
                        duration: 3000
                    });
                } else {
                    successCount++;
                    console.log(`🔊 Audio URLs for Chapter ${i + 1}:`,
                        res.data.data?.map((slide: any) => slide.audioUrl)
                    );

                    toast.success(
                        `✅ Video Content for Chapter ${i + 1} Generated Successfully! (${res.data.data?.length} slides)`,
                        { id: loadingToast, duration: 4000 }
                    );
                }

            } catch (error: any) {
                errorCount++;
                console.error(`❌ Error generating content for Chapter ${i + 1}:`, error);
                console.error('Error details:', error.response?.data || error.message);

                toast.error(
                    `Failed to generate content for Chapter ${i + 1}: ${error.response?.data?.error || error.message}`,
                    { id: loadingToast, duration: 6000 }
                );
            }
        }

        // Generation complete
        console.log("\n" + "═".repeat(80));
        console.log("🎉 Video Content Generation Complete!");
        console.log("═".repeat(80));
        console.log(`✅ Successful: ${successCount} chapters`);
        console.log(`⏭️ Skipped: ${skippedCount} chapters`);
        console.log(`❌ Errors: ${errorCount} chapters`);
        console.log("═".repeat(80) + "\n");

        isGenerating.current = false;

        // Show final summary
        if (successCount > 0 || skippedCount > 0) {
            toast.success(
                `Generation Complete! Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
                { duration: 6000 }
            );
        }

        // Refresh course data to show the newly generated slides
        if (successCount > 0) {
            console.log("🔄 Refreshing course data to load generated slides...");
            await GetCourseDetails();
        }
    }

    return (
        <div className='flex flex-col items-center'>
            <CourseInfoCard course={courseDetails} />
            <CourseChapters course={courseDetails} />
        </div>
    )
}

export default CoursePage