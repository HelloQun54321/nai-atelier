import { t, useLanguage } from '../services/i18n';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'primary' | 'danger';
    /** 保存成功才确认离开；失败取消本次跳转，让原页继续处理错误。 */
    onSave?: () => Promise<boolean>;
}

interface ConfirmDialogContextValue {
    confirmAction: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useLanguage();
    const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
    const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const savingRef = useRef(false);
    const [isSaving, setIsSaving] = useState(false);
    // 打开确认框前的焦点元素：确认框卸载后归还焦点，保证键盘用户留在触发点附近。
    const openerRef = useRef<HTMLElement | null>(null);
    // P2-17：焦点管理（取消键已有 autoFocus，此 hook 负责 Tab 圈禁与归还）。
    const dialogRef = useModalA11y<HTMLDivElement>(Boolean(options));

    const closeDialog = useCallback((confirmed: boolean) => {
        if (savingRef.current) return;
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setOptions(null);
        // 归还焦点给触发确认框的元素（若仍挂载且可聚焦）。
        const opener = openerRef.current;
        openerRef.current = null;
        if (opener && opener.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) {
            opener.focus({ preventScroll: true });
        }
        resolve?.(confirmed);
    }, []);

    useMobileHistoryLayer(Boolean(options), () => {
        if (savingRef.current) return false;
        closeDialog(false);
    }, 'confirm');

    const confirmAction = useCallback((nextOptions: ConfirmDialogOptions) => {
        if (savingRef.current) return Promise.resolve(false);
        resolverRef.current?.(false);
        // 记录打开确认框时的焦点元素：多数入口是按钮，对话框关闭后把焦点归还给它。
        const active = document.activeElement;
        openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        setOptions(nextOptions);
        return new Promise<boolean>(resolve => {
            resolverRef.current = resolve;
        });
    }, []);

    const saveAndClose = async () => {
        if (!options?.onSave || savingRef.current) return;
        savingRef.current = true;
        setIsSaving(true);
        let saved = false;
        try {
            saved = await options.onSave();
        } catch (error) {
            console.error('离开前保存失败:', error);
        } finally {
            savingRef.current = false;
            setIsSaving(false);
            closeDialog(saved);
        }
    };

    useEffect(() => {
        if (!options) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) closeDialog(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeDialog, options]);

    useEffect(() => () => resolverRef.current?.(false), []);

    const isDanger = options?.tone === 'danger' && !options?.onSave;

    return (
        <ConfirmDialogContext.Provider value={{ confirmAction }}>
            {children}
            {options && (
                <div
                    className="ui-backdrop-enter fixed inset-0 z-[1800] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
                    onClick={() => closeDialog(false)}
                >
                    <div
                        ref={dialogRef}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="confirm-dialog-title"
                        aria-describedby="confirm-dialog-description"
                        aria-busy={isSaving}
                        className={`appearance-panel ui-sheet-enter mobile-safe-bottom w-full ${options.onSave ? 'max-w-lg' : 'max-w-md'} rounded-t-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl md:p-6`}
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
                                        <circle cx="12" cy="12" r="9" strokeWidth={2} />
                                    </svg>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 id="confirm-dialog-title" className="text-lg font-bold text-gray-900 dark:text-white">{t(options.title)}</h2>
                                <p id="confirm-dialog-description" className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">
                                    {t(options.message)}
                                </p>
                            </div>
                        </div>
                        <div className={`mt-6 grid gap-3 md:flex md:justify-end ${options.onSave ? 'grid-cols-1 md:flex-wrap' : 'grid-cols-2'}`}>
                            <button
                                type="button"
                                autoFocus
                                disabled={isSaving}
                                data-agent-action="browse"
                                onClick={() => closeDialog(false)}
                                className={`mobile-touch rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-750 dark:focus:ring-offset-gray-900 ${options.onSave ? 'order-3 min-h-11 md:order-2' : ''}`}
                            >
                                {t(options.cancelLabel) || t("取消")}
                            </button>
                            <button
                                type="button"
                                disabled={isSaving}
                                data-agent-action="business"
                                onClick={() => closeDialog(true)}
                                className={`mobile-touch rounded-xl px-4 py-2 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-gray-850 ${options.onSave
                                    ? 'order-2 min-h-11 border border-red-200 text-red-600 hover:bg-red-50 focus:ring-red-500 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/30 md:order-1 md:mr-auto'
                                    : isDanger
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-500 focus:ring-red-500'
                                    : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 focus:ring-indigo-500'
                                    }`}
                            >
                                {t(options.confirmLabel) || t("确认")}
                            </button>
                            {options.onSave && <button
                                type="button"
                                disabled={isSaving}
                                aria-busy={isSaving}
                                data-agent-action="business"
                                onClick={() => { void saveAndClose(); }}
                                className="mobile-touch order-1 min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-gray-900 md:order-3"
                            >{isSaving ? t('保存中…') : t('保存并离开')}</button>}
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
