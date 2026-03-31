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

  const resolvedVideoUrl = useMemo(() => resolveLocalUrl(videoUrl) || "", [videoUrl]);
  const resolvedAudioUrl = useMemo(() => resolveLocalUrl(audioUrl) || "", [audioUrl]);

  // Stretch/compress the avatar video to fill the entire sequence duration.
  // Without this, Remotion crashes with "No frame found at position" when
  // the TTS audio (and thus the sequence) is longer than the video file.
  const pbRate = useMemo(() => {
    if (!videoDurationSec || !durationInFrames) return 0.94;
    const targetDurationSec = durationInFrames / fps;
    // Always apply 0.94× safety buffer to prevent "No frame found" crashes
    // at the last GOP boundary of the avatar video file.
    const rate = (videoDurationSec / targetDurationSec) * 0.94;
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
  sourceDuration?: number; // in seconds (actual AI video duration, e.g. 5 or 10 for Kling)
}> = ({ videoUrl, duration, sourceDuration }) => {
  const { fps } = useVideoConfig();

  const resolvedVideoUrl = useMemo(() => resolveLocalUrl(videoUrl) || "", [videoUrl]);

  // ── Crash-proof playback rate (designed for Kling 2.5 Turbo) ────────────
  //
  // sourceDuration = actual duration of the uploaded MP4 file (seconds):
  //   • If server-side FFmpeg stretch SUCCEEDED → equals targetDurationSec (≈ 15s)
  //     → rawRate ≈ 1.0, video plays at normal speed, no crash possible.
  //   • If server-side FFmpeg stretch FAILED    → equals Kling clamp (5 or 10s)
  //     → rawRate < 1 (e.g. 5/15 = 0.33). We MUST slow the video down to that
  //       exact rate so Remotion never requests a frame past the video's end.
  //       Using pbRate=1 in this case IS the cause of "No frame found" crashes.
  //
  // Why 0.98 buffer?
  //   At the last frame of a 450-frame (15s) sequence, Remotion requests
  //   video time = 449 * pbRate / fps. A 0.98 buffer keeps this just
  //   under the file's actual last frame, preventing boundary crashes.
  //
  // Minimum 0.15x:
  //   Protects against extreme slow-motion on very short clips (< 2s).
  //
  const targetDurationSec = duration / fps;

  const pbRate = useMemo(() => {
    // Fallback: If Inngest state is missing sceneVideoDurations from an older cached run,
    // assume the worst-case Kling duration (5s) to guarantee no hard crashes.
    const actualLength = sourceDuration && sourceDuration > 0 ? sourceDuration : 5;

    const rawRate = actualLength / targetDurationSec;

    // ── CRITICAL: Always apply a 0.94× safety buffer regardless of direction ──
    //
    // H.264/H.265 videos don't end exactly at the container-declared duration.
    // GOP boundaries mean the last decodable frame is typically 1–2 frames
    // BEFORE the declared end time. Without this buffer, Remotion requests
    // the exact last declared frame timestamp → compositor returns
    // "No frame found at position XXXXXX" → render crashes.
    //
    // 0.94 = 6% safety margin ≈ 1–2 frame buffer at 30fps.
    // This means we use up to 94% of the source video's declared duration.
    //
    // Clamped between 0.15× (min slow-motion) and 4× (max fast-forward).
    return Math.max(0.15, Math.min(4.0, rawRate * 0.94));
  }, [sourceDuration, targetDurationSec]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
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
  // Sequence resets frame to 0 at contentStart. Audio also starts at contentStart with no delay.
  // SYNC_OFFSET = 0: captions are perfectly synced with audio.
  // (Previously 1.30s to compensate for CAPTION_DELAY_FRAMES=30, which has since been set to 0)
  const SYNC_OFFSET = 0.0;
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

export function resolveLocalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let cleanUrl = url;

  // 1. Force stripping of NEXT_PUBLIC_APP_URL, localhosts, and 127.0.0.1
  if (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')) {
    try {
      cleanUrl = new URL(cleanUrl).pathname;
    } catch (e) {}
  }
  
  // Also strip any custom vercel URL domains if they exist but we didn't catch it
  if (cleanUrl.startsWith('http') && cleanUrl.includes('/public/avatars/')) {
       cleanUrl = cleanUrl.substring(cleanUrl.indexOf('/public/avatars/'));
  }
  if (cleanUrl.startsWith('http') && cleanUrl.includes('/avatars/')) {
       cleanUrl = cleanUrl.substring(cleanUrl.indexOf('/avatars/'));
  }

  // 2. Aggressively Strip any exact sequence of '/public/' or 'public/' from the start of the path
  while (cleanUrl.startsWith('/public/') || cleanUrl.startsWith('public/')) {
      cleanUrl = cleanUrl.replace(/^\/?public\//, '');
  }

  // 3. If it is an avatar, guarantee it maps to staticFile
  if (cleanUrl.includes('avatars/avatar')) {
      // It is a local file.
      const match = cleanUrl.match(/avatars\/avatar[0-9]+-(intro|outro)\.(mp4|webm)/);
      if (match) return staticFile(match[0]);
  }

  // 4. If it is STILL http or a direct local file uri, keep it as is.
  if (cleanUrl.startsWith('http') || cleanUrl.startsWith('file:///')) return cleanUrl;

  // 5. Otherwise map to staticFile (local downloads like tmp/assets)
  const finalUrl = cleanUrl.startsWith('/') ? cleanUrl.substring(1) : cleanUrl;
  return staticFile(finalUrl);
}

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

  const resolvedMusicUrl = useMemo(() => resolveLocalUrl(musicUrl), [musicUrl]);
  const resolvedAudioUrl = useMemo(() => resolveLocalUrl(audioUrl), [audioUrl]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* ── Background Music: runs throughout entire video ── */}
      {resolvedMusicUrl && <Audio src={resolvedMusicUrl} volume={0.12} loop crossOrigin="anonymous" />}

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
      {resolvedAudioUrl && (
        <Sequence from={contentStart} durationInFrames={contentFrames}>
          <Audio src={resolvedAudioUrl} crossOrigin="anonymous" />
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
