"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import {
    ArrowLeft,
    Check,
    Clock,
    Film,
    Image as ImageIcon,
    Loader2,
    Play,
    Sparkles,
    Video,
    Wand2,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { toast } from 'sonner'

// ─── Types ───────────────────────────────────────────────────────────
interface SeriesData {
    id: number
    seriesId: string
    userId: string
    niche: string
    language: string
    voice: string
    music: string
    videoStyle: string
    captionStyle: string
    title: string
    duration: string
    platform: string
    publishTime: string
    thumbnailUrl: string | null
    status: string | null
    createdAt: string
    updatedAt: string
}

interface VideoAsset {
    id: number
    videoId: string
    seriesId: string
    videoTitle: string
    scriptData: any
    audioUrl: string | null
    audioDuration: number | null
    captionData: any
    imageUrls: string[] | null
    videoUrl: string | null
    status: string | null
    createdAt: string
}

// ─── Step labels for progress bars ───────────────────────────────────
const STEP_KEYS = ['script', 'voice', 'captions', 'images', 'saving'] as const

function getActiveStepIndex(status: string | null): number {
    if (!status || !status.startsWith('generating:')) return -1
    const step = status.split(':')[1]
    return STEP_KEYS.findIndex(s => s === step)
}

function SeriesVideosPageContent() {
    const { user } = useUser()
    const params = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const seriesId = params.seriesId as string
    const shouldGenerate = searchParams.get('generate') === 'true'

    const [series, setSeries] = useState<SeriesData | null>(null)
    const [videos, setVideos] = useState<VideoAsset[]>([])
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [triggeringGeneration, setTriggeringGeneration] = useState(false)
    const hasTriggeredGenerate = useRef(false)

    // ─── Fetch series + videos ───────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(`/api/short-series/${seriesId}/videos`)
            const data = await res.json()
            if (data.success) {
                setSeries(data.series)
                setVideos(data.videos)

                const isGenerating = data.series.status?.startsWith('generating')
                setGenerating(!!isGenerating)
            }
        } catch (err) {
            console.error('Failed to fetch series data:', err)
        } finally {
            setLoading(false)
        }
    }, [seriesId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // ─── Poll while generating ───────────────────────────────────────
    useEffect(() => {
        if (!generating) return
        const interval = setInterval(fetchData, 4000)
        return () => clearInterval(interval)
    }, [generating, fetchData])

    // ─── Auto-trigger generation if ?generate=true ───────────────────
    useEffect(() => {
        if (shouldGenerate && series && !hasTriggeredGenerate.current && !generating) {
            hasTriggeredGenerate.current = true
            
            // Immediately clear the search param to prevent re-triggers on refresh/re-mount
            const newParams = new URLSearchParams(searchParams.toString())
            newParams.delete('generate')
            const query = newParams.toString()
            const cleanUrl = `/short-generator/${seriesId}${query ? '?' + query : ''}`
            router.replace(cleanUrl, { scroll: false })
            
            handleGenerate()
        }
    }, [shouldGenerate, series, generating, router, searchParams, seriesId])

    // ─── Trigger generation ──────────────────────────────────────────
    const handleGenerate = async () => {
        setTriggeringGeneration(true)
        try {
            const res = await fetch('/api/short-series/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seriesId }),
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Video generation started!')
                setGenerating(true)
                setTimeout(fetchData, 2000)
            } else {
                toast.error(data.error || 'Failed to start generation')
            }
        } catch {
            toast.error('Failed to start video generation')
        }
        setTriggeringGeneration(false)
    }

    const activeStepIndex = getActiveStepIndex(series?.status ?? null)

    // ─── Loading State ───────────────────────────────────────────────
    if (loading) {
        return (
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
                <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-xl bg-muted/60 animate-pulse" />
                    <div className="h-6 bg-muted/60 rounded-lg w-48 animate-pulse" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-2xl border border-border/40 bg-white/60 overflow-hidden animate-pulse">
                            <div className="h-44 bg-muted/60" />
                            <div className="p-4 space-y-3">
                                <div className="h-4 bg-muted/60 rounded-lg w-3/4" />
                                <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (!series) {
        return (
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6 text-center py-20">
                <h2 className="text-xl font-bold mb-2">Series not found</h2>
                <Link href="/short-generator" className="text-primary hover:underline">
                    ← Back to series
                </Link>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-8"
            >
                {/* Back + Title */}
                <div className="flex items-center gap-3 mb-4">
                    <Link
                        href="/short-generator"
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted/60 hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all border border-border/40"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold">
                            {series.title}
                        </h1>
                    </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-linear-to-r from-primary/10 to-accent/10 border border-primary/10 text-xs font-medium text-primary">
                        <Film className="w-3.5 h-3.5" />
                        {videos.length} video{videos.length !== 1 ? 's' : ''} generated
                    </div>

                    <button
                        onClick={handleGenerate}
                        disabled={generating || triggeringGeneration}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-linear-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
                    >
                        {triggeringGeneration ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Starting...
                            </>
                        ) : generating ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                Generate More
                            </>
                        )}
                    </button>
                </div>
            </motion.div>

            {/* ─── Videos Grid ─────────────────────────────────────── */}
            {videos.length === 0 && !generating && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-16"
                >
                    <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto mb-5">
                        <Video className="w-10 h-10 text-primary/50" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">No videos yet</h3>
                    <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                        Click &ldquo;Generate More&rdquo; to create your first AI-generated short video for this series
                    </p>
                    <button
                        onClick={handleGenerate}
                        disabled={triggeringGeneration}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-linear-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer disabled:opacity-70"
                    >
                        <Sparkles className="w-4 h-4" />
                        Generate First Video
                    </button>
                </motion.div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* ─── Generating Card (appears first when generating) ─── */}
                {generating && (
                    <motion.div
                        key="generating-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="relative rounded-2xl border-2 border-violet-500/30 bg-white/70 backdrop-blur-sm overflow-hidden"
                    >
                        {/* Shimmer thumbnail area */}
                        <div className="relative h-44 bg-linear-to-br from-violet-100/80 via-purple-50/60 to-indigo-100/80 overflow-hidden">
                            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                            <div className="flex flex-col items-center justify-center h-full gap-3">
                                <motion.div
                                    className="w-14 h-14 rounded-2xl bg-linear-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30"
                                    animate={{ scale: [1, 1.05, 1] }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                >
                                    <Wand2 className="w-7 h-7 text-white" />
                                </motion.div>
                                <span className="text-sm font-semibold text-violet-700">
                                    {activeStepIndex >= 0
                                        ? `${STEP_KEYS[activeStepIndex].charAt(0).toUpperCase() + STEP_KEYS[activeStepIndex].slice(1)}...`
                                        : 'Starting...'}
                                </span>
                            </div>

                            {/* Generating badge */}
                            <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm bg-violet-500/90 text-white">
                                <Loader2 className="w-3 h-3 animate-spin" /> Generating
                            </div>
                        </div>

                        {/* Info */}
                        <div className="p-4">
                            <h3 className="font-semibold text-sm leading-snug mb-2 text-muted-foreground">
                                Generating new video...
                            </h3>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground/60 mb-3">
                                <span className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Processing
                                </span>
                            </div>

                            {/* Progress bars — light up green as steps complete */}
                            <div className="flex items-center gap-1.5">
                                {STEP_KEYS.map((stepKey, i) => {
                                    const isCompleted = activeStepIndex > i
                                    const isActive = activeStepIndex === i

                                    return (
                                        <div
                                            key={stepKey}
                                            title={stepKey.charAt(0).toUpperCase() + stepKey.slice(1)}
                                            className="w-full h-1.5 rounded-full overflow-hidden bg-muted/40"
                                        >
                                            {isCompleted ? (
                                                <motion.div
                                                    className="h-full rounded-full bg-linear-to-r from-emerald-400 to-green-500"
                                                    initial={{ width: '0%' }}
                                                    animate={{ width: '100%' }}
                                                    transition={{ duration: 0.4 }}
                                                />
                                            ) : isActive ? (
                                                <motion.div
                                                    className="h-full rounded-full bg-linear-to-r from-violet-400 to-purple-500"
                                                    animate={{ width: ['30%', '70%', '30%'] }}
                                                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                                />
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ─── Completed / Existing Video Cards ─── */}
                {videos.map((video, index) => (
                    <motion.div
                        key={video.videoId}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.4 }}
                        className="group relative rounded-2xl border border-border/40 bg-white/70 backdrop-blur-sm hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300 overflow-hidden"
                    >
                        {/* Thumbnail / First scene image */}
                        <div className="relative h-44 bg-linear-to-br from-primary/20 via-accent/10 to-secondary/20 overflow-hidden">
                            {video.imageUrls && video.imageUrls.length > 0 && video.imageUrls[0] ? (
                                <Image
                                    src={video.imageUrls[0]}
                                    alt={video.videoTitle}
                                    fill
                                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full">
                                    <Film className="w-10 h-10 text-primary/30" />
                                </div>
                            )}

                            {/* Status overlay badge */}
                            <div className={`absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                                video.status === 'completed'
                                    ? 'bg-emerald-500/90 text-white'
                                    : video.status === 'failed'
                                        ? 'bg-red-500/90 text-white'
                                        : 'bg-amber-500/90 text-white'
                            }`}>
                                {video.status === 'completed' ? (
                                    <><Check className="w-3 h-3" /> Complete</>
                                ) : video.status === 'failed' ? (
                                    <>Failed</>
                                ) : (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Generating</>
                                )}
                            </div>

                            {/* Duration badge */}
                            {video.audioDuration && (
                                <div className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium">
                                    <Clock className="w-3 h-3" />
                                    {Math.round(video.audioDuration)}s
                                </div>
                            )}

                            {/* Play overlay on hover */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all duration-300">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all duration-300 shadow-xl">
                                    <Play className="w-5 h-5 text-foreground ml-0.5" />
                                </div>
                            </div>
                        </div>

                        {/* Info */}
                        <div className="p-4">
                            <h3 className="font-semibold text-sm line-clamp-2 leading-snug mb-2">
                                {video.videoTitle}
                            </h3>

                            {/* Meta */}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                                {video.scriptData?.totalScenes && (
                                    <span className="flex items-center gap-1">
                                        <Film className="w-3 h-3" />
                                        {video.scriptData.totalScenes} scenes
                                    </span>
                                )}
                                {video.imageUrls && (
                                    <span className="flex items-center gap-1">
                                        <ImageIcon className="w-3 h-3" />
                                        {video.imageUrls.filter((u: string) => u).length} images
                                    </span>
                                )}
                            </div>

                            {/* Mini completion bars */}
                            <div className="flex items-center gap-1.5">
                                {[
                                    { done: !!video.scriptData, label: 'Script' },
                                    { done: !!video.audioUrl, label: 'Voice' },
                                    { done: !!video.captionData, label: 'Captions' },
                                    { done: video.imageUrls && video.imageUrls.length > 0, label: 'Images' },
                                    { done: video.status === 'completed', label: 'Done' },
                                ].map((s, i) => (
                                    <div
                                        key={i}
                                        title={s.label}
                                        className={`w-full h-1.5 rounded-full transition-colors ${
                                            s.done ? 'bg-linear-to-r from-emerald-400 to-green-500' : 'bg-muted/40'
                                        }`}
                                    />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    )
}

function SeriesVideosPage() {
    return (
        <Suspense fallback={
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
                <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-xl bg-muted/60 animate-pulse" />
                    <div className="h-6 bg-muted/60 rounded-lg w-48 animate-pulse" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-2xl border border-border/40 bg-white/60 overflow-hidden animate-pulse">
                            <div className="h-44 bg-muted/60" />
                            <div className="p-4 space-y-3">
                                <div className="h-4 bg-muted/60 rounded-lg w-3/4" />
                                <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        }>
            <SeriesVideosPageContent />
        </Suspense>
    )
}

export default SeriesVideosPage
