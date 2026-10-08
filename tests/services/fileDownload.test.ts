// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({android:true,writeBlob:vi.fn(),saveFile:vi.fn()}));
vi.mock('../../services/platform',()=>({isAndroidApp:()=>mocks.android}));
vi.mock('../../mobile/native',()=>({writeBlob:mocks.writeBlob,native:{saveFile:mocks.saveFile}}));
import {downloadFile} from '../../services/fileDownload';
beforeEach(()=>{vi.clearAllMocks();mocks.android=true;mocks.writeBlob.mockResolvedValue('transfer/synthetic');mocks.saveFile.mockResolvedValue(undefined);});
it('手机导出等实际文件写完才完成，取消或落盘错误返回失败',async()=>{
  let complete=()=>{};mocks.saveFile.mockImplementation(()=>new Promise<void>(resolve=>complete=resolve));let finished=false;
  const pending=downloadFile(new Blob(['{}'],{type:'application/json'}),'synthetic.json').then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,0));expect(finished).toBe(false);expect(mocks.saveFile).toHaveBeenCalledWith({path:'transfer/synthetic',filename:'synthetic.json',mime:'application/json',removeAfterSave:true});complete();await pending;expect(finished).toBe(true);
  mocks.saveFile.mockRejectedValue(new Error('已取消保存'));await expect(downloadFile(new Blob(['{}']),'synthetic.json')).rejects.toThrow('已取消保存');
});
it('桌面保留浏览器下载，移除临时节点并延迟释放 URL',async()=>{
  mocks.android=false;vi.useFakeTimers();const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});const create=vi.fn(()=> 'blob:synthetic'),revoke=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
  try{await downloadFile(new Blob(['{}']),'synthetic.json');expect(click).toHaveBeenCalledOnce();expect(document.querySelector('a')).toBeNull();expect(revoke).not.toHaveBeenCalled();vi.runAllTimers();expect(revoke).toHaveBeenCalledWith('blob:synthetic');expect(mocks.saveFile).not.toHaveBeenCalled();}finally{vi.useRealTimers();vi.unstubAllGlobals();click.mockRestore();}
});
