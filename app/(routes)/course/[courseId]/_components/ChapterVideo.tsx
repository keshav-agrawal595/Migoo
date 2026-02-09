import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  Audio,
  useVideoConfig,
  useCurrentFrame,
  interpolate,
  spring,
} from "remotion";

/* -------------------------------- Types -------------------------------- */

type CaptionChunk = {
  timestamp: [number, number];
};

type Slide = {
  slideId: string;
  html: string;
  audioFileUrl: string;
  revealData?: string[];
  caption?: {
    chunks: CaptionChunk[];
  };
};

/* --------------------- Reveal runtime (iframe side) --------------------- */

const REVEAL_RUNTIME_SCRIPT = `
<script>
(function () {
  let revealedIds = new Set();
  
  function reset() {
    revealedIds.clear();
    document.querySelectorAll(".reveal").forEach(el => {
      el.classList.remove("active");
    });
  }

  function reveal(id) {
    if (revealedIds.has(id)) return; // Already revealed
    
    revealedIds.add(id);
    const el = document.querySelector("[data-reveal='" + id + "']");
    if (el) {
      el.classList.add("active");
    }
  }

  window.addEventListener("message", function (e) {
    const msg = e.data;
    if (!msg || !msg.type) return;
    
    if (msg.type === "RESET") {
      reset();
    } else if (msg.type === "REVEAL") {
      reveal(msg.id);
    } else if (msg.type === "REVEAL_MULTIPLE") {
      msg.ids.forEach(id => reveal(id));
    }
  });
})();
</script>
`;

const injectRevealRuntime = (html: string) => {
  let fullHtml = html;

  // Add proper HTML structure
  if (!fullHtml.includes('<!DOCTYPE')) {
    fullHtml = '<!DOCTYPE html>\n' + fullHtml;
  }

  if (!fullHtml.includes('<html')) {
    fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1280, height=720">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { 
      width: 1280px; 
      height: 720px; 
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
${fullHtml}
</html>`;
  }

  // Inject script
  if (fullHtml.includes("</body>")) {
    fullHtml = fullHtml.replace("</body>", `${REVEAL_RUNTIME_SCRIPT}</body>`);
  } else {
    fullHtml += REVEAL_RUNTIME_SCRIPT;
  }

  return fullHtml;
};

/* ------------------------- Slide with reveal control ------------------------- */

const SlideIFrameWithReveal = ({ slide }: { slide: Slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const lastRevealedIndex = useRef(-1);

  // Calculate reveal plan with better timing
  const revealPlan = useMemo(() => {
    const ids = slide.revealData ?? [];
    const chunks = slide.caption?.chunks ?? [];

    // If we have caption chunks, use those timestamps
    if (chunks.length > 0) {
      return ids.map((id, i) => {
        // Use chunk timestamp, with small offset for better sync
        const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.5);
        return {
          id,
          at: Math.max(0, chunkTime - 0.1), // 100ms earlier for better sync
        };
      });
    }

    // Fallback: distribute evenly based on estimated duration
    const estimatedDuration = Math.max(10, ids.length * 1.5);
    const interval = estimatedDuration / ids.length;

    return ids.map((id, i) => ({
      id,
      at: i * interval,
    }));
  }, [slide.slideId, slide.revealData, slide.caption]);

  const handleLoad = () => {
    setReady(true);
    lastRevealedIndex.current = -1;

    setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage({ type: "RESET" }, "*");
    }, 50);
  };

  // Optimized reveal - only send new reveals
  useEffect(() => {
    if (!ready) return;

    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    // Find which reveals should be active at current time
    const revealIndices: number[] = [];
    for (let i = 0; i < revealPlan.length; i++) {
      if (time >= revealPlan[i].at) {
        revealIndices.push(i);
      }
    }

    const newHighestIndex = revealIndices.length > 0 ? Math.max(...revealIndices) : -1;

    // If user scrubbed backward, reset and reveal all up to current time
    if (newHighestIndex < lastRevealedIndex.current) {
      win.postMessage({ type: "RESET" }, "*");
      const idsToReveal = revealIndices.map(i => revealPlan[i].id);
      if (idsToReveal.length > 0) {
        win.postMessage({ type: "REVEAL_MULTIPLE", ids: idsToReveal }, "*");
      }
      lastRevealedIndex.current = newHighestIndex;
    }
    // Otherwise just reveal new items
    else if (newHighestIndex > lastRevealedIndex.current) {
      for (let i = lastRevealedIndex.current + 1; i <= newHighestIndex; i++) {
        win.postMessage({ type: "REVEAL", id: revealPlan[i].id }, "*");
      }
      lastRevealedIndex.current = newHighestIndex;
    }
  }, [time, ready, revealPlan]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <iframe
        ref={iframeRef}
        srcDoc={injectRevealRuntime(slide.html)}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: 1280,
          height: 720,
          border: "none",
          display: "block",
          backgroundColor: "#000"
        }}
      />
      <Audio src={slide.audioFileUrl} />
    </AbsoluteFill>
  );
};

/* ----------------------------- Slide Transition Wrapper ----------------------------- */

const SlideWithTransition = ({
  slide,
  isFirstSlide
}: {
  slide: Slide;
  isFirstSlide: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in at start (first 20 frames = ~0.67s at 30fps)
  const fadeInDuration = 20;
  const opacity = isFirstSlide
    ? 1 // First slide starts visible
    : interpolate(
      frame,
      [0, fadeInDuration],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

  // Slide in from right with spring animation
  const slideSpring = spring({
    frame,
    fps,
    config: {
      damping: 20,
      stiffness: 80,
    },
  });

  const translateX = isFirstSlide
    ? 0
    : interpolate(slideSpring, [0, 1], [100, 0]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${translateX}px)`,
      }}
    >
      <SlideIFrameWithReveal slide={slide} />
    </AbsoluteFill>
  );
};

/* ----------------------------- Course Composition ----------------------------- */

type Props = {
  slides: Slide[];
  durationsBySlideId: Record<string, number>;
};

export const CourseComposition = ({ slides, durationsBySlideId }: Props) => {
  const { fps } = useVideoConfig();

  // Transition duration between slides
  const TRANSITION_FRAMES = 15; // ~0.5s fade transition

  const timeline = useMemo(() => {
    let from = 0;
    return slides.map((slide, index) => {
      const dur = durationsBySlideId[slide.slideId] ?? Math.ceil(6 * fps);
      const item = {
        slide,
        from,
        dur,
        isFirstSlide: index === 0
      };

      // Next slide starts a bit before this one ends for smooth transition
      from += dur - (index < slides.length - 1 ? TRANSITION_FRAMES : 0);

      return item;
    });
  }, [slides, durationsBySlideId, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.map(({ slide, from, dur, isFirstSlide }) => (
        <Sequence key={slide.slideId} from={from} durationInFrames={dur}>
          <SlideWithTransition slide={slide} isFirstSlide={isFirstSlide} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};