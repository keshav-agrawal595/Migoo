import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadNotoHindi } from '@remotion/google-fonts/NotoSansDevanagari';
import { loadFont as loadOrbitron } from '@remotion/google-fonts/Orbitron';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadSpaceMono } from '@remotion/google-fonts/SpaceMono';
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
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
  videoDurationSec?: number; // actual duration of the avatar video file
}

export interface CompositionProps {
  imageUrls: string[];
  sceneVideoUrls?: string[];
  sceneVideoDurations?: number[];
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
  // First half: fade TO black, second half: fade FROM black
  const opacity = frame < half
    ? interpolate(frame, [0, half], [0, 1], { extrapolateRight: 'clamp' })
    : interpolate(frame, [half, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

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
  durationInFrames: number;
  videoDurationSec?: number; // actual length of the avatar video file
}> = ({ videoUrl, audioUrl, durationInFrames, videoDurationSec }) => {
  const { fps } = useVideoConfig();

  // Remote URLs (https://) used as-is; local paths go through staticFile()
  const resolvedVideoUrl = useMemo(() => {
    // Forcefully strip any full HTTP absolute paths that point to localhost
    // and extract the correct relative file path.
    let cleanUrl = videoUrl;

    if (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')) {
      try {
        const urlObj = new URL(cleanUrl);
        cleanUrl = urlObj.pathname;
      } catch (e) {
        // Fallback if not a valid URL
      }
    }

    // Completely strip any "public/" prefix
    if (cleanUrl.startsWith('/public/')) cleanUrl = cleanUrl.replace('/public/', '');
    if (cleanUrl.startsWith('public/')) cleanUrl = cleanUrl.replace('public/', '');

    // Now if it's an avatar file, it will cleanly resolve
    if (cleanUrl.includes('avatars/avatar')) {
      const match = cleanUrl.match(/avatars\/avatar[0-9]+-(intro|outro)\.mp4/);
      if (match) return staticFile(match[0]);
    }

    // If it's still a remote HTTP url (like S3/Cloudfront), use it directly
    if (cleanUrl.startsWith('http')) {
      return cleanUrl;
    }

    // Otherwise, ensure it doesn't have a leading slash for staticFile
    const finalUrl = cleanUrl.startsWith('/') ? cleanUrl.substring(1) : cleanUrl;
    return staticFile(finalUrl);
  }, [videoUrl]);

  const resolvedAudioUrl = useMemo(() => {
    if (!audioUrl) return "";
    if (audioUrl.startsWith('http')) {
      return audioUrl;
    }
    return staticFile(audioUrl);
  }, [audioUrl]);

  // Stretch/compress the avatar video to fill the entire sequence duration.
  // Without this, Remotion crashes with "No frame found at position" when
  // the TTS audio (and thus the sequence) is longer than the video file.
  const pbRate = useMemo(() => {
    if (!videoDurationSec || !durationInFrames) return 1;
    const targetDurationSec = durationInFrames / fps;
    // ratio > 1 means speed up (video longer than sequence)
    // ratio < 1 means slow down (video shorter than sequence)
    const rate = (videoDurationSec / targetDurationSec) * 0.99; // 0.99x ensures we NEVER seek past the last frame
    // Clamp to safe range (0.25x to 4x)
    return Math.max(0.25, Math.min(4, rate));
  }, [videoDurationSec, durationInFrames, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Muted HeyGen video — lip movements visible, no original audio */}
      <OffthreadVideo
        src={resolvedVideoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted={true}
        crossOrigin="anonymous"
        playbackRate={pbRate}
        toneMapped={false}
      />
      {/* Sarvam-generated English voice audio */}
      {resolvedAudioUrl && <Audio src={resolvedAudioUrl} crossOrigin="anonymous" />}
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
        crossOrigin="anonymous"
      />
    </AbsoluteFill>
  );
};

const VideoClipScene: React.FC<{
  videoUrl: string;
  duration: number; // in frames (target sequence duration)
  sourceDuration?: number; // in seconds (actual AI video duration)
}> = ({ videoUrl, duration, sourceDuration }) => {
  const { fps } = useVideoConfig();

  // Stable useMemo prevents jittering on every frame.
  const resolvedVideoUrl = useMemo(() => {
    let cleanUrl = videoUrl;

    if (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')) {
      try {
        const urlObj = new URL(cleanUrl);
        cleanUrl = urlObj.pathname;
      } catch (e) {}
    }

    if (cleanUrl.startsWith('/public/')) cleanUrl = cleanUrl.replace('/public/', '');
    if (cleanUrl.startsWith('public/')) cleanUrl = cleanUrl.replace('public/', '');

    if (cleanUrl.startsWith('http')) {
      return cleanUrl;
    }
    const finalUrl = cleanUrl.startsWith('/') ? cleanUrl.substring(1) : cleanUrl;
    return staticFile(finalUrl);
  }, [videoUrl]);

  // Calculate playbackRate: sourceDuration (sec) / targetDuration (sec)
  const targetDurationSec = duration / fps;
  const pbRate = useMemo(() => {
    if (!sourceDuration) return 1; // Fallback to normal speed
    // 0.99x ensures we NEVER seek past the last frame of the source video
    return (sourceDuration / targetDurationSec) * 0.99;
  }, [sourceDuration, targetDurationSec]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* OffthreadVideo prevents jittering when stretching video with playbackRate */}
      <OffthreadVideo
        src={resolvedVideoUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
        muted={true}
        playbackRate={pbRate}
        crossOrigin="anonymous"
        toneMapped={false}
      />
    </AbsoluteFill>
  );
};

// ─── Captions component (only shown during content scenes) ────────────────────
const Captions: React.FC<{
  segments: CaptionSegment[];
  styleId?: string;
  language?: string;
}> = ({ segments, styleId = 'bold-pop', language = 'en-IN' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Sequence automatically resets the frame to 0 at the start of the content section
  const SYNC_OFFSET = 0.30; // seconds to offset captions (positive = earlier)
  const currentTime = (frame / fps) + SYNC_OFFSET;

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
  sceneVideoUrls,
  sceneVideoDurations,
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
  const BRIDGE_FRAMES = 30; // 1.0s crossfade at intro/outro transitions (smoother)
  const CAPTION_DELAY_FRAMES = 0; // Removed delay as requested

  const introFrames = introClip ? Math.round(introClip.durationSec * fps) : 0;
  const outroFrames = outroClip ? Math.round(outroClip.durationSec * fps) : 0;
  const contentFrames = durationInFrames - introFrames - outroFrames;
  const sceneDuration = Math.floor(contentFrames / Math.max(imageUrls?.length || 1, 1));

  // Content starts after intro
  const contentStart = introFrames;
  // Outro starts after content
  const outroStart = contentStart + contentFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* ── Background Music: runs throughout entire video ── */}
      {musicUrl && <Audio src={musicUrl} volume={0.12} loop crossOrigin="anonymous" />}

      {/* ══════════════════════════════════════════════════
          INTRO SECTION — HeyGen avatar clip (English)
      ══════════════════════════════════════════════════ */}
      {introClip && (
        <Sequence from={0} durationInFrames={introFrames}>
          <AvatarClipScene videoUrl={introClip.videoUrl} audioUrl={introClip.audioUrl} durationInFrames={introFrames} videoDurationSec={introClip.videoDurationSec} />
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
          <Audio src={audioUrl} crossOrigin="anonymous" />
        </Sequence>
      )}

      {/* AI scene clips: use video if available, fallback to static image */}
      {imageUrls?.map((url, i) => {
        const sceneVideoUrl = sceneVideoUrls?.[i];
        const isSkipMarker = !url || url === 'SKIP_T2V' || url === 'SKIP_VEO' || url === '';
        // Skip scenes with no image AND no video
        if (isSkipMarker && !sceneVideoUrl) return null;
        return (
          <Sequence
            key={i}
            from={contentStart + i * sceneDuration}
            durationInFrames={sceneDuration}
          >
            {sceneVideoUrl ? (
              <VideoClipScene 
                videoUrl={sceneVideoUrl} 
                duration={sceneDuration} 
                sourceDuration={sceneVideoDurations?.[i]}
              />
            ) : !isSkipMarker ? (
              <VideoScene imageUrl={url} duration={sceneDuration} index={i} />
            ) : (
              <AbsoluteFill style={{ backgroundColor: 'black' }} />
            )}
          </Sequence>
        );
      })}

      {/* Captions: delayed by 2 seconds to sync with audio playback */}
      {captionData?.segments && (
        <Sequence from={contentStart + CAPTION_DELAY_FRAMES} durationInFrames={contentFrames - CAPTION_DELAY_FRAMES}>
          <Captions
            segments={captionData.segments}
            styleId={captionStyle}
            language={language}
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
          <AvatarClipScene videoUrl={outroClip.videoUrl} audioUrl={outroClip.audioUrl} durationInFrames={outroFrames} videoDurationSec={outroClip.videoDurationSec} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
