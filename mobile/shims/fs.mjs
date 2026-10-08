import { native, base64ToBytes, bytesToBase64, writeBlob } from '../native';
import { Buffer } from 'buffer';
import sources from 'mobile:agent-sources';

const normalize = path => {
  const name = String(path).replace(/^\/+/,'');
  if (!name || name.split('/').includes('..')) throw new Error('文件路径越界');
  return name;
};
const file = (action, path, options = {}) => native.file({ action, path: normalize(path), ...options }).catch(error => { for(const code of ['ENOENT','EEXIST'])if(error.message.includes(code))error.code=code; throw error; });
export const readFileSync = path => {
  const url = String(path), name = Object.keys(sources).find(name => url.endsWith('/' + name) || url === name || url.endsWith('/' + name.split('/').pop()));
  if (!name) throw new Error('Android 未打包此工程文件');
  return sources[name];
};
export const mkdir = path => file('mkdir', path);
export const readFile = async (path, encoding) => {
  if (String(path).startsWith('public/tag-data/')) return Buffer.from(await (await fetch('/tag-data/' + String(path).slice(16))).arrayBuffer()).toString(encoding || 'utf8');
  const result = await file('read', path); const value = Buffer.from(base64ToBytes(result.data)); return encoding ? value.toString(encoding) : value;
};
export const writeFile = async (path, value, options) => { const bytes = Buffer.from(value, typeof options === 'string' ? options : options?.encoding); return writeBlob(new Blob([bytes]), normalize(path), false); };
export const appendFile = async (path, value) => file('write', path, { append: true, data: bytesToBase64(Buffer.from(value)) });
export const rename = (path, to) => file('rename', path, { to: normalize(to) });
export const unlink = path => file('delete', path);
export const realpath = async path => {await stat(path);return '/' + normalize(path);};
export const stat = async path => { const value = await file('stat', path); return { size: value.size, mtime: new Date(value.modified), isDirectory: () => value.directory, isFile: () => !value.directory }; };
export const readdir = async (path, options) => {
  const result = await file('list', path); return result.items.map(item => options?.withFileTypes ? { name: item.name, isDirectory: () => item.directory, isFile: () => !item.directory, isSymbolicLink: () => false } : item.name);
};
export const open = async (path, flags = 'r') => {
  if(flags==='wx'){await file('create',path);return {writeFile:value=>writeFile(path,value),async sync(){},async close(){}};}
  const info=await stat(path);if(info.size>30*1024*1024)throw new Error('本地创作文件超过 30 MB');
  const bytes = await readFile(path); return { stat: () => stat(path), async readFile(){return bytes;},async read(buffer, offset, length, position) { const value = bytes.subarray(position, position + length); buffer.set(value, offset); return { bytesRead: value.length }; }, async close() {} };
};
