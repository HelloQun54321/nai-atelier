// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabCategoryMode, labCategoryTabOptions } from '../../../components/chain/LabCategoryMode';
import { PromptLibraryContext } from '../../../components/PromptLibraryAccess';
import type { CharacterParams, NAIParams, PromptSections } from '../../../types';

const sections = { appearance: '', wardrobe: '', pose: '', scene: 'rainy street', camera: '', extra: '' } as PromptSections;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('分类模式分页', () => {
  it('全局页只有整段画风，不把场景铺在同一页', () => {
    render(<LabCategoryMode tab="style" base="artist:keep" negative="lowres" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: '画风' }) as HTMLTextAreaElement).value).toBe('artist:keep');
    expect(screen.getByRole('textbox', { name: '画风' })).toHaveProperty('placeholder', '');
    expect(screen.queryByRole('textbox', { name: '场景地点' })).toBeNull();
    expect(screen.queryByText('整段使用，随机搭配不会改这里。')).toBeNull();
  });

  it('场景固定在角色后面，不需要添加分页', () => {
    expect(labCategoryTabOptions(true).map(item => item[0])).toEqual(['style', 'character', 'scene', 'reference', 'params']);
    expect(labCategoryTabOptions(false).map(item => item[0])).toEqual(['style', 'character', 'scene', 'params']);
    expect(labCategoryTabOptions(true).some(([, label]) => label === '添加')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    render(<LabCategoryMode tab="scene" base="artist:keep" negative="" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '场景（原有）' })).toHaveProperty('value', 'rainy street');
    expect(screen.getByRole('textbox', { name: '场景地点' })).toHaveProperty('placeholder', '');
    expect(screen.getByRole('textbox', { name: '光影与氛围' })).toHaveProperty('placeholder', '');
    expect(screen.queryByRole('textbox', { name: '多人互动' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '镜头与构图' })).toHaveProperty('placeholder', '');
    expect(screen.queryByRole('textbox', { name: '道具与生物' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '补充' })).toHaveProperty('placeholder', '');
    expect(screen.getAllByRole('button', { name: /更多操作/ })).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '画风' })).toBeNull();
    expect(screen.queryByText(/本次结构/)).toBeNull();
    expect(screen.queryByRole('button', { name: '上移' })).toBeNull();
    expect(screen.queryByRole('button', { name: '从分页拿下' })).toBeNull();
    const button = screen.getByRole('button', { name: /更多操作/ });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === button) return { x: 420, y: 180, top: 180, left: 420, right: 500, bottom: 212, width: 80, height: 32, toJSON: () => ({}) };
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    const top = Number(menu.style.top);
    const left = Number(menu.style.left);
    const height = Math.min(240, Number(menu.style.maxHeight) || 240);
    const coversField = top < 212 && top + height > 212 && left < 500 && left + 208 > 420;
    expect(coversField).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    vi.restoreAllMocks();
  });

  it('空状态页头保留引用新建；有角色后对齐统一角色头部，角色卡头部直达引用·组合·随机·收录·删除', () => {
    const character = { id: 'c1', prompt: 'girl', x: 0.5, y: 0.5 } as CharacterParams;
    const setParams = vi.fn();
    const onSettingsChange = vi.fn();
    const tools = { chains: [], params: { width: 832, height: 1216, characters: [], useCoords: true } as unknown as NAIParams, setParams, onSettingsChange, onSaveCharacter: vi.fn() };
    const props = { tab: 'character' as const, base: '', negative: '', sections, characters: [] as CharacterParams[], tagAssist: false, negativeLocked: false, onBase: vi.fn(), onNegative: vi.fn(), onSections: vi.fn(), onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn(), characterTools: tools };
    const empty = render(<LabCategoryMode {...props} />);
    expect(screen.getByText('暂无角色，点击上方添加')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '从角色库取用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '角色定位' })).toBeNull();
    expect(screen.queryByRole('button', { name: '自动构图' })).toBeNull();
    empty.unmount();

    render(<LabCategoryMode {...props} characters={[character]} characterTools={{ ...tools, params: { ...tools.params, characters: [character] } }} />);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '删除角色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '角色定位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '自动构图' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '手动定位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '从角色库取用' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '收录到角色库' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /上移|下移/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '自动构图' }));
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ useCoords: false }));
    expect(onSettingsChange).toHaveBeenCalled();
  });

  it('角色在页头切换，一次只显示一个，标题跟随角色名', () => {
    const named = { id: 'c1', name: '红发少女', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const unnamed = { id: 'c2', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const tools = { chains: [], params: { width: 832, height: 1216, characters: [] } as unknown as NAIParams, setParams: vi.fn(), onSaveCharacter: vi.fn() };
    render(<LabCategoryMode tab="character" base="" negative="" sections={sections} characters={[named, unnamed]} tagAssist={false} negativeLocked={false} characterTools={tools} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    const namedSwitch = screen.getAllByRole('button', { name: /红发少女/ }).find(button => button.hasAttribute('aria-pressed'))!;
    expect(namedSwitch.getAttribute('aria-pressed')).toBe('true');
    const secondSwitch = screen.getAllByRole('button', { name: /角色 2/ }).find(button => button.hasAttribute('aria-pressed'))!;
    expect(secondSwitch.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('switch', { name: '启用角色 1' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: '启用角色 2' })).toBeNull();
    fireEvent.click(secondSwitch);
    expect(screen.getByRole('switch', { name: '启用角色 2' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: '启用角色 1' })).toBeNull();
  });

  it('翻译区按内容显示，与普通模式一致，不要求先点输入框', () => {
    const withText = { ...sections, 'purpose:place': 'rainy street, night' } as PromptSections;
    render(<LabCategoryMode tab="scene" base="" negative="" sections={withText} characters={[]} tagAssist negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    const field = document.querySelector('textarea[aria-label="场景地点"]') as HTMLTextAreaElement;
    expect(field.value).toBe('rainy street, night');
    expect(document.activeElement).not.toBe(field);
    expect(screen.getAllByLabelText('提示词中文翻译').length).toBeGreaterThan(0);
  });

  it('空角色默认人物四栏加通用补充；多人互动挂角色页共用全局栏；旧道具生物草稿保留显示', () => {
    const empty = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const filled = { id: 'c2', prompt: '', x: 0.5, y: 0.5, sections: { 'purpose:creature': 'cat ears', 'purpose:object': 'sword' } } as CharacterParams;
    const withInteraction = { ...sections, 'purpose:interaction': 'holding hands' } as PromptSections;
    const onSections = vi.fn();
    const props = { tab: 'character' as const, base: '', negative: '', sections: withInteraction, tagAssist: false, negativeLocked: false, onBase: vi.fn(), onNegative: vi.fn(), onSections, onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn() };
    const view = render(<LabCategoryMode {...props} characters={[empty]} />);
    expect(screen.getByRole('textbox', { name: '多人互动' })).toHaveProperty('value', 'holding hands');
    expect(screen.getByRole('textbox', { name: '外貌与设定' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '服饰穿搭' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '动作姿态' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '表情神态' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '补充' })).toHaveProperty('placeholder', '');
    const hasNegativeDisclosure = (label: string) => Boolean(within(screen.getByRole('group', { name: label })).getByRole('button', { name: '负面（选填）' }));
    expect(hasNegativeDisclosure('外貌与设定')).toBe(true);
    expect(hasNegativeDisclosure('服饰穿搭')).toBe(true);
    expect(hasNegativeDisclosure('补充')).toBe(true);
    expect(screen.queryByRole('textbox', { name: '道具与生物' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '多人互动' }), { target: { value: 'kiss' } });
    expect(onSections).toHaveBeenCalled();
    view.unmount();
    render(<LabCategoryMode {...props} characters={[filled]} />);
    expect(screen.getByRole('textbox', { name: '多人互动' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '动物与生物（原有）' })).toHaveProperty('value', 'cat ears');
    expect(screen.getByRole('textbox', { name: '道具与生物（原有）' })).toHaveProperty('value', 'sword');
  });

  it('各分类栏「使用提示词」只选本用途片段，角色与场景顶层支持用组合填充', () => {
    const empty = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const view = render(<PromptLibraryContext.Provider value={{ chains: [], save: vi.fn() }}>
      <LabCategoryMode tab="character" base="" negative="" sections={sections} characters={[empty]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />
    </PromptLibraryContext.Provider>);
    const appearance = screen.getByRole('group', { name: '外貌与设定' });
    const clothing = screen.getByRole('group', { name: '服饰穿搭' });
    expect(within(appearance).getByRole('button', { name: '使用提示词' })).toBeTruthy();
    expect(within(clothing).getByRole('button', { name: '使用提示词' })).toBeTruthy();
    fireEvent.click(within(appearance).getByRole('button', { name: '使用提示词' }));
    expect(screen.getByText(/当前栏：外貌与设定（只显示此用途片段）/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '组合' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(within(clothing).getByRole('button', { name: '使用提示词' }));
    expect(screen.getByText(/当前栏：服饰穿搭（只显示此用途片段）/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '用组合填充角色' }));
    expect(screen.getByText(/当前角色（只显示含角色内容的组合与自定义角色）/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '片段' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    view.rerender(<PromptLibraryContext.Provider value={{ chains: [], save: vi.fn() }}>
      <LabCategoryMode tab="scene" base="" negative="" sections={sections} characters={[empty]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />
    </PromptLibraryContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: '用组合填充场景' }));
    expect(screen.getByText(/当前场景（只显示含画面内容的组合）/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '片段' })).toBeNull();
  });

  it('分段模式从角色库取用有分栏角色时还原各格内容，纯文本角色仍进补充栏', () => {
    const empty = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const onUpdateCharacter = vi.fn();
    const sectionedChar = {
      id: 'char-sec',
      type: 'character' as const,
      userId: 'owner',
      name: '女仆Saber',
      description: '',
      tags: [],
      basePrompt: 'blonde hair, maid outfit',
      negativePrompt: 'bad hands',
      modules: [],
      variableValues: { subject: '' },
      params: {
        characters: [{
          id: 's1',
          enabled: true,
          prompt: 'holding tray',
          negativePrompt: 'bad hands',
          x: 0.5,
          y: 0.5,
          sections: { appearance: 'blonde hair', 'purpose:clothing': 'maid outfit' },
        }],
      } as unknown as NAIParams,
      createdAt: 1,
      updatedAt: 1,
    };
    const tools = { chains: [sectionedChar], params: { width: 832, height: 1216, characters: [empty] } as unknown as NAIParams, setParams: vi.fn(), onSaveCharacter: vi.fn() };
    render(<LabCategoryMode tab="character" base="" negative="" sections={sections} characters={[empty]} tagAssist={false} negativeLocked={false} characterTools={tools} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={onUpdateCharacter} onRemoveCharacter={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '从角色库取用' }));
    fireEvent.click(screen.getByRole('button', { name: /女仆Saber/ }));
    expect(onUpdateCharacter).toHaveBeenCalledWith(0, expect.objectContaining({
      name: '女仆Saber',
      prompt: 'holding tray',
      sections: { 'purpose:appearance': 'blonde hair', 'purpose:clothing': 'maid outfit' },
    }));
  });

  it('场景已有旧天气正文时保留原有栏位且不与光影与氛围冲突', () => {
    const withNature = { ...sections, 'purpose:nature': 'heavy rain', 'purpose:lighting': 'backlight' } as PromptSections;
    render(<LabCategoryMode tab="scene" base="" negative="" sections={withNature} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '光影与氛围' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '自然与天气（原有）' })).toHaveProperty('value', 'heavy rain');
    expect(screen.getByRole('textbox', { name: '光照（原有）' })).toHaveProperty('value', 'backlight');
  });
});
