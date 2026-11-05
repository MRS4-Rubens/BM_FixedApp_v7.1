export interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

export function createGate(): Gate {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

/** Starts `count` tasks behind one gate so they hit the database as simultaneously as the event loop allows. */
export async function runConcurrently<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const gate = createGate();
  const runs = Array.from({ length: count }, async (_unused, index) => {
    await gate.opened;
    return task(index);
  });
  gate.open();
  return Promise.allSettled(runs);
}

export function countFulfilled<T>(results: readonly PromiseSettledResult<T>[]): number {
  return results.filter((result) => result.status === 'fulfilled').length;
}

