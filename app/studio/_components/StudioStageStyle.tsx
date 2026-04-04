"use client"
import { motion } from 'framer-motion'
import { Check, Globe, Mic2, Music, Subtitles } from 'lucide-react'

const VOICES = [
    { id: "meera",    label: "Meera",    lang: "en-IN", desc: "Warm & conversational" },
    { id: "pavithra", label: "Pavithra", lang: "en-IN", desc: "Clear & professional"  },
    { id: "maitreyi", label: "Maitreyi", lang: "en-IN", desc: "Energetic & youthful"  },
    { id: "kabir",    label: "Kabir",    lang: "en-IN", desc: "Deep & authoritative"  },
    { id: "arvind",   label: "Arvind",   lang: "en-IN", desc: "Calm storyteller"      },
    { id: "amol",     label: "Amol",     lang: "en-IN", desc: "Bold presenter"        },
    { id: "diya",     label: "Diya",     lang: "hi-IN", desc: "हिन्दी · Expressive"  },
    { id: "neel",     label: "Neel",     lang: "hi-IN", desc: "हिन्दी · Steady"      },
]

const CAPTION_STYLES = [
    { id: "hormozi", label: "Hormozi", desc: "Bold yellow, word-by-word pop",  accent: "bg-amber-400" },
    { id: "minimal", label: "Minimal", desc: "Clean white, gentle fade",       accent: "bg-slate-400" },
    { id: "karaoke", label: "Karaoke", desc: "Highlighted word as spoken",     accent: "bg-cyan-400"  },
    { id: "boxed",   label: "Boxed",   desc: "Dark bg, high contrast",         accent: "bg-slate-700" },
]

const MUSIC_GENRES = [
    { id: "cinematic", label: "Cinematic", emoji: "🎬" },
    { id: "lofi",      label: "Lo-Fi",     emoji: "☕" },
    { id: "epic",      label: "Epic",      emoji: "⚡" },
    { id: "ambient",   label: "Ambient",   emoji: "🌊" },
    { id: "upbeat",    label: "Upbeat",    emoji: "🔥" },
    { id: "none",      label: "No Music",  emoji: "🔇" },
]

const LANGUAGES = [
    { code: "en-IN", label: "English",  flag: "🇮🇳" },
    { code: "hi-IN", label: "हिन्दी",   flag: "🇮🇳" },
    { code: "bn-IN", label: "বাংলা",    flag: "🇮🇳" },
    { code: "ta-IN", label: "தமிழ்",   flag: "🇮🇳" },
    { code: "te-IN", label: "తెలుగు",  flag: "🇮🇳" },
    { code: "mr-IN", label: "मराठी",   flag: "🇮🇳" },
    { code: "gu-IN", label: "ગુજરાતી", flag: "🇮🇳" },
    { code: "kn-IN", label: "ಕನ್ನಡ",   flag: "🇮🇳" },
]

interface Props {
    voice: string; setVoice: (v: string) => void
    captionStyle: string; setCaptionStyle: (v: string) => void
    music: string; setMusic: (v: string) => void
    language: string; setLanguage: (v: string) => void
}

export default function StudioStageStyle({ voice, setVoice, captionStyle, setCaptionStyle, music, setMusic, language, setLanguage }: Props) {
    const visibleVoices = VOICES.filter(v => language.startsWith("hi") ? v.lang === "hi-IN" : v.lang === "en-IN")

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-7"
        >
            <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Style & Output</h2>
                <p className="text-sm text-muted-foreground">Choose how your video sounds and looks</p>
            </div>

            {/* Language */}
            <Section icon={<Globe className="w-4 h-4 text-cyan-500" />} title="Output Language">
                <div className="grid grid-cols-4 gap-2">
                    {LANGUAGES.map(lang => (
                        <button
                            key={lang.code}
                            onClick={() => setLanguage(lang.code)}
                            className={`relative flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                language === lang.code
                                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700 shadow-sm'
                                    : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70'
                            }`}
                        >
                            <span className="text-base">{lang.flag}</span>
                            <span className="leading-tight text-center">{lang.label}</span>
                            {language === lang.code && (
                                <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-cyan-500 flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Voice */}
            <Section icon={<Mic2 className="w-4 h-4 text-primary" />} title="Narrator Voice">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {visibleVoices.map(v => (
                        <button
                            key={v.id}
                            onClick={() => setVoice(v.id)}
                            className={`relative flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                                voice === v.id
                                    ? 'bg-primary/8 border-primary/30 shadow-sm'
                                    : 'bg-muted/40 border-border/50 hover:bg-muted/70'
                            }`}
                        >
                            <span className={`text-xs font-bold ${voice === v.id ? 'text-primary' : 'text-foreground'}`}>{v.label}</span>
                            <span className="text-[10px] text-muted-foreground leading-snug">{v.desc}</span>
                            {voice === v.id && (
                                <div className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Caption style */}
            <Section icon={<Subtitles className="w-4 h-4 text-pink-500" />} title="Caption Style">
                <div className="grid grid-cols-2 gap-2">
                    {CAPTION_STYLES.map(cs => (
                        <button
                            key={cs.id}
                            onClick={() => setCaptionStyle(cs.id)}
                            className={`relative flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all cursor-pointer ${
                                captionStyle === cs.id
                                    ? 'bg-pink-50 border-pink-200 shadow-sm'
                                    : 'bg-muted/40 border-border/50 hover:bg-muted/70'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded-md ${cs.accent} shrink-0 shadow-sm`} />
                            <div className="text-left min-w-0">
                                <p className={`text-xs font-bold ${captionStyle === cs.id ? 'text-pink-700' : 'text-foreground'}`}>{cs.label}</p>
                                <p className="text-[10px] text-muted-foreground leading-tight truncate">{cs.desc}</p>
                            </div>
                            {captionStyle === cs.id && (
                                <div className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-pink-500 flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </Section>

            {/* Music */}
            <Section icon={<Music className="w-4 h-4 text-emerald-500" />} title="Background Music">
                <div className="grid grid-cols-3 gap-2">
                    {MUSIC_GENRES.map(mg => (
                        <button
                            key={mg.id}
                            onClick={() => setMusic(mg.id)}
                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                music === mg.id
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm'
                                    : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70'
                            }`}
                        >
                            <span>{mg.emoji}</span>
                            {mg.label}
                            {music === mg.id && (
                                <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </Section>
        </motion.div>
    )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {icon}
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
            </div>
            {children}
        </div>
    )
}
