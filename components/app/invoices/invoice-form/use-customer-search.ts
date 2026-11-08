'use client';

import { useState, useEffect, useRef } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import { searchCustomerOptions } from '@/lib/actions/customers/search-customer-options';
import type { CustomerOption } from '@/lib/pickers/types';

export function useCustomerSearch({
  billingNameVal,
  setValue,
  initialCustomer,
}: {
  billingNameVal: string;
  setValue: UseFormSetValue<InvoiceDraftInput>;
  initialCustomer?: CustomerOption | null;
}) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(initialCustomer ?? null);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const customerReqIdRef = useRef(0);

  useEffect(() => {
    const query = billingNameVal.trim();
    const reqId = ++customerReqIdRef.current;
    const timer = setTimeout(async () => {
      if (!query) {
        setCustomerOptions([]);
        return;
      }
      const res = await searchCustomerOptions({ q: query });
      if (reqId === customerReqIdRef.current && res.success) {
        setCustomerOptions(res.data);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [billingNameVal]);

  const handleSelectCustomer = (cust: CustomerOption) => {
    setSelectedCustomer(cust);
    setValue('customer_id', cust.id);
    setValue('billing_name', cust.name);
    setValue('billing_gstin', cust.gstin || '');
    setValue('place_of_supply_state_code', cust.state_code);
    setIsSuggestionsOpen(false);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue('billing_name', val);
    setValue('customer_id', ''); // Reset customer_id for ad-hoc customer typing
    setSelectedCustomer(null);
    setIsSuggestionsOpen(true);
  };

  return {
    selectedCustomer,
    setSelectedCustomer,
    customerOptions,
    isSuggestionsOpen,
    setIsSuggestionsOpen,
    handleSelectCustomer,
    handleNameChange,
  };
}
