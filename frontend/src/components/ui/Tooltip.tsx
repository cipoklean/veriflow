import { useState, useRef, type ReactNode } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
  useHover,
  useFocus,
  useRole,
  useDismiss,
  useInteractions,
  FloatingPortal,
  safePolygon,
  type Placement,
} from '@floating-ui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TooltipProps {
  /** The trigger content (button/span/label). Tooltip fires on hover (300ms) AND focus (instant). */
  children: ReactNode;
  /** Tooltip text, or a render function (children get the "copied" state for morphing). */
  content: ReactNode | ((copied: boolean) => ReactNode);
  /** Set true to enable click-to-copy behavior + "Copied!" swap (use with addresses). */
  copyable?: boolean;
  copyText?: string;
  placement?: Placement;
  className?: string;
  /** When true the trigger is a disabled control — tooltip still fires (critical for disabled buttons). */
  disabled?: boolean;
  /** When false the tooltip will not open (e.g. suppressed while a dropdown is open). */
  enabled?: boolean;
}

/**
 * Accessible tooltip (Floating UI): 300ms hover delay, instant on focus,
 * glass style, arrow, fade+scale 120ms. Copyable mode swaps the tooltip to
 * "Copied!" for 1.2s after click.
 */
export function Tooltip({
  children,
  content,
  copyable = false,
  copyText,
  placement = 'top',
  className,
  disabled = false,
  enabled = true,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const arrowRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open: enabled ? open : false,
    onOpenChange: (next) => setOpen(enabled ? next : false),
    placement,
    strategy: 'fixed',
    middleware: [offset(8), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 8 }), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 300, close: 0 },
    restMs: 0,
    // FE-22: keep the tooltip open while the pointer travels from the trigger
    // into the tooltip itself. Without this, the floating element sits under the
    // cursor (placement=bottom), the hover "leaves" the reference, close:0 hides
    // it instantly, the cursor re-enters the button, and it reopens — an
    // infinite blink. safePolygon treats the reference+tooltip as one region.
    handleClose: safePolygon({ blockPointerEvents: true }),
  });
  const focus = useFocus(context);
  const role = useRole(context, { role: 'tooltip' });
  // ancestorScroll: true — close when a scrollable ancestor scrolls (e.g.
  // .table-container). L-6: without it, portaled fixed tooltips would stay
  // pinned to stale coordinates while the table scrolls underneath.
  const dismiss = useDismiss(context, { ancestorScroll: true });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role, dismiss]);

  const handleClick = () => {
    if (!copyable) return;
    const text = copyText ?? (typeof content === 'string' ? content : '');
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard may be unavailable; still show feedback */
    }
    setCopied(true);
    setOpen(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
      setOpen(false);
    }, 1200);
  };

  const arrowX = middlewareData.arrow?.x;
  const arrowY = middlewareData.arrow?.y;
  const staticSide = {
    top: 'bottom',
    right: 'left',
    bottom: 'top',
    left: 'right',
  }[placement.split('-')[0] as 'top' | 'right' | 'bottom' | 'left'];

  const rendered = typeof content === 'function' ? content(copied) : copied ? 'Copied!' : content;

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        onClick={handleClick}
        tabIndex={0}
        className={cn('inline-flex', disabled && 'pointer-events-auto', className)}
      >
        {children}
      </span>
      <AnimatePresence>
        {open && (
          <FloatingPortal>
            <motion.div
              ref={refs.setFloating}
              style={floatingStyles}
              initial={{ opacity: 0, scale: 0.95, y: 2 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 2 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              {...getFloatingProps()}
              className="z-40 max-w-xs rounded-xl border border-white/12 bg-[#0E1A2B]/95 px-3 py-1.5 text-xs leading-relaxed text-text-primary shadow-[0_12px_40px_rgba(0,0,0,0.55),0_0_20px_rgba(45,212,191,0.10)] backdrop-blur-xl"
              role="tooltip"
            >
              {rendered}
              <div
                ref={arrowRef}
                className="absolute h-2 w-2 rotate-45 rounded-[2px] border border-white/12 bg-[#0E1A2B]"
                style={{
                  left: arrowX != null ? `${arrowX}px` : undefined,
                  top: arrowY != null ? `${arrowY}px` : undefined,
                  right: undefined,
                  bottom: undefined,
                  [staticSide]: '-5px',
                }}
              />
            </motion.div>
          </FloatingPortal>
        )}
      </AnimatePresence>
    </>
  );
}
