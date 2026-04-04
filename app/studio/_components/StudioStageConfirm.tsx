"use client"
import { motion } from 'framer-motion'
import { Bot, Check, Clapperboard, Clock, Film, Globe, Loader2, Mic2, Music, PenLine, Rocket, Sparkles } from 'lucide-react'

type AssetType = "ai" | "user_upload" | "doc_image"

interface Scene {
    narration: string
    imagePrompt: string
    videoPrompt: string
    sceneCategory: string
    duration: number
    wordCount: number
    sceneNumber: number
}

interface Props {
    topic: string
    scriptData: { videoTitle: string; scenes: Scene[] } | null
    sceneAssetTypes: AssetType[]
    voice: string
    captionStyle: string
    music: string
    language: string
    contextMarkdown: string
    isLaunching: boolean
    onLaunch: () => void
}

export default function StudioStageConfirm({ topic, scriptData, sceneAssetTypes, voice, captionStyle, music, language, contextMarkdown, isLaunching, onLaunch }: Props) {
    if (!scriptData) return null

    const totalWords   = scriptData.scenes.reduce((s, sc) => s + (sc.narration?.split(/\s+/).filter(Boolean).length || 0), 0)
    const estimatedSec = Math.round(totalWords / 2.5)
    const mins = Math.floor(estimatedSec / 60)
    const secs = estimatedSec % 60

    const userUploadCount = sceneAssetTypes.filter(t => t === "user_upload").length
    const docImageCount   = sceneAssetTypes.filter(t => t === "doc_image").length
    const aiCount         = sceneAssetTypes.filter(t => t === "ai").length
    const renderMins      = Math.ceil((scriptData.scenes.length * 2.5) + 3)

    const checks = [
        { label: "Script ready",                    icon: <PenLine className="w-3.5 h-3.5" />    },
        { label: `${scriptData.scenes.length} scenes`,          icon: <Film className="w-3.5 h-3.5" />      },
        { label: `Voice: ${voice}`,                  icon: <Mic2 className="w-3.5 h-3.5" />       },
        { label: `Music: ${music}`,                  icon: <Music className="w-3.5 h-3.5" />      },
        { label: `Language: ${language}`,            icon: <Globe className="w-3.5 h-3.5" />      },
        { label: `Captions: ${captionStyle}`,        icon: <Sparkles className="w-3.5 h-3.5" />   },
        ...(contextMarkdown ? [{ label: "Document context loaded", icon: <Check className="w-3.5 h-3.5" /> }] : []),
    ]

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-5"
        >
            <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Ready to Launch 🚀</h2>
                <p className="text-sm text-muted-foreground">Review your production summary, then hit launch</p>
            </div>

            {/* Title card */}
            <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/8 to-accent/5 p-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 shadow-md shadow-primary/20">
                        <Clapperboard className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-primary/60 uppercase tracking-wider mb-0.5">Video Title</p>
                        <h3 className="text-base font-bold text-foreground leading-snug">{scriptData.videoTitle}</h3>
                        {topic && topic !== scriptData.videoTitle && (
                            <p className="text-xs text-muted-foreground mt-1">Topic: {topic.slice(0, 80)}</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                <StatCard
                    label="Duration" value={`~${mins}:${secs.toString().padStart(2, '0')}`}
                    sub={`${totalWords} words`} color="from-blue-500 to-cyan-500"
                    icon={<Clock className="w-4 h-4" />}
                />
                <StatCard
                    label="Auto Scenes" value={String(aiCount)}
                    sub="Generated video" color="from-primary to-accent"
                    icon={<Bot className="w-4 h-4" />}
                />
                <StatCard
                    label="Your Media" value={String(userUploadCount + docImageCount)}
                    sub={docImageCount > 0 ? `${docImageCount} charts` : "footage"}
                    color="from-emerald-500 to-green-500"
                    icon={<Film className="w-4 h-4" />}
                />
            </div>

            {/* Checklist */}
            <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-2">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Production Checklist</p>
                {checks.map((c, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-2.5"
                    >
                        <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3" strokeWidth={3} />
                        </div>
                        <span className="text-xs text-foreground/70">{c.label}</span>
                    </motion.div>
                ))}
            </div>

            {/* Render estimate */}
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700">
                    Estimated render time:{" "}
                    <span className="font-semibold">{renderMins}–{renderMins + 5} minutes</span>
                    {" "}· Navigate away freely while it renders
                </p>
            </div>

            {/* Launch button */}
            <motion.button
                onClick={onLaunch}
                disabled={isLaunching}
                whileHover={isLaunching ? {} : { scale: 1.015 }}
                whileTap={isLaunching ? {} : { scale: 0.985 }}
                className={`w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-base transition-all duration-300 cursor-pointer ${
                    isLaunching
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-gradient-to-r from-primary to-accent text-white shadow-xl shadow-primary/20 hover:shadow-primary/30'
                }`}
            >
                {isLaunching ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Launching production…</>
                ) : (
                    <><Rocket className="w-5 h-5" /> Launch Production 🚀</>
                )}
            </motion.button>

            <p className="text-center text-xs text-muted-foreground">
                After launching, you'll be taken to the series page to watch generation progress
            </p>
        </motion.div>
    )
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border/40 bg-white/70 p-3 text-center">
            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mx-auto mb-2 shadow-sm text-white`}>
                {icon}
            </div>
            <p className="text-lg font-bold text-foreground">{value}</p>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            <p className="text-[9px] text-muted-foreground/70 mt-0.5">{sub}</p>
        </div>
    )
}
