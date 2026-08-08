import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

/**
 * Animated number that TICKS old→new on change (400ms, ease-out, tabular).
 * Purpose: living-data feedback when reserves/registries poll and change.
 */
export function useTickingNumber(value: number, duration = 400) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || value === prev.current) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: duration / 1000,
      ease: 'easeOut',
      onUpdate: v => setDisplay(v),
      onComplete: () => {
        prev.current = value;
        setDisplay(value);
      },
    });
    return () => {
      controls.stop();
      prev.current = value;
    };
  }, [value, duration, reduced]);

  return display;
}

/**
 * Count-up on first mount (600ms ease-out, respects reduced-motion).
 * Purpose: entrance hierarchy for numbers.
 */
export function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !target) {
      setValue(target);
      return;
    }
    const controls = animate(0, target, {
      duration: duration / 1000,
      ease: 'easeOut',
      onUpdate: v => setValue(v),
    });
    return () => controls.stop();
  }, [target, duration, reduced]);

  return value;
}

/**
 * Sparkline draw-on: animates stroke-dashoffset when `points` update.
 * Returns the dash metrics to apply to the path (pass as style).
 */
export function useSparklineDraw(points: number[], duration = 500) {
  const [pathLen, setPathLen] = useState(0);
  const [progress, setProgress] = useState(1);
  const prevKey = useRef('');
  const reduced = useReducedMotion();

  useEffect(() => {
    const key = points.join(',');
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (reduced || points.length < 2) {
      setProgress(1);
      return;
    }
    setProgress(0);
    const controls = animate(0, 1, {
      duration: duration / 1000,
      ease: 'easeOut',
      onUpdate: v => setProgress(v),
    });
    return () => controls.stop();
  }, [points, duration, reduced]);

  const dashOffset = pathLen ? pathLen * (1 - progress) : undefined;

  return {
    ref: (el: SVGPathElement | null) => {
      if (el && el.getTotalLength && !pathLen) setPathLen(el.getTotalLength());
    },
    dashOffset,
    strokeDasharray: pathLen || undefined,
  };
}
