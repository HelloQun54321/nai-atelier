import { native, writeBlob, base64ToBytes } from './native';

export function initMobileClipboard() {
  if (typeof globalThis.ClipboardItem === 'undefined') {
    (globalThis as any).ClipboardItem = class {
      types: string[];
      constructor(private values: Record<string, Blob | Promise<Blob>>) { this.types = Object.keys(values); }
      async getType(type: string) { if (!this.values[type]) throw new Error('剪贴板内容类型不存在'); return this.values[type]; }
    };
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    async write(items: ClipboardItem[]) {
      const item = items.find(item => item.types.includes('image/png'));
      if (!item) throw new Error('剪贴板不含 PNG 图片');
      const path = await writeBlob(await item.getType('image/png'), `share/${crypto.randomUUID()}.png`);
      await native.share({ action:'copy', path, mime:'image/png' });
    },
    async read() { const value=await native.clipboard({action:'read'});return [new ClipboardItem({[value.mime]:new Blob([base64ToBytes(value.data)],{type:value.mime})})]; },
    async writeText(value: string) { await native.clipboard({action:'text',value}); },
    async readText() { return (await native.clipboard({action:'readText'})).value; },
  } });
}
