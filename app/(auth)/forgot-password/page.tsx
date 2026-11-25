import type { Metadata } from 'next';
import { PasswordRecoveryForm } from '@/components/auth/password-recovery-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return <PasswordRecoveryForm mode="request" />;
}
