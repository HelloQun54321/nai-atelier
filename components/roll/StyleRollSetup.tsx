import GenerationTemplateEditor from '../GenerationTemplateEditor';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { getRollArtistRange, getRollPinnedArtists, validateRollExperiment, type RollExperiment, type RollTemplate } from '../../services/styleRoll';
import { ChainEditorCharacters } from '../chain/ChainEditorCharacters';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../services/appearancePreferences';
import { createBlankLabCharacter } from '../../services/labWorkspace';
import type { CharacterParams, NAIParams } from '../../types';
import { ImageActivityContext } from '../SmartImage';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

interface Props {
  initial: RollExperiment;
  enforceFreeStepLimit: boolean;
  forceEmptySeed?: boolean;
  onForceEmptySeedChange?: (enabled: boolean) => void;
  onSave: (value: RollExperiment) => Promise<void>;
  onClose: () => void;
}

export const StyleRollSetup: React.FC<Props> = props => <ImagePreviewPortal><SetupForm {...props} /></ImagePreviewPortal>;

const SetupForm: React.FC<Props> = ({ initial, enforceFreeStepLimit, forceEmptySeed = false, onForceEmptySeedChange, onSave, onClose }) => {
  useLanguage();
  const [draft, setDraft] = useState(() => structuredClone({ ...initial, drawPlan: undefined, pinnedArtists: getRollPinnedArtists(initial), rules: { ...initial.rules, ...getRollArtistRange(initial) } }));
  const active = useContext(ImageActivityContext);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const editingBusy = busy || presetBusy;
  const dialog = useModalA11y<HTMLDivElement>(active);
  const close = useMobileHistoryLayer(active, () => { if (busy || presetBusy) return false; onClose(); }, 'roll-setup');
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (active && event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, close, dialog]);
  const save = async () => {
    if (busy || presetBusy) return;
    setBusy(true); setError('');
    try {
      validateRollExperiment(draft); await onSave(draft); onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  if (!active) return null;
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('提示词与生成设置')} className="appearance-panel flex max-h-[min(820px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="shrink-0 text-base font-semibold text-gray-900 dark:text-gray-100">{t('提示词与生成设置')}</h2>
        {draft.name && <span className="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500">· {draft.name}</span>}
        <IconButton className="ml-auto" label="关闭" disabled={editingBusy} onClick={close}><X /></IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <GenerationTemplateEditor value={draft.template} onChange={template => setDraft(current => ({ ...current, template }))} disabled={busy} enforceFreeStepLimit={enforceFreeStepLimit} forceEmptySeed={forceEmptySeed} onForceEmptySeedChange={onForceEmptySeedChange} onBusyChange={setPresetBusy}
            characterSlot={<RollCharacterComposer template={draft.template} disabled={editingBusy} onChange={template => setDraft(current => ({ ...current, template }))} />} />
        </div>
      </div>
      <footer className="flex flex-none items-center justify-end gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-500">{t(error)}</p>}
        <ToolbarButton disabled={editingBusy} onClick={close}>{t('取消')}</ToolbarButton>
        <ToolbarButton tone="primary" disabled={editingBusy} onClick={() => void save()}>{t(busy ? '正在保存…' : '保存配置')}</ToolbarButton>
      </footer>
    </div>
  </div>;
};

/**
 * 角色编辑与实验室普通模式共用同一套组件与数据结构：
 * 每个角色有自己的分区正文、独立负面和位置，画师串只作用于全局 {style}，不会混进角色内容。
 */
const RollCharacterComposer: React.FC<{ template: RollTemplate; disabled: boolean; onChange: (template: RollTemplate) => void }> = ({ template, disabled, onChange }) => {
  useLanguage();
  const characters = template.characters ?? [];
  const patch = (next: Partial<RollTemplate>) => onChange({ ...template, ...next });
  // 旧记录把角色词存在 characterPrompt 上，而新编辑器只认 characters：
  // 打开配置时迁移成第一个角色，避免这段词界面上看不见、却仍被拼进出图。
  const latest = useRef(template);
  latest.current = template;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const migrated = useRef(false);
  useEffect(() => {
    const current = latest.current;
    const existing = current.characters ?? [];
    const legacyPrompt = current.characterPrompt?.trim();
    const paramCharacters = current.params?.characters ?? [];
    // 参数级角色已经参与出图（rollGenerationParams 会取用），不在这里搬动，避免改变生成内容。
    if (migrated.current || existing.length > 0 || paramCharacters.length > 0 || !legacyPrompt) return;
    migrated.current = true;
    onChangeRef.current({ ...current, characterPrompt: undefined, characters: [{ ...createBlankLabCharacter(), prompt: legacyPrompt }] });
  }, []);
  const params: NAIParams = { ...template.params, characters };
  const setParams = (next: NAIParams) => patch({ characters: next.characters ?? [] });
  const updateCharacter = (index: number, updates: Partial<CharacterParams>) => {
    if (!characters[index]) return;
    const next = [...characters];
    next[index] = { ...next[index], ...updates };
    patch({ characters: next });
  };
  return <section aria-label={t('角色')}>
    <ChainEditorCharacters
      params={params}
      setParams={setParams}
      characters={characters}
      canEdit={!disabled}
      tagAssistEnabled
      characterPresetSources={{}}
      markPresetSectionModified={() => undefined}
      markChange={() => undefined}
      addCharacter={() => { if (characters.length < 6) patch({ characters: [...characters, createBlankLabCharacter()] }); }}
      updateCharacter={updateCharacter}
      removeCharacter={index => patch({ characters: characters.filter((_, item) => item !== index) })}
      activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']}
      mobileEditorTab="character"
    />
  </section>;
};
