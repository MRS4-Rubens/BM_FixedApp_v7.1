import { randomBytes } from 'crypto';

export interface TestUserIdentity {
  readonly runId: string;
  readonly email: string;
  readonly password: string;
  readonly ownerName: string;
  readonly businessName: string;
  readonly utr: string;
}

export function generateRunId(): string {
  const runIdBase = process.env.GITHUB_RUN_ID ?? 'local';
  const timestamp = Date.now().toString(36);
  const randomSuffix = randomBytes(3).toString('hex');
  return `${runIdBase}-${timestamp}-${randomSuffix}`;
}

export function generateTestPassword(): string {
  // Generates a 20-character password with mixed cases, numbers, and symbols
  // that comfortably satisfies the password policy without repetitive sequences.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = 'Bm#9';
  for (let i = 0; i < 16; i += 1) {
    const idx = Math.floor(Math.random() * chars.length);
    password += chars.charAt(idx);
  }
  return password;
}

export function generateUtr(): string {
  // Indian bank UTR numbers are typically 12-22 alphanumeric or numeric digits.
  // We generate a deterministic 12-digit numeric string based on time + random.
  const timePart = Date.now().toString().slice(-8); // 8 digits
  const randPart = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digits
  return `${timePart}${randPart}`;
}

export function generateTestIdentity(
  runId = generateRunId(),
  options: { mailSinkDomain?: string } = {},
): TestUserIdentity {
  const email = options.mailSinkDomain
    ? `e2e-${runId}@${options.mailSinkDomain}`
    : `e2e+${runId}@example.test`;

  return {
    runId,
    email,
    password: generateTestPassword(),
    ownerName: `Test Owner ${runId.slice(-6)}`,
    businessName: `E2E Enterprise ${runId.slice(-6)}`,
    utr: generateUtr(),
  };
}

