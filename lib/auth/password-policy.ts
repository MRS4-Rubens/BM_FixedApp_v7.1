export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password12', 'password123', 'password1234', 'password!23', 'passw0rd123',
  '1234567890', '12345678910', '0123456789', '0987654321', '9876543210',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', 'asdfghjkl1', 'iloveyou12',
  'iloveyou123', 'welcome123', 'welcome1234', 'admin12345', 'administrator',
  'letmein123', 'changeme123', 'abcdefghij', 'abc1234567', 'billmatrix',
  'billmatrix1', 'billmatrix123', 'billmatrix@123', 'india12345',
  'india@12345', 'test123456', 'sunshine123', 'football123', 'monkey1234',
]);

const SEQUENCES: readonly string[] = [
  '01234567890',
  '1234567890',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
];

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

function hasSequenceOfTen(lowerPassword: string): boolean {
  if (lowerPassword.length < 10) return false;
  for (let i = 0; i <= lowerPassword.length - 10; i++) {
    const window10 = lowerPassword.slice(i, i + 10);
    for (const seq of SEQUENCES) {
      const rev = seq.split('').reverse().join('');
      if (seq.includes(window10) || rev.includes(window10)) {
        return true;
      }
    }
  }
  return false;
}

export function validatePasswordPolicy(
  password: string,
  context?: { email?: string | null; name?: string | null }
): PasswordPolicyResult {
  // 1. Minimum length
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: 'Password must be at least 10 characters long.' };
  }

  // 2. Maximum length
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: 'Password must be at most 128 characters long.' };
  }

  const lower = password.toLowerCase();

  // 3. Common passwords, single repeated character, or sequences of >= 10 chars
  const isRepeatedChar = /^(.)\1+$/u.test(password);
  if (COMMON_PASSWORDS.has(lower) || isRepeatedChar || hasSequenceOfTen(lower)) {
    return { ok: false, message: 'This password is too common. Please choose a different one.' };
  }

  // 4. Email local-part check (>= 4 characters)
  if (context?.email) {
    const atIndex = context.email.indexOf('@');
    const localPart = (atIndex >= 0 ? context.email.slice(0, atIndex) : context.email)
      .trim()
      .toLowerCase();
    if (localPart.length >= 4 && lower.includes(localPart)) {
      return { ok: false, message: 'Password must not contain your email name.' };
    }
  }

  return { ok: true };
}

