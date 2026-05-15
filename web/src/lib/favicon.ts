'use client';

export type FaviconStatus = 'green' | 'amber' | 'red' | 'neutral';

const COLOR_MAP: Record<FaviconStatus, string> = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  neutral: '#71717A',
};

// Memoize generated data URLs so we don't re-render the canvas on every call.
const dataUrlCache: Partial<Record<FaviconStatus, string>> = {};

function generateDataUrl(status: FaviconStatus): string {
  const cached = dataUrlCache[status];
  if (cached) return cached;

  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Transparent background
  ctx.clearRect(0, 0, 32, 32);

  // Filled status circle
  ctx.beginPath();
  ctx.arc(16, 16, 13, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_MAP[status];
  ctx.fill();

  // Subtle dark ring for contrast on light tab backgrounds
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();

  const url = canvas.toDataURL('image/png');
  dataUrlCache[status] = url;
  return url;
}

export function setFaviconStatus(status: FaviconStatus): void {
  if (typeof document === 'undefined') return;

  const url = generateDataUrl(status);
  if (!url) return;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    // Gracefully create one if the layout didn't ship a <link rel="icon">.
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}
