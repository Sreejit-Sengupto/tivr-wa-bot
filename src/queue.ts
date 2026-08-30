type QueueTask<T> = {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

/**
 * Outbound Drip Queue
 * Ensures outbound messages are rate-limited to 1 message every `intervalMs` (default: 4000ms).
 */
export class DripQueue {
  private queue: QueueTask<any>[] = [];
  private isProcessing: boolean = false;
  private readonly intervalMs: number;
  private lastSentTimestamp: number = 0;

  constructor(intervalMs: number = 4000) {
    this.intervalMs = intervalMs;
  }

  /**
   * Enqueues an outbound sending task and returns a Promise
   * that resolves when the message has been dispatched according to the drip rate.
   */
  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute: task, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Returns current count of queued outbound messages.
   */
  public getPendingCount(): number {
    return this.queue.length;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      const now = Date.now();
      const timeSinceLast = now - this.lastSentTimestamp;
      const waitTime = Math.max(0, this.intervalMs - timeSinceLast);

      if (waitTime > 0) {
        console.log(`[Drip Queue] Rate-limiting outbound send. Waiting ${(waitTime / 1000).toFixed(1)}s (Queue: ${this.queue.length + 1} pending)...`);
        await new Promise((res) => setTimeout(res, waitTime));
      }

      try {
        const result = await item.execute();
        this.lastSentTimestamp = Date.now();
        item.resolve(result);
      } catch (err) {
        this.lastSentTimestamp = Date.now();
        item.reject(err);
      }
    }

    this.isProcessing = false;
  }
}

export const outboundQueue = new DripQueue(4000);
