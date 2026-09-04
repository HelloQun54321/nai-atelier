import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 顶层错误边界：任一视图渲染抛错（如后端返回异常数据形状）时显示可恢复页面，
 * 而不是让整棵 keep-alive 组件树卸载成白屏。刷新后应用照常启动。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('界面渲染崩溃:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center dark:bg-gray-950">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">界面遇到了意外错误</h1>
          <p className="mt-2 max-w-md text-xs leading-5 text-gray-500 dark:text-gray-400">
            本地数据不受影响。可以尝试刷新页面恢复；若反复出现，请把下面的错误信息反馈给开发者。
          </p>
          <pre className="mt-4 max-w-md overflow-auto rounded-lg bg-gray-100 p-3 text-left text-meta leading-4 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{this.state.error.message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mobile-touch mt-5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500"
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
