import { EventLogWriter } from "./event-log.js";
export class EventBus {
    listeners = new Set();
    unsubscribes = [];
    eventLog;
    shouldDeliver;
    constructor(eventLog = new EventLogWriter(), shouldDeliver = () => true) {
        this.eventLog = eventLog;
        this.shouldDeliver = shouldDeliver;
    }
    attach(instances) {
        for (const instance of instances) {
            const unsub = instance.adapter.onEvent((event) => {
                // hard invariant borrowed from correlateRuntimeEventWithInstance:
                // an adapter may only emit events for its own driver kind
                if (event.provider !== instance.driverKind) {
                    console.error(`bus: dropped cross-driver event from ${instance.instanceId}`);
                    return;
                }
                this.publish({ ...event, providerInstanceId: instance.instanceId });
            });
            this.unsubscribes.push(unsub);
        }
    }
    publish(event) {
        // Correlation/liveness filtering belongs before both diagnostics and fanout:
        // a rejected event must not reach peer-agent waiters or any future listener.
        if (!this.shouldDeliver(event))
            return;
        try {
            this.eventLog.append(event.threadId, event);
        }
        catch {
            /* logging must never take down the stream */
        }
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch (e) {
                console.error("bus: listener threw", e);
            }
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    detachAll() {
        for (const unsub of this.unsubscribes.splice(0))
            unsub();
        this.eventLog.close();
    }
    /** Persist any buffered diagnostics without detaching provider adapters. */
    flushLog() {
        this.eventLog.flush();
    }
    prepareThreadDeletion(threadId) {
        return this.eventLog.prepareThreadDeletion(threadId);
    }
}
