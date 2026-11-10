import { describe, expect, it } from 'vitest';
import { referenceDisplayName } from '../../services/referenceNaming';

const at = new Date(2026, 10, 11, 5, 38, 0);
const stamp = (fallback = '精准参考') => referenceDisplayName('', fallback, at);

describe('参考资料入库命名', () => {
  it('哈希、UUID、纯数字与 blob 文件名换成可读时间名', () => {
    for (const name of ['064d24f7ce46161dfa9a1b2c3d4e5f60.png', '9f8b7c6d-1234-4abc-9def-0123456789ab.png', '1700000000000.png', 'blob', ''])
      expect(referenceDisplayName(name, '精准参考', at)).toBe('精准参考 11-11 05:38');
  });

  it('可读文件名原样保留，只截到官方 100 字限制', () => {
    expect(referenceDisplayName('clipboard.png', '精准参考', at)).toBe('clipboard');
    expect(referenceDisplayName('芙宁娜 立绘.jpg', '精准参考', at)).toBe('芙宁娜 立绘');
    expect(referenceDisplayName(`${'z'.repeat(140)}.png`, '精准参考', at)).toHaveLength(100);
  });

  it('回退名跟随资料库类型，时间按本地时区补零', () => {
    expect(stamp('氛围参考')).toBe('氛围参考 11-11 05:38');
    expect(referenceDisplayName('', 'x', new Date(2026, 0, 2, 9, 5))).toBe('x 01-02 09:05');
  });
});
