/**
 * Authorised signature image size and dimension boundaries.
 * Shared between client (upload modal/cleaner) and server (validation).
 */

export const SIGNATURE_MAX_BYTES = 512 * 1024; // 512 KB
export const SIGNATURE_MIN_WIDTH_PX = 300;
export const SIGNATURE_MAX_WIDTH_PX = 1500;

