import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Video,
  staticFile,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadSpaceMono } from '@remotion/google-fonts/SpaceMono';
import { loadFont as loadOrbitron } from '@remotion/google-fonts/Orbitron';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadNotoHindi } from '@remotion/google-fonts/NotoSansDevanagari';
import { captionStyles } from '../lib/caption-styles';

// Preload fonts
loadFont('normal', { weights: ['900'] });
loadInter('normal', { weights: ['800'] });
loadSpaceMono('normal', { weights: ['700'] });
loadOrbitron('normal', { weights: ['700'] });
loadPoppins('normal', { weights: ['800'] });
loadPlayfair('normal', { weights: ['700'] });
loadNotoHindi('normal', { weights: ['700'] });

export interface CaptionSegment {
  text: string;
  start: number; // in seconds
  end: number;   // in seconds
}

export interface AvatarClipProps {
  videoUrl: string;
  audioUrl: string;
  durationSec: number;
}

export interface CompositionProps {
  imageUrls: string[];
  introClip?: AvatarClipProps;
  outroClip?: AvatarClipProps;
  audioUrl: string;
  audioDuration?: number;
  musicUrl?: string;
  captionData: {
    segments: CaptionSegment[];
  };
  captionStyle?: string;
  language?: string;
  durationInFrames: number;
}

// ─── Crossfade overlay: fades in then out to create a smooth bridge ───────────
const CrossfadeBridge: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const half = durationInFrames / 2;
  // Fade in during first half, fade out during second half
  const opacity = frame < half
    ? interpolate(frame, [0, half], [1, 0], { extrapolateRight: 'clamp' })
    : interpolate(frame, [half, durationInFrames], [0, 1], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'black',
        opacity,
        zIndex: 20,
      }}
    />
  );
};

// ─── HeyGen Avatar clip scene (video muted, custom TTS audio plays) ────────────
const AvatarClipScene: React.FC<{
  videoUrl: string;
  audioUrl: string;
}> = ({ videoUrl, audioUrl }) => {
  // Remote URLs (https://) used as-is; local paths go through staticFile()
  // so Remotion's bundler can serve them from public/
  const resolvedVideoUrl = videoUrl.startsWith('http') ? videoUrl : staticFile(videoUrl);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Muted HeyGen video — lip movements visible, no original audio */}
      <Video
        src={resolvedVideoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted={true}
      />
      {/* Sarvam-generated English voice audio */}
      {audioUrl && <Audio src={audioUrl} />}
    </AbsoluteFill>
  );
};

// ─── AI-generated image scene with ken-burns animation ───────────────────────
const VideoScene: React.FC<{
  imageUrl: string;
  duration: number;
  index: number;
}> = ({ imageUrl, duration, index }) => {
  const frame = useCurrentFrame();
  const animationType = index % 3;
  let animationStyle: React.CSSProperties = {};

  if (animationType === 0) {
    const scale = interpolate(frame, [0, duration], [1, 1.1], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `scale(${scale})` };
  } else if (animationType === 1) {
    const translateY = interpolate(frame, [0, duration], [0, -30], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.05)` };
  } else {
    const translateY = interpolate(frame, [0, duration], [-30, 0], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.05)` };
  }

  return (
    <AbsoluteFill>
      <Img
        src={imageUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...animationStyle,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Captions component (only shown during content scenes) ────────────────────
const Captions: React.FC<{
  segments: CaptionSegment[];
  styleId?: string;
  language?: string;
  offsetSec?: number; // seconds to subtract from current time (intro offset)
}> = ({ segments, styleId = 'bold-pop', language = 'en-IN', offsetSec = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps - offsetSec;

  const style = useMemo(() =>
    captionStyles.find(s => s.id === styleId) || captionStyles[0],
    [styleId]
  );

  const activeSegment = segments.find(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  if (!activeSegment || currentTime < 0) return null;

  let animatedStyle: React.CSSProperties = {
    fontFamily: language === 'hi-IN' ? "'Noto Sans Devanagari', sans-serif" : style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    padding: style.padding,
    borderRadius: style.borderRadius,
    textTransform: style.textTransform as any,
    textAlign: 'center',
    lineHeight: 1.2,
  };

  if (style.backgroundColor !== 'transparent') animatedStyle.backgroundColor = style.backgroundColor;
  if (style.textShadow !== 'none') animatedStyle.textShadow = style.textShadow;
  if (style.textStroke !== 'none') (animatedStyle as any).WebkitTextStroke = style.textStroke;

  if (style.animation === 'pop') {
    const springValue = interpolate(currentTime - activeSegment.start, [0, 0.1, 0.2], [0.8, 1.1, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    animatedStyle.transform = `scale(${springValue})`;
  } else if (style.animation === 'glow') {
    const glow = interpolate(Math.sin(frame / 5), [-1, 1], [0.8, 1.2], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    animatedStyle.opacity = glow;
  } else if (style.animation === 'bounce') {
    const bounce = interpolate(currentTime - activeSegment.start, [0, 0.15, 0.3], [50, -10, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    animatedStyle.transform = `translateY(${bounce}px)`;
  } else if (style.animation === 'fade') {
    const opacity = interpolate(currentTime - activeSegment.start, [0, 0.3], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    animatedStyle.opacity = opacity;
  }

  const renderText = () => {
    if (style.animation === 'karaoke') {
      const words = activeSegment.text.split(' ');
      const totalDuration = activeSegment.end - activeSegment.start;
      const timePerWord = totalDuration / words.length;
      const activeWordIndex = Math.floor((currentTime - activeSegment.start) / timePerWord);
      return words.map((word, i) => (
        <span key={i} style={{ color: i <= activeWordIndex ? style.highlightColor : style.color, transition: 'color 0.1s ease' }}>
          {word}{' '}
        </span>
      ));
    }
    if (style.animation === 'typewriter') {
      const chars = activeSegment.text.length;
      const totalDuration = activeSegment.end - activeSegment.start;
      const charIndex = Math.floor(interpolate(currentTime - activeSegment.start, [0, totalDuration * 0.8], [0, chars], { extrapolateRight: 'clamp' }));
      return activeSegment.text.slice(0, charIndex);
    }
    return activeSegment.text;
  };

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '15%', paddingLeft: '40px', paddingRight: '40px', zIndex: 10 }}>
      <div style={{ ...animatedStyle, fontSize: (style.fontSize as number) * 1.2, display: 'inline-block', textShadow: '0 0 10px rgba(0,0,0,0.8), 2px 2px 5px rgba(0,0,0,1)' }}>
        {renderText()}
      </div>
    </AbsoluteFill>
  );
};

// ─── Main Composition ─────────────────────────────────────────────────────────
export const MainComposition: React.FC<CompositionProps> = ({
  imageUrls,
  introClip,
  outroClip,
  audioUrl,
  audioDuration,
  musicUrl,
  captionData,
  captionStyle,
  language,
}) => {
  const { durationInFrames, fps } = useVideoConfig();

  // ── Timeline math ─────────────────────────────────────────────────────────
  const BRIDGE_FRAMES = 15; // 0.5s crossfade at transitions

  const introFrames = introClip ? Math.round(introClip.durationSec * fps) : 0;
  const outroFrames = outroClip ? Math.round(outroClip.durationSec * fps) : 0;
  const contentFrames = durationInFrames - introFrames - outroFrames;
  const sceneDuration = Math.floor(contentFrames / Math.max(imageUrls?.length || 1, 1));

  // Content starts after intro
  const contentStart = introFrames;
  // Outro starts after content
  const outroStart = contentStart + contentFrames;

  // ── Caption offset: captions are timed relative to narration audio (0-based)
  // but they play during content section which starts at contentStart in the timeline
  const captionOffsetSec = introClip ? introClip.durationSec : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* ── Background Music: runs throughout entire video ── */}
      {musicUrl && <Audio src={musicUrl} volume={0.12} loop />}

      {/* ══════════════════════════════════════════════════
          INTRO SECTION — HeyGen avatar clip (English)
      ══════════════════════════════════════════════════ */}
      {introClip && (
        <Sequence from={0} durationInFrames={introFrames}>
          <AvatarClipScene videoUrl={introClip.videoUrl} audioUrl={introClip.audioUrl} />
        </Sequence>
      )}

      {/* Crossfade bridge: Intro → Content */}
      {introClip && (
        <Sequence from={introFrames - BRIDGE_FRAMES} durationInFrames={BRIDGE_FRAMES * 2}>
          <CrossfadeBridge durationInFrames={BRIDGE_FRAMES * 2} />
        </Sequence>
      )}

      {/* ══════════════════════════════════════════════════
          CONTENT SECTION — 6 AI-image scenes (selected language narration)
      ══════════════════════════════════════════════════ */}

      {/* Main narration audio: starts at contentStart, plays for audioDuration */}
      {audioUrl && (
        <Sequence from={contentStart} durationInFrames={contentFrames}>
          <Audio src={audioUrl} />
        </Sequence>
      )}

      {/* AI image scenes */}
      {imageUrls?.filter(url => url).map((url, i) => (
        <Sequence
          key={i}
          from={contentStart + i * sceneDuration}
          durationInFrames={sceneDuration}
        >
          <VideoScene imageUrl={url} duration={sceneDuration} index={i} />
        </Sequence>
      ))}

      {/* Captions: only during content section, timestamps offset by intro duration */}
      {captionData?.segments && (
        <Sequence from={contentStart} durationInFrames={contentFrames}>
          <Captions
            segments={captionData.segments}
            styleId={captionStyle}
            language={language}
            offsetSec={captionOffsetSec}
          />
        </Sequence>
      )}

      {/* Crossfade bridge: Content → Outro */}
      {outroClip && (
        <Sequence from={outroStart - BRIDGE_FRAMES} durationInFrames={BRIDGE_FRAMES * 2}>
          <CrossfadeBridge durationInFrames={BRIDGE_FRAMES * 2} />
        </Sequence>
      )}

      {/* ══════════════════════════════════════════════════
          OUTRO SECTION — HeyGen avatar clip (English)
      ══════════════════════════════════════════════════ */}
      {outroClip && (
        <Sequence from={outroStart} durationInFrames={outroFrames}>
          <AvatarClipScene videoUrl={outroClip.videoUrl} audioUrl={outroClip.audioUrl} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
