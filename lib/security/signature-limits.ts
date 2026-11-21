/**
 * Authorised signature image size and dimension boundaries.
 * Shared between client (upload modal/cleaner) and server (validation).
 */

export const SIGNATURE_MAX_BYTES = 20 * 1024; // 20 KB (B9b; the browser steps the PNG size down to fit)
export const SIGNATURE_MIN_WIDTH_PX = 300;
export const SIGNATURE_MAX_WIDTH_PX = 1500;

