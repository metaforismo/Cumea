/** Serializes destructive provider-fleet replacement while invalidating all
 * turn snapshots synchronously at reload admission time. */
export class ProviderFleetGate {
    generation = 0;
    ready = true;
    tail = Promise.resolve();
    snapshot() {
        const generation = this.generation;
        return { generation, isCurrent: () => this.ready && this.generation === generation };
    }
    reload(operation) {
        this.generation += 1;
        this.ready = false;
        const generation = this.generation;
        const lease = { generation, isLatest: () => this.generation === generation };
        const run = this.tail.then(async () => {
            const result = await operation(lease);
            if (lease.isLatest())
                this.ready = true;
            return result;
        });
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
