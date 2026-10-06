import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CaseStore, StoreSnapshot } from '../state/store';
import type { Runner, RunSnapshot } from '../state/runner';

export interface AppServices {
  store: CaseStore;
  runner: Runner;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}

export function useCase(): StoreSnapshot {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useRun(): RunSnapshot {
  const { runner } = useServices();
  return useSyncExternalStore(runner.subscribe, runner.getSnapshot);
}
