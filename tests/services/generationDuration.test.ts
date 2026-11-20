import { describe, expect, it } from 'vitest';
import { formatGenerationDuration, readGenerationDurationMs } from '../../services/generationDuration';

describe('出口生图用时格式化与读取', () => {
  it('正确格式化秒与分秒，非法或非正值返回空串', () => {
    expect(formatGenerationDuration(undefined)).toBe('');
    expect(formatGenerationDuration(null)).toBe('');
    expect(formatGenerationDuration(0)).toBe('');
    expect(formatGenerationDuration(-500)).toBe('');
    expect(formatGenerationDuration(Number.NaN)).toBe('');
    expect(formatGenerationDuration(42)).toBe('0.1s');
    expect(formatGenerationDuration(6420)).toBe('6.4s');
    expect(formatGenerationDuration(72340)).toBe('1m 12.3s');
  });

  it('优先读取顶层 generationDurationMs，缺失时回退 params._local_generation_duration_ms', () => {
    expect(readGenerationDurationMs(null)).toBeUndefined();
    expect(readGenerationDurationMs({ params: {} })).toBeUndefined();
    expect(readGenerationDurationMs({ params: { _local_generation_duration_ms: 4850 } })).toBe(4850);
    expect(readGenerationDurationMs({ generationDurationMs: 5120, params: { _local_generation_duration_ms: 4850 } })).toBe(5120);
  });
});
