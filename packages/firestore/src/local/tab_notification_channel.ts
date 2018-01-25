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

import { Code, FirestoreError } from '../util/error';
import {
  BatchId, MutationBatchStatus, OnlineState, TargetId,
  VisibilityState, WatchTargetStatus
} from '../core/types';
import {assert, fail} from '../util/assert';
import { AsyncQueue } from '../util/async_queue';
import { debug } from '../util/log';
import { StringMap } from '../util/types';
import { SyncEngine } from '../core/sync_engine';
import {SimpleDbStore, SimpleDbTransaction} from './simple_db';
import {DbInstance, DbInstanceKey} from './indexeddb_schema';
import {PersistenceTransaction} from './persistence';

/**
 * Refresh the contents of LocalStorage every four seconds.
 */
const LCOAL_STORAGE_REFRESH_INTERVAL_MS: number = 4000;

// Prefix keys used in WebStorage.
const VISIBILITY_PREFIX = 'visibility';

const LOG_TAG = 'TabNotificationChannel';


const INSTANCE_KEY_RE = /fs_instances_(\w*)_(\w*)/.compile();


const MUTATION_KEY_RE = /fs_mutations_(\w*)_(\w*)/.compile();


const TARGET_KEY_RE = /fs_targets_(\w*)_(\w*)/.compile();

/**
 * WebStorage of the Firestore client. Firestore uses WebStorage for cross-tab
 * notifications and to persist the metadata state of each tab. WebStorage is
 * used to perform leader election and to inform other tabs about changes in the
 * IndexedDB-backed persistence layer.
 */
export interface TabNotificationChannel {
  start(): void;
  shutdown(): void;

  addMutation(batchId: BatchId): void;
  rejectMutation(batchId: BatchId, error: FirestoreError): void;
  acknowledgeMutation(batchId: BatchId): void;

  addQuery(targetId: TargetId): void;
  removeQuery(targetId: TargetId): void;
  rejectQuery(targetId: TargetId, err: FirestoreError): void;
  updateQuery(updatedTargetIds: TargetId[]): void;

}

type InstanceId = string;


class InstanceRow {
  instanceId: InstanceId;
  updateTime: Date;
  activeTargets: Set<TargetId>;
  pendingBatches: Set<BatchId>;
}

class MutationUpdateRow {
  batchId: BatchId;
  updateTime: Date;
  status: MutationBatchStatus;
  err?: FirestoreError;
}

class WatchTargetRow {
  updateTime: Date;
  targetId: TargetId;
  status: WatchTargetStatus;
  err?: FirestoreError;
}


/**
 * `LocalStorageNotificationChannel` uses LocalStorage as the backing store for
 * the TabNotificationChannel class.
 *
 * Once started, LocalStorageNotificationChannel will rewrite its contents to
 * LocalStorage every four seconds. Other clients may disregard its state after
 * five seconds of inactivity.
 */
export class LocalStorageNotificationChannel implements TabNotificationChannel {
  private localStorage: Storage;
  private visibilityState: VisibilityState = VisibilityState.Unknown;
  private started = false;

  private knownInstances: { [key: string]: InstanceRow } = {};



  private instanceState: InstanceRow;

  private primary = false;

  constructor(
    private persistenceKey: string,
    private instanceId: string,
    private asyncQueue: AsyncQueue,
    private syncEngine: SyncEngine
  ) {
    this.instanceKey = this.buildKey(
      VISIBILITY_PREFIX,
      this.persistenceKey,
      this.instanceId
    );
  }

  /** Returns true if LocalStorage is available in the current environment. */
  static isAvailable(): boolean {
    return typeof window !== 'undefined' && window.localStorage != null;
  }

  start(): void {
    if (!LocalStorageNotificationChannel.isAvailable()) {
      throw new FirestoreError(
        Code.UNIMPLEMENTED,
        'LocalStorage is not available on this platform.'
      );
    }

    assert(!this.started, 'LocalStorageNotificationChannel already started');

    this.localStorage = window.localStorage;
    this.started = true;
  //  this.initInstances();
  //   this.persistInstanceState();
  //   this.scheduleRefresh();

    window.addEventListener('storage', (e) =>  this.onUpdate(e.key, e.newValue));
  }

  shutdown(): void {
    assert(
      this.started,
      'LocalStorageNotificationChannel.shutdown() called when not started'
    );
    this.started = false;
  }

  addMutation(batchId: BatchId): void {
    this.instanceState.pendingBatches.add(batchId);
    this.persistMutation(batchId, MutationBatchStatus.PENDING);
    this.persistInstanceState();
  }

  rejectMutation(batchId: BatchId, error: FirestoreError): void {
    this.persistMutation(batchId, MutationBatchStatus.REJECTED, error);
    this.instanceState.pendingBatches.delete(batchId);
  }

  acknowledgeMutation(batchId: BatchId): void {
    this.instanceState.pendingBatches.delete(batchId);
    this.persistMutation(batchId, MutationBatchStatus.ACKNOWLEDGED);
    this.persistInstanceState();
  }

  addQuery(targetId: TargetId): void {
    // this.instanceState.activeTargets.add(targetId);
    // this.persistInstanceState();
  }

  removeQuery(targetId: TargetId): void {
   // this.currentState.activeTargets.delete(targetId);
  }

  rejectQuery(targetId: TargetId, error: FirestoreError): void {
   // this.rejectedTargetIds[targetId] = { date: new Date(), error };
  }

  updateQuery(updatedTargetIds: TargetId[]): void {
    // for (const targetId of updatedTargetIds) {
    //   this.updatedTargetIds[targetId] = new Date();
    // }
  }

  private static getInstanceRow(key: string, jsonValue: string) : InstanceRow | null {
    const keyComponents = key.match(INSTANCE_KEY_RE);

    if (keyComponents == null) {
      return null;
    }

    const value = JSON.parse(jsonValue);
    value.pendingBatches = new Set<BatchId>(value.pendingBatches);

    return value as InstanceRow;
  }

  private static getMutationBatchRow(key: string, jsonValue: string) : MutationUpdateRow | null {
    const keyComponents = key.match(MUTATION_KEY_RE);

    if (keyComponents == null) {
      return null;
    }

    const value = JSON.parse(jsonValue);
    value.status = MutationBatchStatus[value.status];

    return value as MutationUpdateRow;
  }

  private static getTargetUpdateRow(key: string, jsonValue: string) : WatchTargetRow | null {
    const keyComponents = key.match(TARGET_KEY_RE);

    if (keyComponents == null) {
      return null;
    }

    const value = JSON.parse(jsonValue);
    return value as WatchTargetRow;
  }

  // Callback for the LocalStorage observer. 'key' is the key that changed, and
  // value is the new value.
  private onUpdate(key: string, value: string) {
    let instanceRow = LocalStorageNotificationChannel.getInstanceRow(key, value);
    if (instanceRow) {
      instanceRow.pendingBatches.forEach(batchId => {
        this.syncEngine.updateBatch(batchId, MutationBatchStatus.PENDING);
      });
      // for (const targetId of instanceRow.activeTargets) {
      //   this.syncEngine.updateWatch(targetId, WatchTargetStatus.PENDING);
      // }
      this.knownInstances[instanceRow.instanceId] = instanceRow;
    }

    if (!this.primary) {
      let mutationRow = LocalStorageNotificationChannel.getMutationBatchRow(key, value);
      if (mutationRow) {
        this.syncEngine.updateBatch(mutationRow.batchId, mutationRow.status, mutationRow.err);
      } else {
        let targetRow = LocalStorageNotificationChannel.getTargetUpdateRow(key, value);
        if (targetRow) {
          this.syncEngine.updateWatch(targetRow.targetId, targetRow.status, targetRow.err);
        }
      }
    }
  }

  // private scheduleRefresh(): void {
  //   this.asyncQueue.schedulePeriodically(() => {
  //     if (this.started) {
  //       this.persistVisibilityState();
  //     }
  //     return Promise.resolve();
  //   }, LCOAL_STORAGE_REFRESH_INTERVAL_MS);
  // }

  private instanceKey: string;

  /** Persists the entire known state. */
  private persistInstanceState(): void {
    assert(this.started, 'LocalStorageNotificationChannel not started');
    debug(LOG_TAG, 'Persisting state in LocalStorage');
    this.localStorage[this.instanceKey] = this.buildValue({
      pendingBatches: JSON.stringify(Array.from(this.instanceState.pendingBatches))
    });
    // this.tryBecomeMaster();
  }

  /** Assembles a key for LocalStorage */
  private buildKey(...elements: string[]): string {
    elements.forEach(value => {
      assert(value.indexOf('_') === -1, "Key element cannot contain '_'");
    });

    return "fs_" + elements.join('_');
  }

  /** JSON-encodes the provided value and its current update time. */
  private buildValue(data: StringMap): string {
    const persistedData = Object.assign({ updateTime: Date.now() }, data);
    return JSON.stringify(persistedData);
  }

  // private tryBecomeMaster() {
  //   this.masterRow = localStorage['master'];
  //
  //   if (!this.isExpired(this.masterRow.updateTime)) {
  //     return;
  //   }
  //
  //   if (this.visibilityState !== VisibilityState.Foreground) {
  //     Object.keys(this.knownInstances).forEach(key => {
  //       if (
  //         this.knownInstances[key].visibilityState ===
  //         VisibilityState.Foreground
  //       ) {
  //         return; // Someone else should become master
  //       }
  //     });
  //   }
  //
  //   // TODO: Come up with a clever way to solve this race, or move the
  //   // MasterRow to IndexedDB.
  //   // set master row
  //   // read master row
  //   this.primary = this.masterRow.instanceId === this.instanceId;
  // }

  private persistMutation(batchId: BatchId, status: MutationBatchStatus, error?: FirestoreError) {
    this.localStorage[this.buildKey("mutations", String(batchId))] = this.buildValue({
      batchId: String(batchId),
      status: MutationBatchStatus[status]
    });
  }

}
