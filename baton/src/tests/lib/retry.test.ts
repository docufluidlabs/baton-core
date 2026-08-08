import { describe, it, expect, vi } from 'vitest';
import { retry } from '../../lib/retry';

describe('retry', () => {
  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();

    const result = await retry(fn, { attempts: 3, delayMs: 1, onRetry });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries until success and reports each failed attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValue('third time lucky');
    const onRetry = vi.fn();

    const result = await retry(fn, { attempts: 5, delayMs: 1, onRetry });

    expect(result).toBe('third time lucky');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always down'));

    await expect(retry(fn, { attempts: 3, delayMs: 1 })).rejects.toThrow('always down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
