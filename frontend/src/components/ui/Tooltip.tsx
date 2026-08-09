// src/components/ui/Tooltip.tsx — replace file verbatim
import { useState, type ReactNode } from 'react';
import {
  autoUpdate, flip, FloatingPortal, offset, shift,
  useDismiss, useFloating, useFocus, useHover, useInteractions, useRole,
  type Placement,
} from '@floating-ui/react';

type TooltipProps = {
  content?: ReactNode | ((copied: boolean) => ReactNode);
  children: ReactNode;
  placement?: Placement;
  disabled?: boolean;
  enabled?: boolean;
  copyable?: boolean;
  copyText?: string;
};

export function Tooltip({
  content, children, placement = 'bottom',
  disabled = false, enabled = true, copyable = false, copyText,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const resolved = typeof content === 'function' ? content(false) : content;
  const active = enabled && !disabled && resolved != null;

  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen,
    placement, strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 300, close: 0 }, move: false, enabled: active }),
    useFocus(context, { enabled: active }),
    useDismiss(context, { ancestorScroll: true, enabled: active }),
    useRole(context, { role: 'tooltip' }),
  ]);

  const handleCopy = async () => {
    if (!copyable) return;
    const text = copyText ?? (typeof resolved === 'string' ? resolved : '');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard denied — ignore */ }
  };

  return (
    <>
      {/* wrapper span GUARANTEES the reference ref binds, even when children
          are components that don't forward refs */}
      <span ref={refs.setReference} {...getReferenceProps()}
        className="inline-flex min-w-0">
        {children}
      </span>

      {open && active && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({ onClick: copyable ? handleCopy : undefined })}
            className="vf-tooltip z-40"
          >
            {copied ? 'Copied!' : resolved}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export default Tooltip;
