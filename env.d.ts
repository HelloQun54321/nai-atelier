// 构建期常量声明：值由 vite.config.ts 的 define 从 package.json 的 version 注入，
// 版本号唯一来源是 package.json，运行时展示一律使用该常量，禁止硬编码版本字符串。
declare const __APP_VERSION__: string;
