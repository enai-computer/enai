import { describe, it, expect, vi } from 'vitest';
import { BrowserEventBus } from '../BrowserEventBus';

describe('BrowserEventBus', () => {
  it('should register and emit events', () => {
    const eventBus = new BrowserEventBus();
    const listener = vi.fn();
    const eventName = 'test-event';
    const payload = { data: 'test-payload' };

    eventBus.on(eventName, listener);
    eventBus.emit(eventName, payload);

    expect(listener).toHaveBeenCalledWith(payload);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should allow multiple listeners for the same event', () => {
    const eventBus = new BrowserEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const eventName = 'test-event';

    eventBus.on(eventName, listener1);
    eventBus.on(eventName, listener2);
    eventBus.emit(eventName);

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });

  it('should remove a listener', () => {
    const eventBus = new BrowserEventBus();
    const listener = vi.fn();
    const eventName = 'test-event';

    eventBus.on(eventName, listener);
    eventBus.off(eventName, listener);
    eventBus.emit(eventName);

    expect(listener).not.toHaveBeenCalled();
  });

  it('should remove all listeners for an event', () => {
    const eventBus = new BrowserEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const eventName = 'test-event';

    eventBus.on(eventName, listener1);
    eventBus.on(eventName, listener2);
    eventBus.removeAllListeners(eventName);
    eventBus.emit(eventName);

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it('should remove all listeners if no event name is provided', () => {
    const eventBus = new BrowserEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    eventBus.on('event1', listener1);
    eventBus.on('event2', listener2);
    eventBus.removeAllListeners();
    eventBus.emit('event1');
    eventBus.emit('event2');

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });
});
