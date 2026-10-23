'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Keep the server markup and the first hydration render identical. */
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
