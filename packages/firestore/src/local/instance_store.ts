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
