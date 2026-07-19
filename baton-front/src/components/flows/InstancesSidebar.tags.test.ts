/**
 * InstancesSidebar instance tags — unit tests
 *
 * Covers Friday's "add tag to instances card" work (f257d15): per-card
 * free-form labels persisted to localStorage under a single key.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadInstanceTags, persistInstanceTags, TAGS_KEY } from './InstancesSidebar';

beforeEach(() => {
  localStorage.clear();
});

describe('loadInstanceTags', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadInstanceTags('inst-1')).toEqual([]);
  });

  it('returns the stored tags for the given instance', () => {
    localStorage.setItem(TAGS_KEY, JSON.stringify({ 'inst-1': ['urgent', 'finance'] }));
    expect(loadInstanceTags('inst-1')).toEqual(['urgent', 'finance']);
  });

  it('returns empty for an instance with no tags in the map', () => {
    localStorage.setItem(TAGS_KEY, JSON.stringify({ 'inst-1': ['x'] }));
    expect(loadInstanceTags('inst-2')).toEqual([]);
  });

  it('filters out non-string entries defensively', () => {
    localStorage.setItem(TAGS_KEY, JSON.stringify({ 'inst-1': ['ok', 5, null, 'fine'] }));
    expect(loadInstanceTags('inst-1')).toEqual(['ok', 'fine']);
  });

  it('returns empty when the value is not an array', () => {
    localStorage.setItem(TAGS_KEY, JSON.stringify({ 'inst-1': 'oops' }));
    expect(loadInstanceTags('inst-1')).toEqual([]);
  });

  it('returns empty on corrupted JSON instead of throwing', () => {
    localStorage.setItem(TAGS_KEY, '{not json');
    expect(loadInstanceTags('inst-1')).toEqual([]);
  });
});

describe('persistInstanceTags', () => {
  it('writes tags that round-trip through loadInstanceTags', () => {
    persistInstanceTags('inst-1', ['a', 'b']);
    expect(loadInstanceTags('inst-1')).toEqual(['a', 'b']);
  });

  it('deletes the entry when given an empty array (no map bloat)', () => {
    persistInstanceTags('inst-1', ['a']);
    persistInstanceTags('inst-1', []);
    expect(loadInstanceTags('inst-1')).toEqual([]);
    const map = JSON.parse(localStorage.getItem(TAGS_KEY) ?? '{}');
    expect(map).not.toHaveProperty('inst-1');
  });

  it('keeps other instances untouched when updating one', () => {
    persistInstanceTags('inst-1', ['a']);
    persistInstanceTags('inst-2', ['b']);
    persistInstanceTags('inst-1', ['a', 'c']);
    expect(loadInstanceTags('inst-1')).toEqual(['a', 'c']);
    expect(loadInstanceTags('inst-2')).toEqual(['b']);
  });

  it('overwrites existing tags for the same instance', () => {
    persistInstanceTags('inst-1', ['old']);
    persistInstanceTags('inst-1', ['new']);
    expect(loadInstanceTags('inst-1')).toEqual(['new']);
  });
});
