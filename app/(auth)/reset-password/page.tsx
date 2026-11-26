import type { Metadata } from 'next';
import { PasswordRecoveryForm } from '@/components/auth/password-recovery-form';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const { token, error } = await searchParams;
  const validToken = !error && typeof token === 'string' && token.length <= 512 ? token : '';

  return <PasswordRecoveryForm mode="reset" token={validToken} />;
}
