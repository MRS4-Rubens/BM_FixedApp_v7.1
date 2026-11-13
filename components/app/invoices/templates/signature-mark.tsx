import { cn } from '@/lib/utils';

export const AUTHORISED_SIGNATORY_LABEL = 'Authorised Signatory';

const DATA_URI_PREFIX = 'data:image/png;base64,';

/**
 * Validates whether a given value is a valid PNG base64 data URI.
 * Rejects external URLs (e.g. https://) and non-PNG MIME types.
 */
export function isSignatureDataUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(DATA_URI_PREFIX) &&
    value.length > DATA_URI_PREFIX.length
  );
}

export function SignatureMark({
  src,
  className,
}: {
  src: string | null | undefined;
  className?: string;
}) {
  if (!isSignatureDataUri(src)) {
    return null;
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt="Authorised signature"
      draggable={false}
      className={cn('block h-10 w-36 object-contain object-bottom select-none pointer-events-none', className)}
    />
  );
}

