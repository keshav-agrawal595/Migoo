/**
 * Generate reliable image URLs with fallbacks
 */

export function getReliableImageUrl(
    seed: string,
    width: number,
    height: number,
    fallbackGradient?: string
): string {
    // Primary: Picsum Photos (very reliable, no rate limits)
    const picsumUrl = `https://picsum.photos/seed/${seed}/${width}/${height}`;

    return picsumUrl;
}

export function getGradientDataUri(colors: string[]): string {
    const svg = `
    <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill="url(#grad)" />
    </svg>
  `;

    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}