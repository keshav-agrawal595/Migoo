import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadSpaceMono } from '@remotion/google-fonts/SpaceMono';
import { loadFont as loadOrbitron } from '@remotion/google-fonts/Orbitron';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadNotoHindi } from '@remotion/google-fonts/NotoSansDevanagari';
import { captionStyles, CaptionStyleConfig } from '../lib/caption-styles';

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
  end: number; // in seconds
}

export interface CompositionProps {
  imageUrls: string[];
  audioUrl: string;
  musicUrl?: string;
  captionData: {
    segments: CaptionSegment[];
  };
  captionStyle?: string;
  language?: string;
  durationInFrames: number;
}

const VideoScene: React.FC<{
  imageUrl: string;
  duration: number;
  index: number;
}> = ({ imageUrl, duration, index }) => {
  const frame = useCurrentFrame();

  // Animations: Alternating between Zoom In, Slide Up, Slide Down
  const animationType = index % 3;

  let animationStyle: React.CSSProperties = {};

  if (animationType === 0) {
    // Zoom In 
    const scale = interpolate(frame, [0, duration], [1, 1.1], { extrapolateRight: 'clamp' });
    animationStyle = {
      transform: `scale(${scale})`,
      opacity: 1,
    };
  } else if (animationType === 1) {
    // Slide Up
    const translateY = interpolate(frame, [0, duration], [0, -30], { extrapolateRight: 'clamp' });
    animationStyle = {
      transform: `translateY(${translateY}px) scale(1.05)`,
      opacity: 1,
    };
  } else {
    // Slide Down
    const translateY = interpolate(frame, [0, duration], [-30, 0], { extrapolateRight: 'clamp' });
    animationStyle = {
      transform: `translateY(${translateY}px) scale(1.05)`,
      opacity: 1,
    };
  }

  return (
    <AbsoluteFill>
      <Img
        src={imageUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          ...animationStyle,
        }}
      />
    </AbsoluteFill>
  );
};

const Captions: React.FC<{
  segments: CaptionSegment[],
  styleId?: string,
  language?: string
}> = ({ segments, styleId = 'bold-pop', language = 'en-IN' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const style = useMemo(() =>
    captionStyles.find(s => s.id === styleId) || captionStyles[0],
    [styleId]
  );

  const activeSegment = segments.find(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  if (!activeSegment) return null;

  // Animation logic per style
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

  if (style.backgroundColor !== 'transparent') {
    animatedStyle.backgroundColor = style.backgroundColor;
  }
  if (style.textShadow !== 'none') {
    animatedStyle.textShadow = style.textShadow;
  }
  if (style.textStroke !== 'none') {
    (animatedStyle as any).WebkitTextStroke = style.textStroke;
  }

  // Animation variations
  if (style.animation === 'pop') {
    const springValue = interpolate(currentTime - activeSegment.start, [0, 0.1, 0.2], [0.8, 1.1, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    animatedStyle.transform = `scale(${springValue})`;
  } else if (style.animation === 'glow') {
    const glow = interpolate(Math.sin(frame / 5), [-1, 1], [0.8, 1.2], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    animatedStyle.opacity = glow;
  } else if (style.animation === 'bounce') {
    const bounce = interpolate(currentTime - activeSegment.start, [0, 0.15, 0.3], [50, -10, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    animatedStyle.transform = `translateY(${bounce}px)`;
  } else if (style.animation === 'fade') {
    const opacity = interpolate(currentTime - activeSegment.start, [0, 0.3], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    animatedStyle.opacity = opacity;
  }

  // Karaoke handling (Split text and highlight active word)
  const renderText = () => {
    if (style.animation === 'karaoke') {
      const words = activeSegment.text.split(' ');
      const totalDuration = activeSegment.end - activeSegment.start;
      const timePerWord = totalDuration / words.length;
      const activeWordIndex = Math.floor((currentTime - activeSegment.start) / timePerWord);
        
      return words.map((word, i) => (
        <span
          key={i}
          style={{
            color: i <= activeWordIndex ? style.highlightColor : style.color,
            transition: 'color 0.1s ease'
          }}
        >
          {word}{' '}
        </span>
      ));
    }
    
    if (style.animation === 'typewriter') {
      const chars = activeSegment.text.length;
      const totalDuration = activeSegment.end - activeSegment.start;
      const charIndex = Math.floor(interpolate(currentTime - activeSegment.start, [0, totalDuration * 0.8], [0, chars], {
        extrapolateRight: 'clamp'
      }));
      return activeSegment.text.slice(0, charIndex);
    }

    return activeSegment.text;
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: '15%',
        paddingLeft: '40px',
        paddingRight: '40px',
        zIndex: 10,
      }}
    >
      <div 
        style={{
            ...animatedStyle,
            fontSize: style.fontSize * 1.2,
            display: 'inline-block',
            textShadow: '0 0 10px rgba(0,0,0,0.8), 2px 2px 5px rgba(0,0,0,1)',
        }}
      >
        {renderText()}
      </div>
    </AbsoluteFill>
  );
};

export const MainComposition: React.FC<CompositionProps> = ({
  imageUrls,
  audioUrl,
  musicUrl,
  captionData,
  captionStyle,
  language,
}) => {
  const { durationInFrames } = useVideoConfig();

  // Calculate duration per scene
  const sceneDuration = Math.floor(durationInFrames / (imageUrls?.length || 1));

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Voice Audio Layer */}
      {audioUrl && <Audio src={audioUrl} />}

      {/* Background Music Layer — mild volume so speaker voice stays dominant */}
      {musicUrl && <Audio src={musicUrl} volume={0.12} loop />}

      {/* Video Scenes Layer */}
      {imageUrls?.filter(url => url).map((url, i) => (
        <Sequence
          key={i}
          from={i * sceneDuration}
          durationInFrames={sceneDuration}
        >
          <VideoScene imageUrl={url} duration={sceneDuration} index={i} />
        </Sequence>
      ))}

      {/* Captions Layer */}
      {captionData?.segments && (
        <Captions
          segments={captionData.segments}
          styleId={captionStyle}
          language={language}
        />
      )}
    </AbsoluteFill>
  );
};
