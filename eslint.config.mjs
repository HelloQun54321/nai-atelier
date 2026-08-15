// ESLint 9 扁平配置：只开与正确性相关的规则（TS 推荐 + react-hooks），
// 风格类规则一概不管，避免与现有代码风格冲突。规则说明见 AGENTS.md。
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'local-data/**', 'local-cache/**', 'public/**', 'browser-extension/**', '.wrangler/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 本库大量"刻意保留的函数参数"（接口形状对齐），只检查未使用的局部变量
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 本库惯用 `cond && effect()` 与短路语句风格
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 存量代码有约 60 处 any，逐步收敛；先降为 warn 不阻塞提交
      '@typescript-eslint/no-explicit-any': 'warn',
      // 27 处存量依赖告警是真实风险项，先以 warn 呈现，逐个人工确认后收敛为 error
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Node 侧脚本（网关、桥接、Agent）不是 React 组件，hooks 规则不适用
    files: ['scripts/**/*.mjs', '*.mjs'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
);
