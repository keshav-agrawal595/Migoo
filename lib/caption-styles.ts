// Reusable Caption Styles — used in both the form selector and Remotion compositions

export interface CaptionStyleConfig {
    id: string
    label: string
    description: string
    /** CSS/style properties for Remotion */
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    backgroundColor: string
    textStroke: string
    textShadow: string
    textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
    animation: 'pop' | 'karaoke' | 'typewriter' | 'glow' | 'bounce' | 'fade'
    highlightColor: string
    borderRadius: number
    padding: string
}

export const captionStyles: CaptionStyleConfig[] = [
    {
        id: 'bold-pop',
        label: 'Bold Pop',
        description: 'Classic bold white text with pop-in animation',
        fontFamily: "'Montserrat', sans-serif",
        fontSize: 42,
        fontWeight: 900,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: '2px #000000',
        textShadow: '3px 3px 6px rgba(0,0,0,0.8)',
        textTransform: 'uppercase',
        animation: 'pop',
        highlightColor: '#FFD700',
        borderRadius: 0,
        padding: '0',
    },
    {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'Word-by-word highlight like karaoke lyrics',
        fontFamily: "'Inter', sans-serif",
        fontSize: 38,
        fontWeight: 800,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: '1.5px #000000',
        textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
        textTransform: 'none',
        animation: 'karaoke',
        highlightColor: '#00E5FF',
        borderRadius: 0,
        padding: '0',
    },
    {
        id: 'typewriter',
        label: 'Typewriter',
        description: 'Characters appear one by one with cursor',
        fontFamily: "'Space Mono', monospace",
        fontSize: 34,
        fontWeight: 700,
        color: '#00FF88',
        backgroundColor: 'rgba(0,0,0,0.75)',
        textStroke: 'none',
        textShadow: '0 0 10px rgba(0,255,136,0.5)',
        textTransform: 'none',
        animation: 'typewriter',
        highlightColor: '#00FF88',
        borderRadius: 8,
        padding: '8px 16px',
    },
    {
        id: 'neon-glow',
        label: 'Neon Glow',
        description: 'Glowing neon text with pulsing light effect',
        fontFamily: "'Orbitron', sans-serif",
        fontSize: 36,
        fontWeight: 700,
        color: '#FF00FF',
        backgroundColor: 'transparent',
        textStroke: '1px #FF00FF',
        textShadow: '0 0 10px #FF00FF, 0 0 20px #FF00FF, 0 0 40px #FF00FF, 0 0 80px #FF00FF',
        textTransform: 'uppercase',
        animation: 'glow',
        highlightColor: '#FF00FF',
        borderRadius: 0,
        padding: '0',
    },
    {
        id: 'bounce-box',
        label: 'Bounce Box',
        description: 'Text with colored background box that bounces in',
        fontFamily: "'Poppins', sans-serif",
        fontSize: 36,
        fontWeight: 800,
        color: '#FFFFFF',
        backgroundColor: '#FF3366',
        textStroke: 'none',
        textShadow: 'none',
        textTransform: 'uppercase',
        animation: 'bounce',
        highlightColor: '#FFDD00',
        borderRadius: 12,
        padding: '10px 20px',
    },
    {
        id: 'cinematic-fade',
        label: 'Cinematic Fade',
        description: 'Elegant fade-in text with serif font',
        fontFamily: "'Playfair Display', serif",
        fontSize: 40,
        fontWeight: 700,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '2px 2px 8px rgba(0,0,0,0.9)',
        textTransform: 'none',
        animation: 'fade',
        highlightColor: '#FFD700',
        borderRadius: 0,
        padding: '0',
    },
]
