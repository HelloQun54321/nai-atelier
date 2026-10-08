// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImageLightbox,ViewableImage} from '../../components/ImageLightbox';
import {installPointerEvents,longPress} from '../support/touchEvents';
beforeEach(()=>{installPointerEvents();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const setup=()=>{const onClose=vi.fn(),onSwipe=vi.fn();render(<ImageLightbox src="/synthetic.png" onClose={onClose} onSwipe={onSwipe}/>);return{stage:screen.getByLabelText('图片平移与缩放'),image:screen.getByRole('img'),onClose,onSwipe};};
const down=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerDown(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});
const up=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerUp(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});
const move=(stage:HTMLElement,id:number,x:number,y:number)=>fireEvent.pointerMove(stage,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y,button:0});

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
