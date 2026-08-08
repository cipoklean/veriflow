import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** stagger delay in seconds (use to cascade sibling blocks) */
  delay?: number;
  /** enter from below by this many px (default 18) */
  y?: number;
  className?: string;
  /** when true, children animate as a group with staggered items (use <RevealItem> inside) */
  as?: 'div' | 'section' | 'li' | 'article';
}

/**
 * Scroll-reveal wrapper. Mirrors the gpt-taste "Desire" layer (GSAP-style
 * fade/slide on scroll) using the app's existing framer-motion stack so it
 * never conflicts with the route-transition system. Respects reduced motion.
 */
export function Reveal({ children, delay = 0, y = 18, className, as = 'div' }: RevealProps) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as];

  return (
    <MotionTag
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </MotionTag>
  );
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * Use inside <Reveal as="div"> when you want children to stagger in sequence.
 * Wrap the parent Reveal's children with <RevealGroup> and each item in
 * <RevealItem>. Reduced-motion falls back to instant opacity.
 */
export function RevealGroup({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? 'show' : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ show: { transition: { staggerChildren: 0.08 } } }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
