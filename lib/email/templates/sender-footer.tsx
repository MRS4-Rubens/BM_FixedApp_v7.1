import * as React from 'react';
import { Text } from '@react-email/components';

export interface SenderBusinessInfo {
  readonly legalName: string;
  readonly gstin?: string | null;
  readonly city?: string | null;
  readonly contactEmail?: string | null;
  readonly phone?: string | null;
}

export function SenderFooter({
  legalName,
  gstin,
  city,
  contactEmail,
  phone,
}: SenderBusinessInfo): React.ReactElement {
  const contacts = [contactEmail, phone].filter(Boolean).join(' / ');
  const gstinPart = gstin ? ` (GSTIN ${gstin})` : '';
  const cityPart = city ? `, ${city}` : '';
  const contactPart = contacts ? ` Contact: ${contacts}.` : '';

  return (
    <Text style={footerText}>
      Sent on behalf of {legalName}
      {gstinPart}
      {cityPart}.{contactPart} Delivered via Bill Matrix. If you believe you received this in error,
      reply to this e-mail to let {legalName} know.
    </Text>
  );
}

const footerText = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '18px',
  textAlign: 'left' as const,
  marginTop: '12px',
};

export default SenderFooter;

