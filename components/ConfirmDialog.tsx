import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'primary' | 'danger';
}

interface ConfirmDialogContextValue {
    confirmAction: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
    const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

    const closeDialog = useCallback((confirmed: boolean) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setOptions(null);
        resolve?.(confirmed);
    }, []);

    const confirmAction = useCallback((nextOptions: ConfirmDialogOptions) => {
        resolverRef.current?.(false);
        setOptions(nextOptions);
        return new Promise<boolean>(resolve => {
            resolverRef.current = resolve;
        });
    }, []);

    useEffect(() => {
        if (!options) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeDialog(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeDialog, options]);

    useEffect(() => () => resolverRef.current?.(false), []);

    const isDanger = options?.tone === 'danger';

    return (
        <ConfirmDialogContext.Provider value={{ confirmAction }}>
            {children}
            {options && (
                <div
                    className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
                    onClick={() => closeDialog(false)}
                >
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="confirm-dialog-title"
                        aria-describedby="confirm-dialog-description"
                        className="mobile-safe-bottom w-full max-w-md rounded-t-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-850 md:rounded-2xl md:p-6"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-start gap-4">
                            <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-full ${isDanger
                                ? 'bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                                : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                                }`}>
                                {isDanger ? (
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.007v.008H12V16.5z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.3 3.7 2.6 17a2 2 0 0 0 1.73 3h15.34a2 2 0 0 0 1.73-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
                                    </svg>
                                ) : (
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 9a3.75 3.75 0 1 1 6.55 2.5c-.9.95-1.8 1.45-1.8 2.75M12 18h.01" />
                                        <circle cx="12" cy="12" r="9" strokeWidth="2" />
                                    </svg>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 id="confirm-dialog-title" className="text-lg font-bold text-gray-900 dark:text-white">{options.title}</h2>
                                <p id="confirm-dialog-description" className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">
                                    {options.message}
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 grid grid-cols-2 gap-3 md:flex md:justify-end">
                            <button
                                type="button"
                                autoFocus
                                onClick={() => closeDialog(false)}
                                className="mobile-touch rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-850"
                            >
                                {options.cancelLabel || '取消'}
                            </button>
                            <button
                                type="button"
                                onClick={() => closeDialog(true)}
                                className={`mobile-touch rounded-xl px-4 py-2 text-sm font-bold text-white shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-850 ${isDanger
                                    ? 'bg-red-600 shadow-red-600/20 hover:bg-red-500 focus:ring-red-500'
                                    : 'bg-indigo-600 shadow-indigo-600/20 hover:bg-indigo-500 focus:ring-indigo-500'
                                    }`}
                            >
                                {options.confirmLabel || '确认'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmDialogContext.Provider>
    );
};

export const useConfirmDialog = () => {
    const context = useContext(ConfirmDialogContext);
    if (!context) throw new Error('useConfirmDialog must be used inside ConfirmDialogProvider');
    return context.confirmAction;
};
