import React, { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };
export const clampImagePan = (pan: Point, width: number, height: number, box: { width: number; height: number }, zoom: number) => {
  const x=Math.max(0,(width*zoom-box.width)/2),y=Math.max(0,(height*zoom-box.height)/2);
  return {x:Math.max(-x,Math.min(x,pan.x)),y:Math.max(-y,Math.min(y,pan.y))};
};

/** 大图统一使用视口坐标：双击取点击焦点、双指取中点，抬起一指后连续拖动。 */
export function useImageViewport(key: React.Key, initial = {width:832,height:1216}, onSwipe?: (delta:number)=>void) {
  const stageRef=useRef<HTMLElement>(null);
  const [box,setBox]=useState({width:800,height:600});
  const [natural,setNatural]=useState(initial);
  const [view,setView]=useState({zoom:1,pan:{x:0,y:0}});
  const fit=Math.min(box.width/natural.width,box.height/natural.height,1);
  const width=natural.width*fit,height=natural.height*fit,maxZoom=Math.max(8,1/fit);
  const latest=useRef(view);latest.current=view;
  const pointers=useRef(new Map<number,Point>());
  const gesture=useRef<{point:Point;pan:Point;zoom:number;distance?:number;pinched:boolean;moved:boolean;time:number;quick:boolean}|null>(null);
  const tap=useRef<{point:Point;time:number}|null>(null);
  const consumed=useRef(false);
  const lastInput=useRef('');
  const update=(zoom:number,pan:Point)=>{const next={zoom,pan:clampImagePan(pan,width,height,box,zoom)};latest.current=next;setView(next);};
  const reset=()=>update(1,{x:0,y:0});
  const pointAt=(point:Point)=>{const rect=stageRef.current!.getBoundingClientRect();return {x:point.x-rect.left-rect.width/2,y:point.y-rect.top-rect.height/2};};
  const zoomAt=(requested:number,point={x:0,y:0})=>{
    const next=Math.max(1,Math.min(maxZoom,requested)),current=latest.current,ratio=next/current.zoom;
    update(next,{x:point.x-(point.x-current.pan.x)*ratio,y:point.y-(point.y-current.pan.y)*ratio});
  };
  const doubleTap=(point:Point)=>latest.current.zoom>1?reset():zoomAt(Math.max(2,1/fit),pointAt(point));
  useEffect(()=>{setNatural(initial);setView({zoom:1,pan:{x:0,y:0}});latest.current={zoom:1,pan:{x:0,y:0}};pointers.current.clear();gesture.current=null;tap.current=null;consumed.current=false;},[key,initial.width,initial.height]);
  useEffect(()=>{
    const stage=stageRef.current;if(!stage)return;
    const measure=()=>{const rect=stage.getBoundingClientRect();if(rect.width>0&&rect.height>0)setBox({width:rect.width,height:rect.height});};
    const observer=new ResizeObserver(measure);observer.observe(stage);measure();return()=>observer.disconnect();
  },[]);
  useEffect(()=>{setView(current=>({...current,pan:clampImagePan(current.pan,width,height,box,current.zoom)}));},[width,height,box]);
  useEffect(()=>{
    const stage=stageRef.current;if(!stage)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();zoomAt(latest.current.zoom*Math.exp(-event.deltaY*.002),pointAt({x:event.clientX,y:event.clientY}));};
    stage.addEventListener('wheel',wheel,{passive:false});return()=>stage.removeEventListener('wheel',wheel);
  });
  const start=(points:Point[],pinched=false)=>{
    const current=latest.current,point=points.length>=2?{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2}:points[0];
    gesture.current={point,pan:current.pan,zoom:current.zoom,pinched:pinched||points.length>=2,moved:false,time:Date.now(),quick:false,...(points.length>=2?{distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)}:{})};
  };
  const pointerDown=(event:React.PointerEvent<HTMLElement>)=>{
    if((event.target as Element).closest('button,input,a,[data-card-action]')||event.button>0)return;
    stageRef.current?.setPointerCapture?.(event.pointerId);
    lastInput.current=event.pointerType;
    if(!pointers.current.size)consumed.current=false;
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});start([...pointers.current.values()]);
    const previous=tap.current;
    if(event.pointerType==='touch'&&pointers.current.size===1&&previous&&Date.now()-previous.time<320&&Math.hypot(event.clientX-previous.point.x,event.clientY-previous.point.y)<28)gesture.current!.quick=true;
    if(pointers.current.size>1){tap.current=null;consumed.current=true;}
  };
  const pointerMove=(event:React.PointerEvent<HTMLElement>)=>{
    if(!pointers.current.has(event.pointerId)||!gesture.current)return;
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.current.values()],g=gesture.current;
    if(Math.hypot(event.clientX-g.point.x,event.clientY-g.point.y)>10){g.moved=true;consumed.current=true;}
    if(points.length>=2&&g.distance){
      const zoom=Math.max(1,Math.min(maxZoom,g.zoom*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/g.distance));
      const origin=pointAt(g.point),mid=pointAt({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
      update(zoom,{x:mid.x-(origin.x-g.pan.x)*zoom/g.zoom,y:mid.y-(origin.y-g.pan.y)*zoom/g.zoom});
    }else if(g.quick&&g.moved){const origin=pointAt(g.point),zoom=Math.max(1,Math.min(maxZoom,g.zoom*Math.exp((event.clientY-g.point.y)*.008)));update(zoom,{x:origin.x-(origin.x-g.pan.x)*zoom/g.zoom,y:origin.y-(origin.y-g.pan.y)*zoom/g.zoom});}
    else if(latest.current.zoom>1)update(latest.current.zoom,{x:g.pan.x+event.clientX-g.point.x,y:g.pan.y+event.clientY-g.point.y});
  };
  const pointerEnd=(event:React.PointerEvent<HTMLElement>)=>{
    const g=gesture.current;if(!pointers.current.has(event.pointerId)||!g)return;
    const last=pointers.current.size===1;
    if(event.type==='pointerup'&&last&&!g.pinched){
      const dx=event.clientX-g.point.x,dy=event.clientY-g.point.y;
      if(g.zoom===1&&!g.quick&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){consumed.current=true;onSwipe?.(dx<0?1:-1);}
      else if(event.pointerType==='touch'&&!g.moved&&Math.hypot(dx,dy)<10&&Date.now()-g.time<280){
        if(g.quick){doubleTap({x:event.clientX,y:event.clientY});tap.current=null;consumed.current=true;}
        else tap.current={point:{x:event.clientX,y:event.clientY},time:Date.now()};
      }else tap.current=null;
    }else tap.current=null;
    pointers.current.delete(event.pointerId);
    if(event.type==='pointercancel'||event.type==='lostpointercapture'){pointers.current.clear();gesture.current=null;consumed.current=true;}
    else if(pointers.current.size)start([...pointers.current.values()],true);else gesture.current=null;
  };
  return {stageRef,natural,zoom:view.zoom,fit,maxZoom,reset,zoomAt,
    imageStyle:{position:'absolute',left:'50%',top:'50%',maxWidth:'none',maxHeight:'none',width,height,transformOrigin:'center',transform:`translate(-50%, -50%) translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`} as React.CSSProperties,
    onLoad:(event:React.SyntheticEvent<HTMLImageElement>)=>{const image=event.currentTarget;if(image.naturalWidth&&image.naturalHeight)setNatural({width:image.naturalWidth,height:image.naturalHeight});},
    handlers:{onPointerDown:pointerDown,onPointerMove:pointerMove,onPointerUp:pointerEnd,onPointerCancel:pointerEnd,onLostPointerCapture:pointerEnd,
      onDoubleClick:(event:React.MouseEvent<HTMLElement>)=>{if(lastInput.current!=='touch'&&!(event.target as Element).closest('button,[data-card-action]'))doubleTap({x:event.clientX,y:event.clientY});},
      onClickCapture:(event:React.MouseEvent<HTMLElement>)=>{if(consumed.current&&event.detail!==0&&!(event.target as Element).closest('[data-card-action],button')){event.preventDefault();event.stopPropagation();consumed.current=false;}}},
  };
}
