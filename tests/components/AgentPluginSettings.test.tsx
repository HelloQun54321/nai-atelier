// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPluginSettings } from '../../components/AgentPluginSettings';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('installation does not enable code; reports DSH gaps and enables a compatible plugin separately', async () => {
  const items: Array<Record<string,unknown>> = []; const changes: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/install')) { const body = JSON.parse(String(init?.body)); expect(body.url).toBe('https://github.com/example/plugin'); items.push({id:'a'.repeat(20),name:'sample',version:'1',description:'示例插件',enabled:false,state:'installed',config:{},source:{url:body.url},unsupported:[],tools:[],log:'',error:''}); return Response.json(items[0],{status:201}); }
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); changes.push(body); items[0].enabled=body.enabled; items[0].state=body.enabled?'running':'installed'; return Response.json({items}); }
    return Response.json({items});
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<ConfirmDialogProvider><AgentPluginSettings notify={vi.fn()} /></ConfirmDialogProvider>);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'管理插件'}));
  expect(await screen.findByText('尚未安装插件。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('GitHub 插件地址'),{target:{value:'https://github.com/example/plugin'}});
  fireEvent.submit(screen.getByLabelText('GitHub 插件地址').closest('form')!);
  expect(await screen.findByText('已安装 · 未启用')).toBeTruthy(); expect(changes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'启用本地代码'}));
  expect(await screen.findByText('运行中')).toBeTruthy(); expect(changes).toEqual([{enabled:true,config:{}}]);
  items.push({id:'b'.repeat(20),name:'dsh-only',version:'1',description:'',enabled:false,state:'unsupported',config:{},source:{},unsupported:['DSH 客户端界面扩展'],tools:[],log:'',error:''});
  fireEvent.click(screen.getByRole('button',{name:'收起插件管理'})); fireEvent.click(screen.getByRole('button',{name:'管理插件'}));
  await waitFor(()=>expect(screen.getByText('DSH 客户端界面扩展')).toBeTruthy());
  const blocked = within(screen.getByText('dsh-only').closest('article')!).getByRole('button',{name:'启用本地代码'}) as HTMLButtonElement;
  expect(blocked.disabled).toBe(true);
});

it('停用包可只读预览原文，查看不会发起启用请求', async () => {
  const item={id:'c'.repeat(20),name:'static-plugin',version:'1',description:'合成',enabled:false,state:'installed',config:{},source:{name:'synthetic.zip'},unsupported:[],tools:[],promptBlocks:[],declaredPromptBlocks:[{id:'body',title:'合成原文',text:'ORIGINAL_TEXT'}],log:'',error:''};
  const fetchMock=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>String(input).endsWith('/preview')
    ? Response.json({active:false,kind:'declared',blocks:[{id:'body',title:'合成原文',text:'ORIGINAL_TEXT',chars:13,sha256:'a'.repeat(64)}]}) : Response.json({items:[item]}));
  vi.stubGlobal('fetch',fetchMock);
  render(<ConfirmDialogProvider><AgentPluginSettings notify={vi.fn()} /></ConfirmDialogProvider>);
  fireEvent.click(screen.getByRole('button',{name:'管理插件'}));
  fireEvent.click(await screen.findByRole('button',{name:'查看提示词片段'}));
  expect(await screen.findByText('ORIGINAL_TEXT')).toBeTruthy();
  expect(screen.getByText(/仅预览安装包声明，未启动代码/)).toBeTruthy();
  expect(fetchMock.mock.calls.every(call=>!call[1]?.method || call[1].method==='GET')).toBe(true);
});
