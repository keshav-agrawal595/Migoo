import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course } from '@/type/CourseType';
import { getAudioData } from '@remotion/media-utils';
import { Player } from '@remotion/player';
import { Dot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CourseComposition } from './ChapterVideo';

type Props = {
    course: Course | undefined;
}

function CourseChapters({ course }: Props) {
    const fps = 30;
    const [durationsByChapterId, setDurationsByChapterId] = useState<Record<string, {
        slidesDurations: Record<string, number>;
        totalFrames: number;
    }> | null>(null);

    useEffect(() => {
        let cancelled = false;

        const calculateDurations = async () => {
            if (!course?.chapterContentSlides || course.chapterContentSlides.length === 0) {
                setDurationsByChapterId(null);
                return;
            }

            console.log('🎵 Calculating durations per chapter...');

            const chapters = course.courseLayout?.chapters || [];
            const durationsMap: Record<string, { slidesDurations: Record<string, number>; totalFrames: number }> = {};

            for (const chapter of chapters) {
                const chapterSlides = course.chapterContentSlides.filter(
                    slide => slide.chapterId === chapter.chapterId
                );

                if (chapterSlides.length > 0) {
                    const slidesDurations: Record<string, number> = {};
                    let totalFrames = 0;

                    for (const slide of chapterSlides) {
                        try {
                            const audioData = await getAudioData(slide.audioUrl);
                            const audioSeconds = audioData.durationInSeconds;
                            const frames = Math.max(1, Math.ceil(audioSeconds * fps));
                            slidesDurations[slide.slideId] = frames;
                            totalFrames += frames;
                        } catch (error) {
                            console.error(`Error getting audio data for slide ${slide.slideId}:`, error);
                            slidesDurations[slide.slideId] = 30; // fallback
                            totalFrames += 30;
                        }
                    }

                    durationsMap[chapter.chapterId] = { slidesDurations, totalFrames };
                    console.log(`✅ Chapter ${chapter.chapterId}: ${chapterSlides.length} slides, ${totalFrames} frames`);
                }
            }

            if (!cancelled) {
                setDurationsByChapterId(durationsMap);
            }
        };

        calculateDurations();
        return () => {
            cancelled = true;
        };
    }, [course?.chapterContentSlides?.length, fps]);

    return (
        <div className='max-w-6xl -mt-5 p-10 border rounded-3xl shadow-lg w-full bg-background/80 backdrop-blur-xl'>
            <div className='flex justify-between items-center'>
                <h2 className='font-bold text-2xl mb-2'>Course preview</h2>
                <h2 className='text-sm text-muted-foreground'>Chapters and Short Preview</h2>
            </div>
            <div className='mt-5'>
                {course?.courseLayout?.chapters?.map((chapter, index) => {
                    const chapterSlides = course.chapterContentSlides?.filter(
                        slide => slide.chapterId === chapter.chapterId
                    ) || [];
                    const chapterDurations = durationsByChapterId?.[chapter.chapterId];

                    return (
                        <Card key={index} className='mb-5'>
                            <CardHeader>
                                <div className='flex items-center gap-3'>
                                    <h2 className='p-2 bg-primary/40 inline-flex h-10 w-10 text-center rounded-2xl justify-center items-center'>{index + 1}</h2>
                                    <CardTitle className='md:text-xl text-base'>
                                        {chapter.chapterTitle}
                                    </CardTitle>
                                </div>
                            </CardHeader>

                            <CardContent>
                                <div className='grid grid-cols-2 gap-5'>
                                    <div>
                                        {chapter.subContent.map((content, index) => (
                                            <div key={index} className='flex gap-2 items-center mt-2'>
                                                <Dot className='h-5 w-5 text-primary' />
                                                <h2>{content}</h2>
                                            </div>
                                        ))}
                                    </div>
                                    <div>
                                        <Player
                                            component={CourseComposition}
                                            durationInFrames={chapterDurations?.totalFrames || 30}
                                            compositionWidth={1280}
                                            compositionHeight={720}
                                            fps={fps}
                                            controls
                                            style={{
                                                width: '100%',
                                                height: '180px',
                                            }}
                                            inputProps={{
                                                slides: chapterSlides.map(slide => ({
                                                    slideId: slide.slideId,
                                                    html: slide.html,
                                                    audioFileUrl: slide.audioUrl,
                                                    revealData: slide.revealData,
                                                    caption: slide.captions  // Pass the entire caption object with chunks
                                                })),
                                                durationsBySlideId: chapterDurations?.slidesDurations || {}
                                            }}
                                        />
                                    </div>
                                </div>
                            </CardContent>

                        </Card>
                    );
                })}
            </div>
        </div>
    )
}

export default CourseChapters