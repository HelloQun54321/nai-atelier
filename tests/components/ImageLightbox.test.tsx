// @vitest-environment jsdom
import React, { useState } from 'react';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImageLightbox,ViewableImage} from '../../components/ImageLightbox';
import {ChainEditorPreview} from '../../components/ChainEditorPreview';
import {ImageEditPreview} from '../../components/ImageEditPreview';
import {installPointerEvents,longPress} from '../support/touchEvents';
import {buildMediaUrl} from '../../services/mobileImageCache';
import { copySharedImage, downloadSharedImage } from '../../services/imageSharing';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}) }));
beforeEach(()=>{installPointerEvents();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const setup=()=>{const onClose=vi.fn(),onSwipe=vi.fn();render(<ImageLightbox src="/synthetic.png" onClose={onClose} onSwipe={onSwipe}/>);return{stage:screen.getByLabelText('图片平移与缩放'),image:screen.getByRole('img'),onClose,onSwipe};};
const down=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerDown(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});
const up=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerUp(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});
const move=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerMove(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});

it('详情可显式使用图包裁边预览，大图仍读取原地址；其他调用保持原图',()=>{
  const source='/api/inspirations/synthetic-artist/image';
  const view=render(<ViewableImage src={source} alt="图包收藏" previewTransform="artist-sample-padding-v1"/>);
  expect(screen.getByRole('img').getAttribute('src')).toBe(buildMediaUrl(source,'thumb-960','artist-sample-padding-v1'));
  expect(screen.getByRole('img').getAttribute('data-agent-original-src')).toBe(source);
  fireEvent.click(screen.getByRole('button',{name:'放大查看：图包收藏'}));
  expect(within(screen.getByRole('dialog',{name:'图片预览'})).getByRole('img').getAttribute('src')).toBe(source);
  fireEvent.click(screen.getByRole('button',{name:'返回图片详情'}));
  view.rerender(<ViewableImage src={source} alt="普通收藏"/>);
  expect(screen.getByRole('img').getAttribute('src')).toBe(source);
});

it('双击按触点放大，再双击复原，小原图也能放大；触屏合成 dblclick 不重复复原',()=>{
  const {stage,image}=setup();
  Object.defineProperties(image,{naturalWidth:{value:100},naturalHeight:{value:100}});fireEvent.load(image);
  const tap=()=>{down(stage,1,100,100);up(stage,1,100,100);};tap();tap();expect(image.style.transform).toContain('scale(2)');
  fireEvent.doubleClick(stage,{clientX:100,clientY:100});expect(image.style.transform).toContain('scale(2)');
  tap();tap();expect(image.style.transform).toContain('scale(1)');
});
it('双指中点缩放后抬起一指继续拖动，手势不会退出、翻图或显示长按操作',()=>{
  const {stage,image,onClose,onSwipe}=setup();down(stage,1,100,100);down(stage,2,200,100);move(stage,2,300,100);
  expect(image.style.transform).toContain('scale(2)');const before=image.style.transform;
  up(stage,2,300,100);move(stage,1,80,160);expect(image.style.transform).not.toBe(before);up(stage,1,80,160);
  fireEvent.click(stage,{detail:1});expect(onClose).not.toHaveBeenCalled();expect(onSwipe).not.toHaveBeenCalled();expect(stage.hasAttribute('data-press-revealed')).toBe(false);
});
it('单指横滑只在适应窗口时翻图；双击按住纵向拖动可连续缩放',()=>{
  const {stage,image,onSwipe}=setup();down(stage,1,200,200);up(stage,1,100,200);expect(onSwipe).toHaveBeenCalledWith(1);onSwipe.mockClear();
  down(stage,1,100,100);up(stage,1,100,100);down(stage,1,100,100);move(stage,1,100,180);up(stage,1,100,180);
  expect(image.style.transform).not.toContain('scale(1)');expect(onSwipe).not.toHaveBeenCalled();
});
it('长按保留原位分享，查看器返回与键盘 Esc 可退出；详情原位图片可进入查看器',()=>{
  const {stage,image,onClose}=setup();longPress(image);expect(stage.getAttribute('data-press-revealed')).toBe('true');
  fireEvent.keyDown(window,{key:'Escape'});expect(onClose).toHaveBeenCalledOnce();cleanup();
  render(<ViewableImage src="/synthetic.png" alt="合成作品"/>);fireEvent.click(screen.getByRole('button',{name:'放大查看：合成作品'}));
  expect(screen.getByRole('dialog',{name:'图片预览'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'返回图片详情'}));expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  [1400,900,1024,1024,'88%'],[1400,900,1216,832,'100%'],[1400,900,832,1216,'74%'],
  [390,844,1024,1024,'38%'],[390,844,1216,832,'32%'],[390,844,832,1216,'47%'],
])('窗口 %ix%i 打开 %ix%i 图片时始终按原比例适配，加载后不切换宽高样式', (width,height,naturalWidth,naturalHeight,percentage)=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width,height,left:0,top:0} as DOMRect);
  const {image}=setup();
  const before=image.style.cssText;
  expect(image.style.width).toBe('auto');expect(image.style.height).toBe('auto');
  expect(image.style.maxWidth).toBe('100%');expect(image.style.maxHeight).toBe('100%');
  Object.defineProperties(image,{naturalWidth:{value:naturalWidth},naturalHeight:{value:naturalHeight}});fireEvent.load(image);
  expect(image.style.cssText).toBe(before);
  expect(screen.getByLabelText('图片缩放比例').textContent).toBe(percentage);
});

it('Portal 挂载后立即测量并注册尺寸监听，调整窗口重新适配，关闭清理监听',()=>{
  let box={width:1400,height:900};
  const callbacks=new Set<()=>void>();
  const observe=vi.fn(),disconnect=vi.fn();
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({...box,left:0,top:0} as DOMRect));
  vi.stubGlobal('ResizeObserver',class{
    callback:()=>void;
    constructor(callback:ResizeObserverCallback){this.callback=()=>callback([],this as unknown as ResizeObserver);callbacks.add(this.callback);}
    observe=observe;disconnect=()=>{callbacks.delete(this.callback);disconnect();};
  });
  const {stage,image}=setup();expect(observe).toHaveBeenCalledWith(stage);
  Object.defineProperties(image,{naturalWidth:{value:1024},naturalHeight:{value:1024}});fireEvent.load(image);
  expect(screen.getByLabelText('图片缩放比例').textContent).toBe('88%');
  box={width:700,height:500};act(()=>callbacks.forEach(callback=>callback()));
  expect(screen.getByLabelText('图片缩放比例').textContent).toBe('49%');
  fireEvent.wheel(stage,{deltaY:-100,clientX:350,clientY:250});
  expect(image.style.transform).toContain('scale(1.2214027581601699)');
  cleanup();expect(callbacks.size).toBe(0);expect(disconnect).toHaveBeenCalled();
});

it.each(['text-to-image','image-to-image','inpaint','outpaint'] as const)('%s 预览入口共用稳定比例的大图查看器',operation=>{
  const Harness=()=>{
    const [open,setOpen]=useState<string|null>(null);
    const common={isGenerating:false,generationCostLabel:'免费',getDownloadFilename:()=> 'synthetic.png'};
    return <>{operation==='text-to-image'
      ? <ChainEditorPreview {...common} generatedImage="/synthetic.png" previewImage={undefined} errorMsg={null} handleGenerate={vi.fn()} setLightboxImg={setOpen} isOwner={false} isUploading={false} handleSavePreview={vi.fn()} handleUploadCover={vi.fn()} />
      : <ImageEditPreview {...common} operation={operation} image="/synthetic.png" error={null} canGenerate onGenerate={vi.fn()} onOpenLightbox={setOpen} />}
      {open&&<ImageLightbox src={open} onClose={()=>setOpen(null)}/>}</>;
  };
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:1400,height:900,left:0,top:0} as DOMRect);
  render(<Harness/>);fireEvent.click(screen.getByRole('img'));
  const image=within(screen.getByRole('dialog',{name:'图片预览'})).getByRole('img'),before=image.style.cssText;
  Object.defineProperties(image,{naturalWidth:{value:1024},naturalHeight:{value:1024}});fireEvent.load(image);
  expect(image.style.cssText).toBe(before);expect(image.style.width).toBe('auto');
  expect(screen.getByLabelText('图片缩放比例').textContent).toBe('88%');
});

vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));

it('原图最终失败才提示，主动重试重建图片，切换图片不残留旧错误', () => {
  const onClose = vi.fn();
  const view = render(<ImageLightbox src="/synthetic.png" onClose={onClose} />);
  const image = screen.getByRole('img'); fireEvent.error(image);
  const retry = screen.getByRole('button', { name: '原图加载失败 · 重试' });
  fireEvent.click(retry);
  expect(screen.getByRole('img')).not.toBe(image);
  expect(screen.queryByRole('button', { name: '原图加载失败 · 重试' })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.error(screen.getByRole('img'));
  view.rerender(<ImageLightbox src="/another.png" onClose={onClose} />);
  expect(screen.queryByRole('button', { name: '原图加载失败 · 重试' })).toBeNull();
});

it('多页大图支持按钮、方向键和页码，边界及输入框不翻页，单张不出现分页', () => {
  const change = vi.fn();
  const Harness = ({ count = 3 }) => { const [index, setIndex] = useState(0); return <ImageLightbox src={`/p${index}.png`} onClose={vi.fn()} pager={{ index, count, onChange: next => { change(next); setIndex(next); } }}><input aria-label="合成输入" /></ImageLightbox>; };
  const view = render(<Harness />);
  expect(screen.getByText('1 / 3')).toBeTruthy();
  expect((screen.getByRole('button', { name: '上一张图片' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
  expect(screen.getByText('2 / 3')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight' });
  expect(screen.getByText('2 / 3')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
  expect(screen.getByText('2 / 3')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('3 / 3')).toBeTruthy();
  expect((screen.getByRole('button', { name: '下一张图片' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(change).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { key: 'ArrowLeft' }); expect(screen.getByText('2 / 3')).toBeTruthy();
  view.rerender(<Harness count={1} />);
  expect(screen.queryByRole('button', { name: '下一张图片' })).toBeNull();
});

it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 小预览的复制成功与下载失败均通过调用方通知', async operation => {
  const notify = vi.fn();
  vi.mocked(downloadSharedImage).mockRejectedValueOnce(new Error('合成下载失败'));
  render(<ImageEditPreview operation={operation} image="/synthetic.png" error={null} generationCostLabel="免费" onGenerate={vi.fn()} onOpenLightbox={vi.fn()} getDownloadFilename={() => 'synthetic.png'} notify={notify} />);
  fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已复制图片', 'success'));
  expect(copySharedImage).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成下载失败', 'error'));
});
