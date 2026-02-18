import { useEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
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
      // Keep r1 (heading) always active
      if (el.getAttribute("data-reveal") === "r1") {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
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

  function revealImmediate(id) {
    const el = document.querySelector("[data-reveal='" + id + "']");
    if (el) {
      el.classList.add("active");
      el.style.transition = "none"; // No animation for immediate reveals
      setTimeout(() => {
        el.style.transition = ""; // Restore transitions
      }, 10);
    }
  }

  window.addEventListener("message", function (e) {
    const msg = e.data;
    if (!msg || !msg.type) return;
    
    if (msg.type === "RESET") {
      reset();
    } else if (msg.type === "REVEAL") {
      reveal(msg.id);
    } else if (msg.type === "REVEAL_IMMEDIATE") {
      revealImmediate(msg.id);
    } else if (msg.type === "REVEAL_MULTIPLE") {
      msg.ids.forEach(id => reveal(id));
    }
  });
  
  // Ensure r1 (heading) is always visible on load
  window.addEventListener("load", function() {
    const r1 = document.querySelector("[data-reveal='r1']");
    if (r1) {
      r1.classList.add("active");
    }
  });
})();
</script>
`;

const AUTO_SCALE_SCRIPT = `
<script>
(function() {
  window.addEventListener('load', function() {
    var wrapper = document.body.children[0];
    if (!wrapper) return;
    var contentHeight = wrapper.scrollHeight;
    var viewportHeight = 720;
    if (contentHeight > viewportHeight) {
      var scale = viewportHeight / contentHeight;
      scale = Math.max(scale, 0.65);
      wrapper.style.transform = 'scale(' + scale + ')';
      wrapper.style.transformOrigin = 'top center';
      wrapper.style.height = (viewportHeight / scale) + 'px';
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
    /* Auto-scale wrapper for oversized content */
    body > div:first-child {
      transform-origin: top center;
      width: 1280px;
      max-height: 720px;
    }
  </style>
</head>
${fullHtml}
</html>`;
  }

  // Inject auto-scale before the reveal runtime
  if (fullHtml.includes("</body>")) {
    fullHtml = fullHtml.replace("</body>", AUTO_SCALE_SCRIPT + "</body>");
  } else {
    fullHtml += AUTO_SCALE_SCRIPT;
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
  const hasShownHeading = useRef(false);

  // Calculate reveal plan with optimized timing for faster reveals
  const revealPlan = useMemo(() => {
    const ids = slide.revealData ?? [];
    const chunks = slide.caption?.chunks ?? [];

    // If we have caption chunks, use those timestamps with faster timing
    if (chunks.length > 0) {
      return ids.map((id, i) => {
        // Use chunk timestamp with minimal offset for immediate sync
        const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.2);
        // Reveal slightly earlier for better perceived sync (50ms)
        return {
          id,
          at: Math.max(0, chunkTime - 0.05),
        };
      });
    }

    // Fallback: faster distribution (1.2s intervals instead of 1.5s)
    const estimatedDuration = Math.max(8, ids.length * 1.2);
    const interval = estimatedDuration / ids.length;

    return ids.map((id, i) => ({
      id,
      at: i * interval,
    }));
  }, [slide.slideId, slide.revealData, slide.caption]);

  const handleLoad = () => {
    setReady(true);
    lastRevealedIndex.current = -1;
    hasShownHeading.current = false;

    // Reset and immediately show r1 (heading)
    setTimeout(() => {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage({ type: "RESET" }, "*");
        // Immediately reveal r1 (heading) with no animation
        win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
        hasShownHeading.current = true;
      }
    }, 50);
  };

  // Optimized reveal - faster updates with immediate heading
  useEffect(() => {
    if (!ready) return;

    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    // Ensure heading is always visible
    if (!hasShownHeading.current) {
      win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
      hasShownHeading.current = true;
    }

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

      // Immediately show heading (r1)
      win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");

      // Then reveal other elements
      const idsToReveal = revealIndices
        .filter(i => revealPlan[i].id !== "r1") // Don't double-reveal r1
        .map(i => revealPlan[i].id);

      if (idsToReveal.length > 0) {
        win.postMessage({ type: "REVEAL_MULTIPLE", ids: idsToReveal }, "*");
      }
      lastRevealedIndex.current = newHighestIndex;
    }
    // Otherwise just reveal new items (faster progression)
    else if (newHighestIndex > lastRevealedIndex.current) {
      for (let i = lastRevealedIndex.current + 1; i <= newHighestIndex; i++) {
        const id = revealPlan[i].id;
        // Skip r1 as it's already shown immediately
        if (id !== "r1") {
          win.postMessage({ type: "REVEAL", id }, "*");
        }
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

  // Faster fade in at start (12 frames = ~0.4s at 30fps)
  const fadeInDuration = 12;
  const opacity = isFirstSlide
    ? 1 // First slide starts visible
    : interpolate(
      frame,
      [0, fadeInDuration],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

  // Faster slide in from right with spring animation
  const slideSpring = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 100,
    },
  });

  const translateX = isFirstSlide
    ? 0
    : interpolate(slideSpring, [0, 1], [80, 0]);

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

  // Faster transition duration between slides (10 frames = ~0.33s)
  const TRANSITION_FRAMES = 10;

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