import { describe, expect, it } from 'vitest';
import { createSseParser } from './api';

describe('SSE parser', () => {
  it('parses events split across arbitrary network chunks', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const parser = createSseParser(event => events.push(event));
    parser.push('event: inter');
    parser.push('mediate\r\ndata: {"step_ix":7,');
    parser.push('"image":"abc"}\r\n\r\nevent: final\n');
    parser.push('data: {"seed":42,"image":"xyz"}\n\n');
    parser.finish();
    expect(events).toEqual([
      { event: 'intermediate', data: { step_ix: 7, image: 'abc' } },
      { event: 'final', data: { seed: 42, image: 'xyz' } },
    ]);
  });

  it('joins multiple data lines and ignores comments', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const parser = createSseParser(event => events.push(event));
    parser.push(': keepalive\ndata: first\ndata: second\n\n');
    expect(events).toEqual([{ event: 'message', data: 'first\nsecond' }]);
  });
});
