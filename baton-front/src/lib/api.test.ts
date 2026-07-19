import { describe, it, expect } from 'vitest';
import { ApiError } from './api';

describe('ApiError', () => {
  it('has correct status and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
  });

  it('name is ApiError', () => {
    const err = new ApiError(500, 'Server error');
    expect(err.name).toBe('ApiError');
  });

  it('is instanceof Error', () => {
    const err = new ApiError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
  });
});
