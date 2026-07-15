const fallbackSvg = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#1b2025"/>
    <path d="M220 245l62-70 45 48 43-38 70 60H220z" fill="#424b54"/>
    <circle cx="270" cy="125" r="25" fill="#59636d"/>
    <text x="320" y="305" fill="#8e99a3" font-family="system-ui,sans-serif" font-size="22" text-anchor="middle">
      Vorschau nicht verfügbar
    </text>
  </svg>
`);

export const imageFallbackUrl = `data:image/svg+xml;charset=utf-8,${fallbackSvg}`;

export function installImageFallback() {
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === 'true') return;
      image.dataset.fallbackApplied = 'true';
      image.classList.add('image-fallback');
      image.alt = `${image.alt || 'Medienvorschau'} – Vorschau nicht verfügbar`;
      image.removeAttribute('srcset');
      image.src = imageFallbackUrl;
    },
    true,
  );
}
