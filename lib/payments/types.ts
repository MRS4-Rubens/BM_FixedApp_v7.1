export type UpiPaymentOptionKey =
  | 'essentials:monthly'
  | 'essentials:yearly'
  | 'professional:monthly'
  | 'professional:yearly';

export interface UpiPaymentOption {
  amountPaise: number;
  uri: string;
  qrDataUrl: string;
}

export type UpiPaymentsMap = Record<UpiPaymentOptionKey, UpiPaymentOption>;

