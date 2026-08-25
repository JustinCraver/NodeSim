import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerLifecycle } from '../src/graph/controllerLifecycle';

class FakeGraph {
  stopCount = 0;
  destroyCount = 0;

  stop() {
    this.stopCount += 1;
  }

  destroy() {
    this.destroyCount += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('controller lifecycle', () => {
  it('mounts, unmounts, and remounts with exactly one live listener set', () => {
    const documentTarget = new EventTarget();
    let callbackCount = 0;
    const mount = () => {
      const graph = new FakeGraph();
      const lifecycle = new ControllerLifecycle(graph);
      lifecycle.listen(documentTarget, 'pointerdown', () => {
        callbackCount += 1;
      });
      return { graph, lifecycle };
    };

    const first = mount();
    documentTarget.dispatchEvent(new Event('pointerdown'));
    expect(callbackCount).toBe(1);
    first.lifecycle.destroy();

    const second = mount();
    documentTarget.dispatchEvent(new Event('pointerdown'));
    expect(callbackCount).toBe(2);
    expect(first.graph.destroyCount).toBe(1);
    second.lifecycle.destroy();
    documentTarget.dispatchEvent(new Event('pointerdown'));
    expect(callbackCount).toBe(2);
    expect(second.graph.destroyCount).toBe(1);
  });

  it('disconnects observers, removes menus, and prevents pending callbacks after destroy', () => {
    vi.useFakeTimers();
    const graph = new FakeGraph();
    const lifecycle = new ControllerLifecycle(graph);
    const observer = { disconnect: vi.fn() };
    const menu = { remove: vi.fn() };
    const callback = vi.fn();
    lifecycle.observe(observer);
    lifecycle.ownElement(menu);
    lifecycle.setTimeout(callback, 10);

    lifecycle.destroy();
    lifecycle.destroy();
    vi.runAllTimers();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(menu.remove).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
    expect(graph.stopCount).toBe(1);
    expect(graph.destroyCount).toBe(1);
  });
});
