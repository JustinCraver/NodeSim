type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type Removable = { remove: () => void };
type ObserverLike = { disconnect: () => void };
type DestroyableGraph = { stop: (clearQueue?: boolean) => unknown; destroy: () => unknown };

export class ControllerLifecycle {
  private readonly cleanups: Array<() => void> = [];
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly animationFrames = new Set<number>();
  private destroyed = false;

  constructor(private readonly graph: DestroyableGraph) {}

  listen(
    target: EventTargetLike,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  ownElement(element: Removable) {
    this.cleanups.push(() => element.remove());
  }

  observe(observer: ObserverLike) {
    this.cleanups.push(() => observer.disconnect());
  }

  setTimeout(callback: () => void, delay: number) {
    const timeout = globalThis.setTimeout(() => {
      this.timeouts.delete(timeout);
      if (!this.destroyed) {
        callback();
      }
    }, delay);
    this.timeouts.add(timeout);
    return timeout;
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      return undefined;
    }
    const frame = globalThis.requestAnimationFrame((time) => {
      this.animationFrames.delete(frame);
      if (!this.destroyed) {
        callback(time);
      }
    });
    this.animationFrames.add(frame);
    return frame;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.timeouts.forEach((timeout) => globalThis.clearTimeout(timeout));
    this.timeouts.clear();
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      this.animationFrames.forEach((frame) => globalThis.cancelAnimationFrame(frame));
    }
    this.animationFrames.clear();
    for (let index = this.cleanups.length - 1; index >= 0; index -= 1) {
      this.cleanups[index]();
    }
    this.cleanups.length = 0;
    this.graph.stop(true);
    this.graph.destroy();
  }
}
