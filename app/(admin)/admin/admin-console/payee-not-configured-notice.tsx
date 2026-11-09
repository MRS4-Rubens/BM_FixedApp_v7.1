export function PayeeNotConfiguredNotice({ issue }: { issue: string | null | undefined }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300/60 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <p className="font-bold">Payee details are not configured.</p>
      <p className="mt-1 text-xs leading-relaxed">
        Customers cannot see payment instructions on /checkout until the server environment is fixed.
        {issue ? ` Affected variables: ${issue}.` : ''}
      </p>
    </div>
  );
}

