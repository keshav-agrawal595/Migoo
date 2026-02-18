import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course } from '@/type/CourseType';
import { getAudioData } from '@remotion/media-utils';
import { Player, PlayerRef } from '@remotion/player';
import { Dot, Maximize, Minimize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CourseComposition } from './ChapterVideo';

type Props = {
    course: Course | undefined;
}

// Format time as HH:MM:SS if >= 60 min, else MM:SS
export function formatTime(totalSeconds: number): string {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    if (hrs > 0) {
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

// Custom controls overlay for the Remotion Player
export function CustomPlayerControls({
    playerRef,
    fps,
    totalFrames,
    containerRef,
}: {
    playerRef: React.RefObject<PlayerRef | null>;
    fps: number;
    totalFrames: number;
    containerRef?: React.RefObject<HTMLDivElement | null>;
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onFrameUpdate = (e: { detail: { frame: number } }) => {
            setCurrentFrame(e.detail.frame);
        };
        const onEnded = () => setIsPlaying(false);

        player.addEventListener('play', onPlay);
        player.addEventListener('pause', onPause);
        player.addEventListener('frameupdate', onFrameUpdate as any);
        player.addEventListener('ended', onEnded);

        return () => {
            player.removeEventListener('play', onPlay);
            player.removeEventListener('pause', onPause);
            player.removeEventListener('frameupdate', onFrameUpdate as any);
            player.removeEventListener('ended', onEnded);
        };
    }, [playerRef]);

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const togglePlay = useCallback(() => {
        const player = playerRef.current;
        if (!player) return;
        if (isPlaying) {
            player.pause();
        } else {
            player.play();
        }
    }, [playerRef, isPlaying]);

    const skip = useCallback((seconds: number) => {
        const player = playerRef.current;
        if (!player) return;
        const framesToSkip = Math.round(seconds * fps);
        const newFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + framesToSkip));
        player.seekTo(newFrame);
    }, [playerRef, fps, totalFrames, currentFrame]);

    const toggleFullscreen = useCallback(() => {
        const el = containerRef?.current;
        if (!el) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            el.requestFullscreen();
        }
    }, [containerRef]);

    const currentTime = currentFrame / fps;
    const totalTime = totalFrames / fps;
    const progress = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;

    const btnStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        padding: '2px',
        display: 'flex',
        alignItems: 'center',
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: 'rgba(0,0,0,0.85)',
            borderRadius: '0 0 8px 8px',
        }}>
            {/* Skip Back 5s */}
            <button onClick={() => skip(-5)} title="Skip back 5 seconds" style={btnStyle}>
                <SkipBack size={14} />
            </button>

            {/* Play/Pause */}
            <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} style={btnStyle}>
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>

            {/* Skip Forward 5s */}
            <button onClick={() => skip(5)} title="Skip forward 5 seconds" style={btnStyle}>
                <SkipForward size={14} />
            </button>

            {/* Progress bar */}
            <div
                style={{
                    flex: 1,
                    height: '4px',
                    background: 'rgba(255,255,255,0.3)',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    position: 'relative',
                }}
                onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    const frame = Math.round(pct * totalFrames);
                    playerRef.current?.seekTo(Math.max(0, Math.min(totalFrames - 1, frame)));
                }}
            >
                <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: '#3b82f6',
                    borderRadius: '2px',
                    transition: 'width 0.1s',
                }} />
            </div>

            {/* Time label */}
            <span style={{
                color: 'white',
                fontSize: '11px',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
            }}>
                {formatTime(currentTime)} / {formatTime(totalTime)}
            </span>

            {/* Fullscreen toggle */}
            {containerRef && (
                <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} style={btnStyle}>
                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                </button>
            )}
        </div>
    );
}

function CourseChapters({ course }: Props) {
    const fps = 30;
    const [durationsByChapterId, setDurationsByChapterId] = useState<Record<string, {
        slidesDurations: Record<string, number>;
        totalFrames: number;
    }> | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Store refs for each chapter's player and container
    const playerRefs = useRef<Record<string, React.RefObject<PlayerRef | null>>>({});
    const containerRefs = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({});

    // Track fullscreen state globally
    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

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
                            slidesDurations[slide.slideId] = 30;
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

    // Get or create refs for a chapter
    const getPlayerRef = (chapterId: string) => {
        if (!playerRefs.current[chapterId]) {
            playerRefs.current[chapterId] = { current: null };
        }
        return playerRefs.current[chapterId];
    };
    const getContainerRef = (chapterId: string) => {
        if (!containerRefs.current[chapterId]) {
            containerRefs.current[chapterId] = { current: null };
        }
        return containerRefs.current[chapterId];
    };

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
                    const pRef = getPlayerRef(chapter.chapterId);
                    const cRef = getContainerRef(chapter.chapterId);
                    const totalFrames = chapterDurations?.totalFrames || 30;

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
                                        {chapter.subContent.map((content, idx) => (
                                            <div key={idx} className='flex gap-2 items-center mt-2'>
                                                <Dot className='h-5 w-5 text-primary' />
                                                <h2>{content}</h2>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Player + controls wrapper for fullscreen */}
                                    <div ref={cRef} style={{
                                        background: '#000',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        ...(isFullscreen ? { height: '100%', width: '100%' } : {}),
                                    }}>
                                        <Player
                                            ref={pRef}
                                            component={CourseComposition}
                                            durationInFrames={totalFrames}
                                            compositionWidth={1280}
                                            compositionHeight={720}
                                            fps={fps}
                                            style={{
                                                width: '100%',
                                                borderRadius: isFullscreen ? '0' : '8px 8px 0 0',
                                                ...(isFullscreen
                                                    ? { flex: 1, height: 'auto' }
                                                    : { height: '180px' }),
                                            }}
                                            inputProps={{
                                                slides: chapterSlides.map(slide => ({
                                                    slideId: slide.slideId,
                                                    html: slide.html,
                                                    audioFileUrl: slide.audioUrl,
                                                    revealData: slide.revealData,
                                                    caption: slide.captions
                                                })),
                                                durationsBySlideId: chapterDurations?.slidesDurations || {}
                                            }}
                                        />
                                        <CustomPlayerControls
                                            playerRef={pRef}
                                            fps={fps}
                                            totalFrames={totalFrames}
                                            containerRef={cRef}
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