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
    expect(screen.queryByRole('textbox', { name: '地点与布景' })).toBeNull();
    expect(screen.queryByText('整段使用，随机搭配不会改这里。')).toBeNull();
  });

  it('场景固定在角色后面，不需要添加分页', () => {
    expect(labCategoryTabOptions(true).map(item => item[0])).toEqual(['style', 'character', 'scene', 'reference', 'params']);
    expect(labCategoryTabOptions(false).map(item => item[0])).toEqual(['style', 'character', 'scene', 'params']);
    expect(labCategoryTabOptions(true).some(([, label]) => label === '添加')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    render(<LabCategoryMode tab="scene" base="artist:keep" negative="" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '场景（原有）' })).toHaveProperty('value', 'rainy street');
    expect(screen.getByRole('textbox', { name: '地点与布景' })).toHaveProperty('placeholder', '写地点、室内或背景');
    expect(screen.getByRole('textbox', { name: '自然与天气' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '时间与季节' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '互动与关系' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '构图与布局' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '视角与景别' })).toHaveProperty('placeholder', '写景别和视角');
    expect(screen.getByRole('textbox', { name: '文字与标识' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '补充' })).toHaveProperty('placeholder', '还没归进上面各栏的内容');
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

  it('空状态不重复页头按钮，卡片只保留保存', () => {
    const character = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const tools = { chains: [], params: { width: 832, height: 1216, characters: [] } as unknown as NAIParams, setParams: vi.fn(), onSaveCharacter: vi.fn() };
    const props = { tab: 'character' as const, base: '', negative: '', sections, characters: [] as CharacterParams[], tagAssist: false, negativeLocked: false, onBase: vi.fn(), onNegative: vi.fn(), onSections: vi.fn(), onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn(), characterTools: tools };
    const empty = render(<LabCategoryMode {...props} />);
    expect(screen.getByText('暂无角色，点击上方添加')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '角色定位' })).toBeNull();
    empty.unmount();
    render(<LabCategoryMode {...props} characters={[character]} />);
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '角色定位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存到角色库' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '角色 1 的更多操作' }));
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(2);
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
    expect(screen.getByRole('checkbox', { name: '启用角色 1' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '启用角色 2' })).toBeNull();
    fireEvent.click(secondSwitch);
    expect(screen.getByRole('checkbox', { name: '启用角色 2' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '启用角色 1' })).toBeNull();
  });

  it('翻译区按内容显示，与普通模式一致，不要求先点输入框', () => {
    const withText = { ...sections, 'purpose:place': 'rainy street, night' } as PromptSections;
    render(<LabCategoryMode tab="scene" base="" negative="" sections={withText} characters={[]} tagAssist negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    const field = document.querySelector('textarea[aria-label=\"地点与布景\"]') as HTMLTextAreaElement;
    expect(field.value).toBe('rainy street, night');
    expect(document.activeElement).not.toBe(field);
    expect(screen.getAllByLabelText('提示词中文翻译').length).toBeGreaterThan(0);
  });

  it('空角色默认人物五栏加通用补充；互动挂角色页共用全局栏；生物／物品／载具可添加', () => {
    const empty = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const filled = { id: 'c2', prompt: '', x: 0.5, y: 0.5, sections: { 'purpose:creature': 'cat ears', 'purpose:object': 'sword' } } as CharacterParams;
    const withInteraction = { ...sections, 'purpose:interaction': 'holding hands' } as PromptSections;
    const onSections = vi.fn();
    const props = { tab: 'character' as const, base: '', negative: '', sections: withInteraction, tagAssist: false, negativeLocked: false, onBase: vi.fn(), onNegative: vi.fn(), onSections, onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn() };
    const view = render(<LabCategoryMode {...props} characters={[empty]} />);
    expect(screen.getByRole('textbox', { name: '互动与关系' })).toHaveProperty('value', 'holding hands');
    expect(screen.getByRole('textbox', { name: '人物设定' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '外貌与身体' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '服饰与配件' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '动作与姿态' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '表情与情绪' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '补充' })).toHaveProperty('placeholder', '还没归进上面各栏的内容');
    const hasNegative = (label: string) => [...screen.getByRole('group', { name: label }).querySelectorAll('button')].some(button => button.textContent === '负面');
    expect(hasNegative('人物设定')).toBe(true);
    expect(hasNegative('外貌与身体')).toBe(true);
    expect(hasNegative('补充')).toBe(true);
    expect(screen.queryByRole('textbox', { name: '动物与生物' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '互动与关系' }), { target: { value: 'kiss' } });
    expect(onSections).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '角色 1 的更多操作' }));
    expect(screen.getByRole('button', { name: '添加动物与生物' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加物品与道具' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加载具与机械' })).toBeTruthy();
    view.unmount();
    render(<LabCategoryMode {...props} characters={[filled]} />);
    expect(screen.getByRole('textbox', { name: '互动与关系' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '动物与生物' })).toHaveProperty('value', 'cat ears');
    expect(screen.getByRole('textbox', { name: '物品与道具' })).toHaveProperty('value', 'sword');
  });

  it('各分类栏「使用提示词」就地绑定本栏用途，不串到邻栏', () => {
    const empty = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    render(<PromptLibraryContext.Provider value={{ chains: [], save: vi.fn() }}>
      <LabCategoryMode tab="character" base="" negative="" sections={sections} characters={[empty]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />
    </PromptLibraryContext.Provider>);
    const identity = screen.getByRole('group', { name: '人物设定' });
    const appearance = screen.getByRole('group', { name: '外貌与身体' });
    expect(within(identity).getByRole('button', { name: '使用提示词' })).toBeTruthy();
    expect(within(appearance).getByRole('button', { name: '使用提示词' })).toBeTruthy();
    fireEvent.click(within(identity).getByRole('button', { name: '使用提示词' }));
    expect(screen.getByText(/当前栏：人物设定/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(within(appearance).getByRole('button', { name: '使用提示词' }));
    expect(screen.getByText(/当前栏：外貌与身体/)).toBeTruthy();
  });

  it('场景已有天气正文时仍显示自然与天气栏', () => {
    const withNature = { ...sections, 'purpose:nature': 'heavy rain' } as PromptSections;
    render(<LabCategoryMode tab="scene" base="" negative="" sections={withNature} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '自然与天气' })).toHaveProperty('value', 'heavy rain');
  });
});
