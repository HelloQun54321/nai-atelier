import React, { useEffect, useState } from 'react';
import { Dice5 } from 'lucide-react';
import { PromptLibraryWorkspace } from './PromptLibraryAccess';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { ChainEditorParams } from './ChainEditorParams';
import { ToolbarButton, ToolbarSelect } from './DesignSystem';
import { useConfirmDialog } from './ConfirmDialog';
import { mergePromptFields } from '../services/promptUtils';
import { t, useLanguage } from '../services/i18n';
import { createDefaultRollTemplate, type RollTemplate, type RollPreset } from '../services/styleRoll';
import { loadRollPresets, saveRollPreset, deleteRollPreset } from '../services/styleRollApi';
import { useNaiRuntime } from '../services/naiRuntime';
import { createUuid } from '../services/id';

interface Props {
  value: RollTemplate; onChange: (value: RollTemplate) => void; disabled?: boolean; readOnly?: boolean;
  enforceFreeStepLimit?: boolean; recommendedTemplate?: RollTemplate; modelFilter?: (id: string) => boolean;
  onBusyChange?: (busy: boolean) => void;
}
const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

export default function GenerationTemplateEditor({ value, onChange, disabled = false, readOnly = false, enforceFreeStepLimit = true, recommendedTemplate, modelFilter, onBusyChange }: Props) {
  useLanguage();
  const runtime = useNaiRuntime();
  const confirm = useConfirmDialog();
  const [presets, setPresets] = useState<RollPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetsReady, setPresetsReady] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState('');
  const editingBusy = disabled || presetBusy;
  const selectedPreset = presets.find(preset => preset.id === presetId);
  const loadPresets = async () => {
    setPresetLoading(true); setPresetsReady(false); setPresetError('');
    try { setPresets(await loadRollPresets()); setPresetsReady(true); }
    catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetLoading(false); }
  };
  useEffect(() => { void loadPresets(); }, []);
  useEffect(() => { onBusyChange?.(presetBusy); }, [presetBusy, onBusyChange]);
  const savePreset = async (update: boolean) => {
    if (disabled || presetBusy || presetLoading || !presetsReady || !presetName.trim() || (update && !selectedPreset)) return;
    setPresetBusy(true); setPresetError('');
    const now = Date.now();
    const snapshot: RollPreset = { ...(update ? selectedPreset! : { id: createUuid(), revision: 0, createdAt: now }),
      name: presetName.trim(), template: structuredClone(value), updatedAt: now };
    try {
      if (update && !await confirm({ title: t('更新这个生成预设？'), message: t('将用当前提示词与参数覆盖共用预设“{0}”，已有记录和配置保持不变。', [selectedPreset!.name]), confirmLabel: t('确认更新') })) return;
      const saved = await saveRollPreset(snapshot);
      setPresets(current => [...current.filter(preset => preset.id !== saved.id), saved]);
      setPresetId(saved.id); setPresetName(saved.name);
    } catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetBusy(false); }
  };
  const deletePreset = async () => {
    if (!selectedPreset || disabled || presetBusy || !presetsReady) return;
    setPresetBusy(true); setPresetError('');
    try {
      if (!await confirm({ title: t('删除这个生成预设？'), message: t('将删除共用预设“{0}”，已有记录和配置保持不变。', [selectedPreset.name]), confirmLabel: t('确认删除'), tone: 'danger' })) return;
      await deleteRollPreset(selectedPreset);
      setPresets(current => current.filter(preset => preset.id !== selectedPreset.id));
      setPresetId(''); setPresetName('');
    } catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetBusy(false); }
  };
  return <PromptLibraryWorkspace active={!readOnly && !editingBusy} state={{ base: value.prompt, subject: '', negative: value.negativePrompt, params: value.params, classified: false }} onChange={next => onChange({ ...value, prompt: mergePromptFields(next.base, next.subject), negativePrompt: next.negative, params: next.params })}><div className="space-y-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
              <ToolbarSelect label={t('生成配置预设')} containerClassName="min-w-0 max-w-full w-full sm:w-56" className="truncate" value={presetId} disabled={editingBusy || readOnly} onChange={event => {
                const id = event.target.value;
                const preset = presets.find(item => item.id === id);
                setPresetId(id); setPresetName(preset?.name || '');
                if (id === 'recommended') onChange(structuredClone(recommendedTemplate || createDefaultRollTemplate(runtime)));
                else if (preset) onChange(structuredClone(preset.template));
              }}>
                <option value="">{t('当前配置')}</option><option value="recommended">{t('推荐质量词与参数')}</option>
                {presets.map(preset => <option key={preset.id} value={preset.id} disabled={!presetsReady}>{preset.name}</option>)}
              </ToolbarSelect>
              <input aria-label={t('预设名称')} placeholder={t('预设名称')} maxLength={120} className={`${field} sm:!w-40 sm:flex-1`} value={presetName} disabled={disabled || presetBusy} onChange={event => setPresetName(event.target.value)} />
              <div className="col-span-2 grid min-w-0 grid-cols-3 gap-2 sm:flex">
                <ToolbarButton className="!px-2" disabled={disabled || presetBusy || presetLoading || !presetsReady || !presetName.trim()} onClick={() => void savePreset(false)}>{t('另存新预设')}</ToolbarButton>
                <ToolbarButton className="!px-2" disabled={editingBusy || !presetsReady || !selectedPreset || !presetName.trim()} onClick={() => void savePreset(true)}>{t('更新当前预设')}</ToolbarButton>
                <ToolbarButton className="!px-2" disabled={editingBusy || !presetsReady || !selectedPreset} onClick={() => void deletePreset()}>{t('删除当前预设')}</ToolbarButton>
              </div>
            </div>
            {presetLoading && <p role="status" className="text-xs text-gray-500">{t('正在读取生成预设…')}</p>}
            {presetError && <div role="alert" className="flex items-center gap-2 text-xs text-red-500"><span>{t(presetError)}</span><ToolbarButton disabled={disabled || presetBusy || presetLoading} onClick={() => void loadPresets()}>{t('重新读取预设')}</ToolbarButton></div>}
          </div>
          <label className="block text-xs font-semibold">{t('公共提示词（{style} 为画风位置）')}<TagAutocompleteTextarea aria-label={t('公共提示词')} showTranslations={false} className={`${field} mt-1 min-h-28 resize-y font-mono`} value={value.prompt} disabled={editingBusy || readOnly} onValueChange={prompt => onChange({ ...value, prompt })} /></label>
          <label className="block text-xs font-semibold">{t('角色提示词（可选）')}<TagAutocompleteTextarea libraryField={{ textOnly: true }} showTranslations={false} aria-label={t('角色提示词（可选）')} className={`${field} mt-1 min-h-20 resize-y font-mono`} value={value.characterPrompt || ''} disabled={editingBusy || readOnly} onValueChange={characterPrompt => onChange({ ...value, characterPrompt })} /><span className="mt-1 block text-micro font-normal text-gray-400">{t('自动接在画师串之后；也可在公共提示词里用 {character} 指定位置')}</span></label>
          <label className="block text-xs font-semibold">{t('负面提示词')}<textarea className={`${field} mt-1 min-h-20 resize-y font-mono`} value={value.negativePrompt} disabled={editingBusy || readOnly} onChange={event => onChange({ ...value, negativePrompt: event.target.value })} /></label>
          <ChainEditorParams params={value.params} prompt={value.prompt} setParams={params => onChange({ ...value, params })} modelFilter={modelFilter} canEdit={!editingBusy && !readOnly} markChange={() => {}} enforceFreeStepLimit={enforceFreeStepLimit} />
          {!readOnly && <div className="flex flex-wrap gap-2">
            <ToolbarButton disabled={editingBusy} onClick={() => onChange({ ...value, params: { ...value.params, seed: crypto.getRandomValues(new Uint32Array(1))[0] } })}><Dice5 />{t('换一个固定 Seed')}</ToolbarButton>
          </div>}
          {!!value.params.characters?.length && <p className="text-xs text-gray-500">{t('保留 {0} 个角色的完整提示词与位置', [value.params.characters.length])}</p>}
  </div></PromptLibraryWorkspace>;
}
