export interface ProviderFleetLease {
  generation: number;
  isCurrent: () => boolean;
}

export interface ProviderFleetReloadLease {
  generation: number;
  isLatest: () => boolean;
}

/** Serializes destructive provider-fleet replacement while invalidating all
 * turn snapshots synchronously at reload admission time. */
export class ProviderFleetGate {
  private generation = 0;
  private ready = true;
  private tail: Promise<void> = Promise.resolve();

  snapshot(): ProviderFleetLease {
    const generation = this.generation;
    return { generation, isCurrent: () => this.ready && this.generation === generation };
  }

  reload<T>(operation: (lease: ProviderFleetReloadLease) => Promise<T>): Promise<T> {
    this.generation += 1;
    this.ready = false;
    const generation = this.generation;
    const lease = { generation, isLatest: () => this.generation === generation };
    const run = this.tail.then(async () => {
      const result = await operation(lease);
      if (lease.isLatest()) this.ready = true;
      return result;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
