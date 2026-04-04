"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import { ArrowRight, BookOpen, Brain, Clapperboard, Film, Layers, Mic2, Music, Sparkles, Wand2, Zap } from 'lucide-react'
import Link from 'next/link'
const features = [
    { icon: BookOpen,    label: "Document Source",       desc: "Upload PDFs, ZIPs, or Images",    color: "from-amber-400 to-orange-400" },
    { icon: Film,        label: "Scene Asset Manager",   desc: "Inject your photos & clips",     color: "from-pink-400 to-rose-400"   },
    { icon: Brain,       label: "Human Touch Score",     desc: "Gamified script editor",          color: "from-primary to-accent"      },
    { icon: Mic2,        label: "Voice & Captions",      desc: "Hormozi-style dynamic captions", color: "from-cyan-400 to-blue-400"   },
    { icon: Music,       label: "Music & SFX",           desc: "Smart sound design per scene",   color: "from-emerald-400 to-green-400"},
    { icon: Layers,      label: "Mixed Media",           desc: "Generated video + your footage", color: "from-secondary to-pink-400"  },
]
export default function StudioPage() {
    const { user } = useUser()

    return (
        <div className="relative min-h-screen bg-muted/20">
            <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 pb-16">

                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    className="text-center mb-12"
                >
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-border mb-5 shadow-sm">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">Migoo Studio</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 leading-tight text-foreground">
                        You're the{" "}
                        <span className="text-primary border-b border-primary/30">
                            Director.
                        </span>
                    </h1>
                    <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                        The platform operates as your production crew. You fully control the script, assets, and styling.
                        Platforms reward{" "}
                        <span className="text-foreground font-semibold">human-touched content</span> — this is how you win.
                    </p>
                </motion.div>

                {/* Path cards */}
                <div className="grid md:grid-cols-2 gap-5 mb-12">
                    {/* AI Auto-Pilot */}
                    <motion.div
                        initial={{ opacity: 0, x: -24, scale: 0.97 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ delay: 0.15, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    >
                        <Link href="/short-generator" className="group block h-full">
                            <div className="relative h-full rounded-2xl border border-border/50 bg-white/70 backdrop-blur-sm p-7 hover:border-border hover:shadow-lg hover:shadow-black/5 transition-all duration-300 overflow-hidden">
                                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 shadow-sm">
                                    <Zap className="w-6 h-6 text-muted-foreground" />
                                </div>
                                <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-muted border border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                    Quick Mode
                                </div>
                                <h2 className="text-xl font-bold text-foreground mb-2">Smart Auto-Pilot</h2>
                                <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                                    The platform picks the topic, writes the script, and sources the visuals.
                                    1-click generation for your recurring niche series.
                                </p>
                                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                    Go to Series <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </Link>
                    </motion.div>

                    {/* Director's Chair */}
                    <motion.div
                        initial={{ opacity: 0, x: 24, scale: 0.97 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ delay: 0.22, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    >
                        <Link href="/studio/create" className="group block h-full">
                            <div className="relative h-full rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/8 via-accent/5 to-secondary/5 p-7 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/8 transition-all duration-300 overflow-hidden">
                                {/* Subtle glow on hover */}
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none blur-2xl" />
                                <div className="relative z-10">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 shadow-lg shadow-primary/20">
                                        <Clapperboard className="w-6 h-6 text-white" />
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary uppercase tracking-wider mb-3">
                                        ⭐ Migoo Studio
                                    </div>
                                    <h2 className="text-xl font-bold text-foreground mb-2">Full Creative Studio</h2>
                                    <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                                        Upload PDFs, inject your own footage, edit every script line.
                                        Human-touched content that{" "}
                                        <span className="text-primary font-semibold">survives demonetization.</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 text-sm font-semibold text-primary group-hover:text-primary/80 transition-colors">
                                        Open Studio <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </motion.div>
                </div>

                {/* Features grid */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                >
                    <p className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-5">
                        What makes Migoo Studio different
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {features.map((f, i) => (
                            <motion.div
                                key={f.label}
                                initial={{ opacity: 0, scale: 0.92 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.45 + i * 0.06, duration: 0.35 }}
                                className="flex items-center gap-3 p-4 rounded-xl bg-white/70 border border-border/40 hover:border-border hover:shadow-sm transition-all duration-200"
                            >
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shrink-0 shadow-sm`}>
                                    <f.icon className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-foreground">{f.label}</p>
                                    <p className="text-[11px] text-muted-foreground leading-tight">{f.desc}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>

                {/* Bottom CTA */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.9, duration: 0.5 }}
                    className="text-center mt-12"
                >
                    <Link
                        href="/studio/create"
                        className="inline-flex items-center gap-3 px-7 py-3.5 rounded-xl bg-primary text-white font-semibold text-base hover:bg-primary/90 transition-all duration-200"
                    >
                        <Wand2 className="w-5 h-5" />
                        Enter Migoo Studio
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <p className="text-xs text-muted-foreground mt-3">
                        No credit card required · Uses your existing series
                    </p>
                </motion.div>
            </div>
        </div>
    )
}
