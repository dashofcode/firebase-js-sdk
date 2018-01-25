///<reference path="instance_store.ts"/>
import {InstanceStore} from './instance_store';
import {SimpleDbStore, SimpleDbTransaction} from './simple_db';
import {DbInstance, DbInstanceKey} from './indexeddb_schema';
import {assert, fail} from '../util/assert';
import {PersistenceTransaction} from './persistence';
import {PersistencePromise} from './persistence_promise';
import {VisibilityState} from '../core/types';
import {Code, FirestoreError} from '../util/error';

export class IndexedDbInstanceStore implements InstanceStore {
  private visibility: VisibilityState;

  constructor(private userId: string, private instanceId: string) {}

  getAllInstances(transaction: PersistenceTransaction): PersistencePromise<string[]> {
    let instanceIds = [];
    instancesStore(transaction).loadAll().next(instances => {
      instances.forEach(instance => {
        instanceIds.push(instance.instanceId);
      })
    });
    return PersistencePromise.resolve(instanceIds);
  }

  getAllForegroundInstance(transaction: PersistenceTransaction): PersistencePromise<string[]> {
    let instanceIds = [];
    instancesStore(transaction).loadAll().next(instances => {
      instances.forEach(instance => {
        if (instance.visibilityState === VisibilityState.Foreground) {
          instanceIds.push(instance.instanceId);
        }
      })
    });
    return PersistencePromise.resolve(instanceIds);
  }

  setVisibility(transaction: PersistenceTransaction, visibility: VisibilityState) : PersistencePromise<void> {
    this.visibility = visibility;
    return this.persistState(transaction);
  }


  persistState(transaction: PersistenceTransaction) : PersistencePromise<void> {
    return instancesStore(transaction).put(new DbInstance(this.userId, this.instanceId, Date.now(), this.visibility));
  }
}

function instancesStore(
    txn: PersistenceTransaction
): SimpleDbStore<DbInstanceKey, DbInstance> {
  return getStore<DbInstanceKey, DbInstance>(txn, DbInstance.store);
}

function getStore<KeyType extends IDBValidKey, ValueType>(
    txn: PersistenceTransaction,
    store: string
): SimpleDbStore<KeyType, ValueType> {
  if (txn instanceof SimpleDbTransaction) {
    return txn.store<KeyType, ValueType>(store);
  } else {
    return fail('Invalid transaction object provided!');
  }
}