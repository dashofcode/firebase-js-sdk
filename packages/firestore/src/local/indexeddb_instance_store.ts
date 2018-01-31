/**
 * Copyright 2018 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

///<reference path="instance_store.ts"/>
import { InstanceStore } from './instance_store';
import { SimpleDbStore, SimpleDbTransaction } from './simple_db';
import { DbInstance, DbInstanceKey } from './indexeddb_schema';
import { assert, fail } from '../util/assert';
import { PersistenceTransaction } from './persistence';
import { PersistencePromise } from './persistence_promise';
import { VisibilityState } from '../core/types';
import { Code, FirestoreError } from '../util/error';

export class IndexedDbInstanceStore implements InstanceStore {
  private visibility: VisibilityState;

  constructor(private userId: string, private instanceId: string) {}

  getAllInstances(
    transaction: PersistenceTransaction
  ): PersistencePromise<string[]> {
    let instanceIds = [];
    instancesStore(transaction)
      .loadAll()
      .next(instances => {
        instances.forEach(instance => {
          instanceIds.push(instance.instanceId);
        });
      });
    return PersistencePromise.resolve(instanceIds);
  }

  getAllForegroundInstance(
    transaction: PersistenceTransaction
  ): PersistencePromise<string[]> {
    let instanceIds = [];
    instancesStore(transaction)
      .loadAll()
      .next(instances => {
        instances.forEach(instance => {
          if (instance.visibilityState === VisibilityState.Foreground) {
            instanceIds.push(instance.instanceId);
          }
        });
      });
    return PersistencePromise.resolve(instanceIds);
  }

  setVisibility(
    transaction: PersistenceTransaction,
    visibility: VisibilityState
  ): PersistencePromise<void> {
    this.visibility = visibility;
    return this.persistState(transaction);
  }

  persistState(transaction: PersistenceTransaction): PersistencePromise<void> {
    return instancesStore(transaction).put(
      new DbInstance(
        this.userId || 'null',
        this.instanceId,
        Date.now(),
        this.visibility
      )
    );
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
