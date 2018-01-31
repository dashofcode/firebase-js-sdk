import { GarbageSource } from './garbage_source';
import { PersistenceTransaction } from './persistence';
import { PersistencePromise } from './persistence_promise';
import { VisibilityState } from '../core/types';

export interface InstanceStore {
  getAllInstances(
    transaction: PersistenceTransaction
  ): PersistencePromise<string[]>;
  getAllForegroundInstance(
    transaction: PersistenceTransaction
  ): PersistencePromise<string[]>;
  setVisibility(
    transaction: PersistenceTransaction,
    visibility: VisibilityState
  ): PersistencePromise<void>;
  persistState(transaction: PersistenceTransaction): PersistencePromise<void>;
}
