import {AsyncQueue} from '../util/async_queue';
import {VisibilityState} from '../core/types';
import {Persistence, PersistenceTransaction} from './persistence';
import {InstanceStore} from './instance_store';
import {User} from '../auth/user';
import {
  DbMutationQueue, DbMutationQueueKey, DbOwner,
  DbOwnerKey
} from './indexeddb_schema';
import {Code, FirestoreError} from '../util/error';
import {SimpleDbStore, SimpleDbTransaction} from './simple_db';
import {PersistencePromise} from './persistence_promise';
import {fail} from '../util/assert';
import {SyncEngine} from '../core/sync_engine';

export class MasterElector {

  private visibilityState : VisibilityState = VisibilityState.Unknown;
  private instanceStore : InstanceStore;
  private userId: User;
  private callbackRunning = false;

  constructor(private asyncQueue: AsyncQueue, private persistence: Persistence, private instanceId : string, public syncEngine: SyncEngine){}

  start(userId : User) : void {
    this.handleUserChange(userId).then(() => this.tryBecomeMaster()).then(() => {
      if (!this.callbackRunning) {
        this.asyncQueue.schedulePeriodically(() => this.persistState(), 4000);
        this.callbackRunning = true;
      }
    });
    this.tryBecomeMaster();
  }

  tryBecomeMaster() :  Promise<void> {
    return this.persistence.runTransaction("become master", txn => {
      return this.getCurrentMaster(txn).next((owner) => {
        if (owner && owner.ownerId == this.instanceId) {
          return PersistencePromise.resolve(true);
        } else if (!owner) {
          if (this.visibilityState === VisibilityState.Foreground) {
            return this.becomeMaster(txn).next(() => true);
          } else {
            return this.instanceStore.getAllForegroundInstance(txn).next(instances => {
              if (instances.length === 0) {
                return this.becomeMaster(txn).next(() => true);
              } else {
                return false;
              }
            })
          }
        }
      })
    }).then(master => {
      this.syncEngine.setMasterState(master);
    });

  }

  private becomeMaster(txn: PersistenceTransaction): PersistencePromise<void> {
    console.log('instance id ' + this.instanceId);
    return ownersStore(txn).put('owner', new DbOwner(this.instanceId, Date.now() + 5000));
  }

  private getCurrentMaster(txn: PersistenceTransaction): PersistencePromise<DbOwner|null> {
    return ownersStore(txn).get('owner').next(dbOwner => {
      if (dbOwner !== null && dbOwner.leaseTimestampMs <= Date.now()) {
        return PersistencePromise.resolve(dbOwner);
      } else {
        return PersistencePromise.resolve(null);
      }
    });
  }


  handleUserChange(userId: User) : Promise<void>   {
    this.instanceStore = this.persistence.getInstanceStore(userId);
    return this.persistence.runTransaction("visibility", txn => {
      return this.instanceStore.setVisibility(txn, this.visibilityState);
    });
  }

  setVisibility(visibilityState: VisibilityState)  : Promise<void>  {
    this.visibilityState = visibilityState;
    return this.persistence.runTransaction("visibility", txn => {
      return this.instanceStore.setVisibility(txn, this.visibilityState);
    });
  }

  private persistState() : Promise<void> {
    return this.persistence.runTransaction("MasterElector", txn => {
      return this.instanceStore.persistState(txn);
    });
  }
}



/**
 * Helper to get a typed SimpleDbStore for the mutationQueues object store.
 */
function ownersStore(
    txn: PersistenceTransaction
): SimpleDbStore<DbOwnerKey, DbOwner> {
  return getStore<DbOwnerKey, DbOwner>(
      txn,
      DbOwner.store
  );
}


/**
 * Helper to get a typed SimpleDbStore from a transaction.
 */
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
