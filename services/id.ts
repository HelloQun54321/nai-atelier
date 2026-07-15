const bytesToUuid = (bytes: Uint8Array) => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createUuid = () => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') return bytesToUuid(cryptoApi.getRandomValues(new Uint8Array(16)));

  const timestamp = Date.now().toString(16).padStart(12, '0');
  const random = Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${timestamp.slice(4)}-${timestamp.slice(0, 4)}-4${random.slice(0, 3)}-8${random.slice(3, 6)}-${random.slice(6, 18)}`;
};
