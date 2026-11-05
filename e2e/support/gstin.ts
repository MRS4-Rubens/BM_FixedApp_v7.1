const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinChecksumChar(first14: string): string {
  if (!/^[0-9A-Z]{14}$/.test(first14)) {
    throw new Error('GSTIN base must be 14 alphanumeric characters');
  }
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET.charAt((36 - (sum % 36)) % 36);
}

export function isValidGstin(gstin: string): boolean {
  if (gstin.length !== 15 || !GSTIN_REGEX.test(gstin)) return false;
  return gstinChecksumChar(gstin.slice(0, 14)) === gstin.charAt(14);
}

export interface RandomSource {
  random(): number;
}

const defaultRandomSource: RandomSource = {
  random: () => Math.random(),
};

/**
 * Generates a valid 15-character GSTIN for a given state code.
 * Ensures the PAN entity character (4th letter) is valid ('C', 'P', 'F', etc.)
 * and calculates the statutory 15th checksum character.
 */
export function makeGstin(stateCode2: string, rng: RandomSource = defaultRandomSource): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const entityLetters = 'CPFAHTBLJG'; // Standard Indian Income Tax PAN entity letters

  const randomLetter = (): string => letters[Math.floor(rng.random() * letters.length)] ?? 'A';
  const randomEntityLetter = (): string =>
    entityLetters[Math.floor(rng.random() * entityLetters.length)] ?? 'C';
  const randomDigit = (): string => Math.floor(rng.random() * 10).toString();

  const pan1 = randomLetter() + randomLetter() + randomLetter();
  const pan4 = randomEntityLetter();
  const pan5 = randomLetter();
  const panDigits = `${randomDigit()}${randomDigit()}${randomDigit()}${randomDigit()}`;
  const panLast = randomLetter();

  const pan = `${pan1}${pan4}${pan5}${panDigits}${panLast}`;
  const entityNo = '1';
  const defaultZ = 'Z';

  const first14 = `${stateCode2}${pan}${entityNo}${defaultZ}`;
  const checkChar = gstinChecksumChar(first14);
  return `${first14}${checkChar}`;
}

