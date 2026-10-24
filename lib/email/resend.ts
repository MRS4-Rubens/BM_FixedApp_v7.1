import { Resend } from 'resend';
import { getEmailEnv } from '@/lib/env';

let instance: Resend | undefined;

/** Lazily constructed Resend client. Throws EnvConfigError if e-mail variables are invalid. */
export function getResend(): Resend {
  instance ??= new Resend(getEmailEnv().RESEND_API_KEY);
  return instance;
}
