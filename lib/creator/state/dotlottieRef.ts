import type { DotLottie } from '@lottiefiles/dotlottie-web';

/**
 * Shared ref for the active DotLottie (ThorVG) instance.
 * DotLottiePlayback writes here when it creates/destroys the player.
 * SelectionOverlay reads here to call getLayerBoundingBox() for pixel-perfect bbox.
 */
export const dotlottieRef: { current: DotLottie | null } = { current: null };
