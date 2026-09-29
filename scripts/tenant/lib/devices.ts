// iOS startup images (apple-touch-startup-image), portrait. CSS size + DPR.
export const STARTUP_DEVICES = [
  {w: 440, h: 956, dpr: 3},  // iPhone 16 Pro Max
  {w: 402, h: 874, dpr: 3},  // iPhone 16 Pro
  {w: 430, h: 932, dpr: 3},  // iPhone 14/15 Pro Max, 15/16 Plus
  {w: 393, h: 852, dpr: 3},  // iPhone 14/15 Pro, 15, 16
  {w: 428, h: 926, dpr: 3},  // iPhone 12/13 Pro Max, 14 Plus
  {w: 390, h: 844, dpr: 3},  // iPhone 12/13/14
  {w: 375, h: 812, dpr: 3},  // iPhone X/XS/11 Pro/12 mini/13 mini
  {w: 414, h: 896, dpr: 3},  // iPhone XS Max/11 Pro Max
  {w: 414, h: 896, dpr: 2},  // iPhone XR/11
  {w: 414, h: 736, dpr: 3},  // iPhone 8 Plus
  {w: 375, h: 667, dpr: 2},  // iPhone 8/SE 2/SE 3
  {w: 1024, h: 1366, dpr: 2}, // iPad Pro 12.9
  {w: 834, h: 1194, dpr: 2},  // iPad Pro 11
  {w: 820, h: 1180, dpr: 2},  // iPad Air
  {w: 768, h: 1024, dpr: 2},  // iPad mini / 9.7
] as const;

export function startupFile(d: {w: number; h: number; dpr: number}) {
  return `splash-${d.w * d.dpr}x${d.h * d.dpr}.png`;
}

export function startupMedia(d: {w: number; h: number; dpr: number}) {
  return `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`;
}

export const ICON_SIZES = [192, 512] as const;
export const MEDIA_WIDTHS = [800, 1600] as const;
