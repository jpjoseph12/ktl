import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/* A QR code for `text`, drawn as SVG in the app's own colours. Medium
   error correction: survives a glare or a smudge on a phone screen. */
export default function QrCode({ text, size = 176, label }) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    }
    return { count: n, path: d };
  }, [text]);
  const quiet = 2;
  const box = count + quiet * 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`} width={size} height={size} role="img" aria-label={label || `QR code for ${text}`}
      shapeRendering="crispEdges" style={{ background: 'var(--surface)', borderRadius: 'var(--radius-sm)', display: 'block' }}
    >
      <path d={path} fill="var(--fg)" />
    </svg>
  );
}
