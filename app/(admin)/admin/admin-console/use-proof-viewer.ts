'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { getClaimScreenshotUrl } from '@/lib/actions/subscriptions/get-claim-screenshot-url';
import type { ProofViewer } from './types';

export function useProofViewer() {
  const [proofViewer, setProofViewer] = useState<ProofViewer | null>(null);
  const proofRequestSeq = useRef(0);

  const openProof = useCallback(async (req: { id: string; businessName: string; paymentReference: string }): Promise<void> => {
    const seq = ++proofRequestSeq.current;
    const base = {
      requestId: req.id,
      businessName: req.businessName,
      title: `${req.businessName} - Payment Proof`,
      utr: req.paymentReference,
    } as const;
    setProofViewer({ ...base, status: 'loading' });
    const result = await getClaimScreenshotUrl({ requestId: req.id });
    if (seq !== proofRequestSeq.current) return; // closed or superseded: drop the response
    setProofViewer(
      result.success
        ? { ...base, status: 'ready', url: result.data.url, expiresInSeconds: result.data.expiresInSeconds }
        : { ...base, status: 'error', message: result.error.message },
    );
  }, []);

  const closeProof = useCallback((): void => {
    proofRequestSeq.current += 1; // invalidates in-flight requests
    setProofViewer(null); // drops the URL from state
  }, []);

  // SEC-003: Auto-expire the secure link 10 seconds before server TTL expires
  useEffect(() => {
    if (!proofViewer || proofViewer.status !== 'ready') return;

    const delayMs = Math.max(proofViewer.expiresInSeconds - 10, 1) * 1000;
    const timer = setTimeout(() => {
      setProofViewer((current) => {
        if (!current || current.status !== 'ready' || current.requestId !== proofViewer.requestId) return current;
        return {
          ...current,
          status: 'error',
          message: 'This secure link has expired. Click Try again to load a fresh one.',
        };
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [proofViewer]);

  return { proofViewer, setProofViewer, openProof, closeProof };
}

