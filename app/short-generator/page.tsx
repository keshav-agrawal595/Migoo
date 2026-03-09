"use client"
import { useUser } from '@clerk/nextjs'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles, Zap } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'
import { toast } from 'sonner'
import SelectCaptionStyle from './_components/SelectCaptionStyle'
import SelectMusic from './_components/SelectMusic'
import SelectNiche from './_components/SelectNiche'
import SelectVideoStyle from './_components/SelectVideoStyle'
import SelectVoice from './_components/SelectVoice'
import SeriesDetails from './_components/SeriesDetails'

const steps = [
    { id: 0, label: 'Niche', icon: '/short-generator-form-icons/niche.png' },
    { id: 1, label: 'Voice', icon: '/short-generator-form-icons/voice.png' },
    { id: 2, label: 'Music', icon: '/short-generator-form-icons/music.png' },
    { id: 3, label: 'Style', icon: '/short-generator-form-icons/style.png' },
    { id: 4, label: 'Captions', icon: '/short-generator-form-icons/caption.png' },
    { id: 5, label: 'Details', icon: '/short-generator-form-icons/details.png' },
]

function ShortGeneratorPage() {
    const { user } = useUser()
    const [currentStep, setCurrentStep] = useState(0)
    const [isGenerating, setIsGenerating] = useState(false)

    // Form state
    const [niche, setNiche] = useState('')
    const [language, setLanguage] = useState('en-IN')
    const [voice, setVoice] = useState('')
    const [music, setMusic] = useState('')
    const [videoStyle, setVideoStyle] = useState('')
    const [captionStyle, setCaptionStyle] = useState('')
    const [seriesData, setSeriesData] = useState({
        title: '',
        duration: '',
        platform: '',
        publishTime: '',
    })

    const canProceed = () => {
        switch (currentStep) {
            case 0: return !!niche && (niche.startsWith('custom:') ? niche.length > 7 : true)
            case 1: return !!language && !!voice
            case 2: return !!music
            case 3: return !!videoStyle
            case 4: return !!captionStyle
            case 5: return !!seriesData.title && !!seriesData.duration && !!seriesData.platform && !!seriesData.publishTime
            default: return false
        }
    }

    const handleNext = () => {
        if (!canProceed()) {
            toast.error('Please make a selection before continuing')
            return
        }
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1)
        }
    }

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }

    const handleGenerate = async () => {
        if (!canProceed()) {
            toast.error('Please fill in all required fields')
            return
        }

        if (!user?.primaryEmailAddress?.emailAddress) {
            toast.error('Please sign in to generate a series')
            return
        }

        setIsGenerating(true)

        try {
            const response = await fetch('/api/create-short-series', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    niche,
                    language,
                    voice,
                    music,
                    videoStyle,
                    captionStyle,
                    ...seriesData,
                    userId: user.primaryEmailAddress.emailAddress,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save series')
            }

            toast.success('Series created successfully! 🎉')
            console.log('📹 Series saved with ID:', data.seriesId)
        } catch (error: any) {
            console.error('Error creating series:', error)
            toast.error(error.message || 'Something went wrong')
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-8"
            >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/10 mb-4">
                    <Zap className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Short Video Series Creator</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-bold">
                    Create Your <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Short Series</span>
                </h1>
                <p className="text-muted-foreground mt-2">Configure your AI-generated short video series in a few steps</p>
            </motion.div>

            {/* Progress Bar */}
            <div className="mb-10">
                <div className="flex items-center justify-between max-w-3xl mx-auto">
                    {steps.map((step, index) => (
                        <div key={step.id} className="flex items-center flex-1 last:flex-initial">
                            <button
                                onClick={() => {
                                    // Allow jumping to completed steps
                                    if (index <= currentStep) setCurrentStep(index)
                                }}
                                className={`
                                    relative flex flex-col items-center gap-1 group
                                ${index <= currentStep ? 'cursor-pointer' : 'cursor-default'}
                                `}
                            >
                                <div className={`
                                    w-10 h-10 rounded-full flex items-center justify-center text-lg
                                    transition-all duration-300 border-2
                                    ${index < currentStep
                                        ? 'bg-primary border-primary text-white shadow-lg shadow-primary/25'
                                        : index === currentStep
                                            ? 'bg-gradient-to-br from-primary to-accent border-primary text-white shadow-lg shadow-primary/25 scale-110'
                                            : 'bg-white/60 border-border/50 text-muted-foreground'
                                    }
                                `}>
                                    {index < currentStep ? (
                                        <Check className="w-4 h-4" />
                                    ) : (
                                        <Image src={step.icon} alt={step.label} width={20} height={20} className="object-contain" />
                                    )}
                                </div>
                                <span className={`
                                    text-[10px] font-medium hidden sm:block
                                    ${index <= currentStep ? 'text-primary' : 'text-muted-foreground'}
                                `}>
                                    {step.label}
                                </span>
                            </button>

                            {/* Connector line */}
                            {index < steps.length - 1 && (
                                <div className="flex-1 h-0.5 mx-2 rounded-full overflow-hidden bg-border/30">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                                        initial={{ width: '0%' }}
                                        animate={{ width: index < currentStep ? '100%' : '0%' }}
                                        transition={{ duration: 0.4, ease: 'easeOut' }}
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Step Content */}
            <div className="min-h-[400px]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentStep}
                        initial={{ opacity: 0, x: 40 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -40 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                        {currentStep === 0 && <SelectNiche selected={niche} onSelect={setNiche} />}
                        {currentStep === 1 && (
                            <SelectVoice
                                selectedLanguage={language}
                                selectedVoice={voice}
                                onSelectLanguage={setLanguage}
                                onSelectVoice={setVoice}
                            />
                        )}
                        {currentStep === 2 && <SelectMusic selected={music} onSelect={setMusic} />}
                        {currentStep === 3 && <SelectVideoStyle selected={videoStyle} onSelect={setVideoStyle} />}
                        {currentStep === 4 && <SelectCaptionStyle selected={captionStyle} onSelect={setCaptionStyle} />}
                        {currentStep === 5 && <SeriesDetails data={seriesData} onChange={setSeriesData} />}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/30">
                <button
                    onClick={handleBack}
                    disabled={currentStep === 0}
                    className={`
                        flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                        transition-all duration-200
                        ${currentStep === 0
                            ? 'text-muted-foreground/40 cursor-not-allowed'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer'
                        }
                    `}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>

                {currentStep < steps.length - 1 ? (
                    <button
                        onClick={handleNext}
                        disabled={!canProceed()}
                        className={`
                            flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold
                            transition-all duration-200
                            ${canProceed()
                                ? 'bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] cursor-pointer'
                                : 'bg-muted text-muted-foreground cursor-not-allowed'
                            }
                        `}
                    >
                        Next Step
                        <ArrowRight className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        onClick={handleGenerate}
                        disabled={!canProceed() || isGenerating}
                        className={`
                            flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold
                            transition-all duration-200
                            ${canProceed() && !isGenerating
                                ? 'bg-gradient-to-r from-primary/80 to-accent/80 text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] cursor-pointer'
                                : 'bg-muted text-muted-foreground cursor-not-allowed'
                            }
                        `}
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                Generate Series
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}

export default ShortGeneratorPage
