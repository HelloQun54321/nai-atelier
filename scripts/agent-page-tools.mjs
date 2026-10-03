import { Type } from '@earendil-works/pi-ai';
const result = page => {
  const text = JSON.stringify(page);
  if (!page || typeof page.snapshotId !== 'string' || !Array.isArray(page.controls) || text.length > 50_000) throw new Error('页面回执无效或过大，请缩小查询范围');
  return { content: [{ type: 'text', text }] };
};
/** 页面自行分页；不要再次经过资料摘要器，避免控件、选项和分页游标被截断。 */
export const isAgentPageTool = name => ['read_current_page', 'operate_current_page'].includes(name);
export const createAgentPageTools = (project, permissionMode, imageInput = false) => {
  const request = async operation => {
    if (!project?.requestUI) throw new Error('实时页面连接不可用，不能把实验室草稿当成当前页面');
    try { return result(await project.requestUI({ ...operation, permissionMode: permissionMode() })); }
    catch (error) {
      // 只处理执行前的版本拒绝；不重放点击、填写或任何可能已有副作用的操作。
      if (!/^页面已变化，请重新读取后(?:继续|操作)$/.test(error.message) || project.signal?.aborted) throw error;
      const page = await project.requestUI({ action: 'read', query: operation.query, limit: operation.limit || 20, permissionMode: permissionMode() });
      return result({ ...page, recovery: {
        operationOutcome: operation.action === 'read' ? 'read_refreshed' : 'not_executed',
        paginationRestarted: operation.action === 'read',
        message: operation.action === 'read' ? '页面已更新；以下为重新读取的当前第一页，旧分页游标已失效。' : '页面在操作前已变化，本次操作未执行；以下为最新页面，请核对目标控件后再操作。',
      } });
    }
  };
  const read = {
    query: Type.Optional(Type.String({ description: '按控件名称或类型查找，例如模型筛选' })), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()),
    controlId: Type.Optional(Type.String()), snapshotId: Type.Optional(Type.String()), valueOffset: Type.Optional(Type.Number()), optionsOffset: Type.Optional(Type.Number()), textOffset: Type.Optional(Type.Number()),
  };
  return [{
    name: 'read_current_page', label: '读取当前页面', description: '实时读取当前工坊的前景窗口、菜单或候选列表。含控件状态、实际下拉选项、视口与加载状态；按 query 查找，nextOffset/nextOptionsOffset/nextValueOffset/nextTextOffset 继续读取，分页时携带 snapshotId。不得猜选项值，也不能用实验室草稿推断当前页。',
    parameters: Type.Object(read), execute: async (_id, args) => request({ ...args, action: 'read' }),
  }, {
    name: 'operate_current_page', label: '操作当前页面', description: '使用最新 snapshotId/controlId 操作。select 使用读取到的真实 value，check 明确指定 checked，不重复切换。fill 自动提交失焦；press 支持 Enter/Escape/Tab/方向键；scroll 可滚动当前区域或定位控件；wait 配合 expect 等待具体状态。click 后请检查 verification，unchanged 不代表成功，先读取/等待，不盲目再次点击。页面变化必须重新读取。copy_image 暂存当前图片原始字节，paste_image 把暂存图片交给上传入口，可跨页面转用；临时图片不冒充系统剪贴板。导出后 exports 列表提供实际副本，可用 save_page_export_to_folder 落盘。普通查看、资料保存、导入入口可直接操作；付费生成、危险确认、密钥及授权由用户批准或业务工具完成。每次核对 notifications，页面变化不等于业务成功。',
    parameters: Type.Object({
      action: Type.Union(['click', 'fill', 'select', 'check', 'navigate', 'scroll', 'press', 'hover', 'wait', 'command', 'drag', 'double_click', 'copy_image', 'paste_image'].map(value => Type.Literal(value))),
      command: Type.Optional(Type.String({ description: '使用当前页面 commands 列表中的实际操作名；画布通过 get_image_edit_state 和 edit_image_canvas 编辑。' })), args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      delta: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
      snapshotId: Type.Optional(Type.String()), controlId: Type.Optional(Type.String()), value: Type.Optional(Type.String()), values: Type.Optional(Type.Array(Type.String())), checked: Type.Optional(Type.Boolean()), commit: Type.Optional(Type.Boolean({ description: '默认提交并失焦；需要继续选择补全候选时设为 false 保持焦点' })),
      view: Type.Optional(Type.Union(['list', 'characters', 'library', 'aitag', 'danbooru', 'pixiv', 'inspiration', 'history', 'playground'].map(value => Type.Literal(value)))),
      key: Type.Optional(Type.String()), direction: Type.Optional(Type.Union(['up', 'down', 'left', 'right'].map(value => Type.Literal(value)))), amount: Type.Optional(Type.Number()), timeoutMs: Type.Optional(Type.Number()),
      expect: Type.Optional(Type.Object({ label: Type.Optional(Type.String()), text: Type.Optional(Type.String()), view: Type.Optional(Type.String()), value: Type.Optional(Type.String()), checked: Type.Optional(Type.Boolean()), selected: Type.Optional(Type.Boolean()), expanded: Type.Optional(Type.Boolean()), pressed: Type.Optional(Type.Boolean()) })),
    }), execute: async (_id, args) => { if (args.command === 'inspect_edit_canvas') throw new Error('观察底图请使用 inspect_current_page_image'); return request(args); },
  }, {
    name: 'inspect_current_page_image', label: '观察当前页面图片', description: '把当前页面真实图片交给当前模型观察；不调用其他视觉模型。controlId 来自当前页图片控件，省略时观察实验室底图。需要当前模型支持图片输入。',
    parameters: Type.Object({ snapshotId: Type.String(), controlId: Type.Optional(Type.String()), focus: Type.Optional(Type.String()) }),
    execute: async (_id, args) => {
      if (!imageInput) throw new Error('当前模型不支持图片输入，请由用户选择支持图片的模型；页面文字与编辑操作仍可使用');
      if (!project?.requestUI) throw new Error('实时页面连接不可用');
      const page = await project.requestUI({ action: args.controlId ? 'image' : 'command', ...(args.controlId ? { controlId: args.controlId } : { command: 'inspect_edit_canvas' }), snapshotId: args.snapshotId, permissionMode: permissionMode() });
      const image = page.result?.image;
      if (!image || image.mimeType !== 'image/jpeg' || typeof image.data !== 'string' || image.data.length > 1_500_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)) throw new Error('没有取得真实图片像素');
      return { content: [{ type: 'text', text: JSON.stringify({ title: page.title, label: page.result.label, canvas: page.result.canvas, focus: String(args.focus || '').slice(0, 1000), modelHasSeenImage: true }) }, { type: 'image', data: image.data, mimeType: image.mimeType }] };
    },
  }];
};
