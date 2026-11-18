/**
 * WhatsApp Click-to-Chat Helper for Invoice BizFolio
 * 
 * Lightweight, zero-dependency helper constructing direct WhatsApp dispatch links
 * using the official https://wa.me/ protocol.
 */

import { formatPaiseAsInr } from '@/lib/money';
import { formatIstDate } from '@/lib/invoices/ist-date';

export interface WhatsAppInvoiceData {
  customerName?: string | null;
  customerPhone?: string | null;
  invoiceNumber: string;
  invoiceDate?: string | Date | null;
  dueDate?: string | Date | null;
  grandTotalPaise: number;
  businessName: string;
}

/**
 * Normalizes an Indian phone number to international E.164 format without '+' or special characters
 * e.g. "98765 43210" -> "919876543210", "+91-9876543210" -> "919876543210"
 */
export function normalizeIndianPhoneNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length === 10) {
    return `91${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly;
  }
  if (digitsOnly.length > 10) {
    return digitsOnly;
  }
  return null;
}

/**
 * Generates an official WhatsApp Click-to-Chat URL
 */
export function generateWhatsAppInvoiceUrl(data: WhatsAppInvoiceData): string {
  const phone = normalizeIndianPhoneNumber(data.customerPhone);
  const amountStr = formatPaiseAsInr(data.grandTotalPaise);

  const customerGreeting = data.customerName ? `Namaste ${data.customerName}` : 'Namaste';
  const dateFormatted = data.invoiceDate
    ? formatIstDate(data.invoiceDate, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const dueFormatted = data.dueDate
    ? formatIstDate(data.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const lines = [
    `*${customerGreeting}*,`,
    `Here are your invoice details from *${data.businessName}*:`,
    '',
    `📄 *Invoice No:* ${data.invoiceNumber}`,
    dateFormatted ? `📅 *Date:* ${dateFormatted}` : null,
    `💰 *Amount Due:* ${amountStr}`,
    dueFormatted ? `⏳ *Due Date:* ${dueFormatted}` : null,
    '',
    `Thank you for your business! 🙏`,
  ].filter((line) => line !== null);

  const message = lines.join('\n');
  const encodedText = encodeURIComponent(message);

  if (phone) {
    return `https://wa.me/${phone}?text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}
