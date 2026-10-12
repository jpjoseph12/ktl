import { useEffect, useState } from 'react';
import { useWalkthrough } from '../context/WalkthroughContext';

const TOOLTIP_HEIGHT_GUESS = 180;

/* An SVG path for a full-viewport rect with a rounded-rect "bite" taken out
   of it — used as a clip-path so the dimming actually matches the target's
   own corner radius (a pill button gets a pill-shaped cutout, not a square
   one), and the target itself stays clickable through the hole. */
function scrimClipPath(hole, radius) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2));
  const { left: x, top: y, width: w, height: h } = hole;
  const outer = `M0,0 H${vw} V${vh} H0 Z`;
  const inner = `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return `path(evenodd, "${outer} ${inner}")`;
}

export default function WalkthroughOverlay() {
  const W = useWalkthrough();
  const [rect, setRect] = useState(null);
  const [radius, setRadius] = useState(0);

  const targetEl = W.active && W.step.target ? W.targets[W.step.target] : null;

  useEffect(() => {
    if (!targetEl) {
      setRect(null);
      return undefined;
    }
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const measure = () => {
      setRect(targetEl.getBoundingClientRect());
      setRadius(parseFloat(getComputedStyle(targetEl).borderTopLeftRadius) || 0);
    };
    measure();
    const id = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [targetEl]);

  if (!W.active) return null;

  const pad = 8;
  const hole = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  const holeRadius = hole ? radius + pad : 0;

  const cardStyle = hole
    ? {
        left: '50%',
        transform: 'translateX(-50%)',
        top: hole.top + hole.height + 16 + TOOLTIP_HEIGHT_GUESS <= window.innerHeight
          ? hole.top + hole.height + 16
          : Math.max(16, hole.top - TOOLTIP_HEIGHT_GUESS - 16)
      }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="walkthrough-layer" role="dialog" aria-modal="true" aria-label={W.step.title}>
      <div className="walkthrough-dim" style={hole ? { clipPath: scrimClipPath(hole, holeRadius) } : undefined} />
      {hole && <div className="walkthrough-ring" style={{ ...hole, borderRadius: holeRadius }} />}
      <div className="walkthrough-card" style={cardStyle}>
        <p className="meta">Step {W.stepIndex + 1} of {W.totalSteps}</p>
        <h3>{W.step.title}</h3>
        <p className="body-sm">{W.step.body}</p>
        <div className="walkthrough-actions">
          <button className="btn btn-ghost btn-sm" onClick={W.skip}>Skip tour</button>
          <button className="btn btn-primary btn-sm" onClick={W.next}>{W.step.cta || 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
