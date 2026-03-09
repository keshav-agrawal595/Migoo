"use client"
import { usePathname } from 'next/navigation'

function GradientBackground() {
    const pathname = usePathname()

    // Hide gradient on course detail pages
    const isCourseDetailPage = /^\/course\/[^/]+/.test(pathname)
    const isAuthPage = pathname === '/sign-in' || pathname === '/sign-up'

    if (isCourseDetailPage || isAuthPage) return null

    return (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
            <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] bg-purple-400/30 blur-[120px] rounded-full animate-pulse-slow" />
            <div className="absolute top-20 left-1/3 h-[500px] w-[500px] bg-pink-400/30 blur-[120px] rounded-full animate-pulse-slow animation-delay-1000" />
            <div className="absolute bottom-[-200px] left-1/3 h-[500px] w-[500px] bg-blue-400/30 blur-[120px] rounded-full animate-pulse-slow animation-delay-2000" />
            <div className="absolute top-[-200px] left-1/2 h-[500px] w-[500px] bg-sky-400/30 blur-[120px] rounded-full animate-pulse-slow animation-delay-4000" />
        </div>
    )
}

export default GradientBackground
