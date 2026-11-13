export const SIGNATURE_UPLOAD_RULES = [
  'Sign with a black or blue pen on plain white paper',
  'Write the signature left to right (landscape), not upright',
  'Take the photo in good light, with no shadows or other writing',
  'PNG, JPG or WEBP, up to 10 MB — any size or shape; we fit it for you',
  'It prints in a 90 mm × 30 mm box on your invoices',
] as const;

export const CROP_HOW_TO = [
  {
    device: 'Android',
    steps:
      'Open the photo in Gallery or Google Photos → Edit → Crop → drag the corners around your signature → Save copy',
  },
  {
    device: 'iPhone',
    steps: 'Open the photo in Photos → Edit → Crop icon → drag the corners around your signature → Done',
  },
  {
    device: 'Windows',
    steps: 'Open the photo in the Photos app → Edit (Ctrl+E) → Crop → drag the corners → Save as copy',
  },
  {
    device: 'Mac',
    steps: 'Open the photo in Preview → drag a box around your signature → Tools → Crop → File → Save',
  },
] as const;

export const REJECTION_MESSAGES: Record<
  'empty' | 'too_busy' | 'portrait' | 'wrong_colour' | 'too_large' | 'unreadable',
  { title: string; fix: string; showCropHelp: boolean }
> = {
  empty: {
    title: "We couldn't find a signature in this photo.",
    fix: 'Sign with a darker black or blue pen and take the photo closer, in good light.',
    showCropHelp: false,
  },
  too_busy: {
    title: 'This photo has too much in it.',
    fix: 'Crop the photo so only your signature is left, on plain white paper (not lined paper), with no shadows.',
    showCropHelp: true,
  },
  portrait: {
    title: 'Your signature looks upright.',
    fix: 'Rotate the photo in your phone so the signature reads left to right, then upload again.',
    showCropHelp: true,
  },
  wrong_colour: {
    title: 'Only black or blue ink is accepted.',
    fix: 'Please sign again with a black or blue pen and upload a new photo.',
    showCropHelp: false,
  },
  too_large: {
    title: 'This signature image is too large to save.',
    fix: 'Crop the photo closer around your signature and try again.',
    showCropHelp: true,
  },
  unreadable: {
    title: "We couldn't read this image.",
    fix: 'Please choose a PNG, JPG or WEBP photo.',
    showCropHelp: false,
  },
};

