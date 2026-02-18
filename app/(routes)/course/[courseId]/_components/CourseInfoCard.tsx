import { Course } from '@/type/CourseType';
import { getAudioData } from "@remotion/media-utils";
import { Player, PlayerRef } from '@remotion/player';
import { BookOpen, ChartNoAxesColumnIncreasing, Clock, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CourseComposition } from './ChapterVideo';
import { CustomPlayerControls, formatTime } from './CourseChapters';

type Props = {
    course: Course | undefined;
}

function CourseInfoCard({ course }: Props) {
    const fps = 30;
    const slides = course?.chapterContentSlides ?? [];
    const [durationsBySlideId, setDurationsBySlideId] = useState<Record<string, number> | null>(null);

    const playerRef = useRef<PlayerRef | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    console.log('📦 CourseInfoCard - Course data:', {
        hasCourse: !!course,
        slidesCount: slides.length,
        slidesData: slides
    });

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            // Only run if we have slides
            if (!slides || slides.length === 0) {
                setDurationsBySlideId(null);
                return;
            }

            console.log(`🎵 Calculating durations for ${slides.length} slides...`);

            const entries = await Promise.all(slides.map(async (slide) => {
                const audioData = await getAudioData(slide.audioUrl);
                const audioSeconds = audioData.durationInSeconds;
                const frame = Math.max(1, Math.ceil(audioSeconds * fps));
                return [slide.slideId, frame] as const;
            }))

            if (!cancelled) {
                setDurationsBySlideId(Object.fromEntries(entries));
                console.log(`✅ Duration calculation complete`);
            }
        }
        run();
        return () => {
            cancelled = true;
        }
    }, [slides.length, fps]);

    // Calculate total duration in frames and seconds
    const totalFrames = durationsBySlideId
        ? Object.values(durationsBySlideId).reduce((sum, frames) => sum + frames, 0)
        : 0;
    const totalSeconds = totalFrames / fps;

    console.log("durationsBySlideId", durationsBySlideId);
    console.log("Total Duration:", {
        totalFrames,
        totalSeconds: totalSeconds.toFixed(2),
        formatted: formatTime(totalSeconds)
    });

    return (
        <div>
            <div className='p-20 rounded-2xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 bg-gradient-to-br from-slate-950 via-slate-800 to-emerald-950'>
                <div>
                    <h2 className='flex gap-2 p-1 px-2 border rounded-2xl inline-flex text-white border-gray-200/70'><Sparkles />Course Preview</h2>
                    <h2 className='text-5xl font-bold mt-5 text-white'>{course?.courseLayout?.courseName}</h2>
                    <p className='text-lg text-muted-foreground mt-3'>{course?.courseLayout?.courseDescription}</p>

                    <div className='mt-5 flex gap-5'>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><ChartNoAxesColumnIncreasing className='text-sky-400' />{course?.courseLayout?.level}</h2>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><BookOpen className='text-green-400' />{course?.courseLayout?.totalChapters} Chapters</h2>
                        {durationsBySlideId && (
                            <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'>
                                <Clock className='text-orange-400' />
                                {formatTime(totalSeconds)}
                            </h2>
                        )}
                    </div>

                </div>
                {/* Player + custom controls wrapper for fullscreen */}
                <div ref={containerRef} className='border-2 rounded-2xl border-white/10 overflow-hidden lg:col-span-2' style={{ background: '#000' }}>
                    <Player
                        ref={playerRef}
                        component={CourseComposition}
                        durationInFrames={totalFrames || 30}
                        compositionWidth={1280}
                        compositionHeight={720}
                        fps={fps}
                        style={{
                            width: '100%',
                            height: 'calc(100% - 34px)',
                        }}
                        inputProps={{
                            slides: slides.map(slide => ({
                                slideId: slide.slideId,
                                html: slide.html,
                                audioFileUrl: slide.audioUrl,
                                revealData: slide.revealData,
                                caption: slide.captions
                            })),
                            durationsBySlideId: durationsBySlideId || {}
                        }}
                    />
                    <CustomPlayerControls
                        playerRef={playerRef}
                        fps={fps}
                        totalFrames={totalFrames || 30}
                        containerRef={containerRef}
                    />
                </div>


            </div>

        </div>
    )
}

export default CourseInfoCard