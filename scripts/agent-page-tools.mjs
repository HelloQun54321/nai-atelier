import { Type } from '@earendil-works/pi-ai';
const result = page => {
  const text = JSON.stringify(page);
  if (!page || typeof page.snapshotId !== 'string' || !Array.isArray(page.controls) || text.length > 50_000) throw new Error('页面回执无效或过大，请缩小查询范围');
  return { content: [{ type: 'text', text }] };
};
/** 页面自行分页；不要再次经过资料摘要器，避免控件、选项和分页游标被截断。 */
export const isAgentPageTool = name => ['read_current_page', 'operate_current_page'].includes(name);
export const createAgentPageTools = (project, permissionMode) => {
  const request = async operation => {
    if (!project?.requestUI) throw new Error('实时页面连接不可用，不能把实验室草稿当成当前页面');
    return result(await project.requestUI({ ...operation, permissionMode: permissionMode() }));
  };
  const read = {
    query: Type.Optional(Type.String({ description: '按控件名称或类型查找，例如模型筛选' })), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()),
    controlId: Type.Optional(Type.String()), snapshotId: Type.Optional(Type.String()), valueOffset: Type.Optional(Type.Number()), optionsOffset: Type.Optional(Type.Number()), textOffset: Type.Optional(Type.Number()),
  };
  return [{
    name: 'read_current_page', label: '读取当前页面', description: '实时读取当前工坊的前景窗口、菜单或候选列表。含控件状态、实际下拉选项、视口与加载状态；按 query 查找，nextOffset/nextOptionsOffset/nextValueOffset/nextTextOffset 继续读取，分页时携带 snapshotId。不得猜选项值，也不能用实验室草稿推断当前页。',
    parameters: Type.Object(read), execute: async (_id, args) => request({ ...args, action: 'read' }),
  }, {
    name: 'operate_current_page', label: '操作当前页面', description: '使用最新 snapshotId/controlId 操作。select 使用读取到的真实 value，check 明确指定 checked，不重复切换。fill 自动提交失焦；press 支持 Enter/Escape/Tab/方向键；scroll 可滚动当前区域或定位控件；wait 配合 expect 等待具体状态。click 后请检查 verification，unchanged 不代表成功，先读取/等待，不盲目再次点击。页面变化必须重新读取。生图、保存、删除、密钥及授权仍使用业务工具。',
    parameters: Type.Object({
      action: Type.Union(['click', 'fill', 'select', 'check', 'navigate', 'scroll', 'press', 'hover', 'wait'].map(value => Type.Literal(value))),
      snapshotId: Type.Optional(Type.String()), controlId: Type.Optional(Type.String()), value: Type.Optional(Type.String()), values: Type.Optional(Type.Array(Type.String())), checked: Type.Optional(Type.Boolean()), commit: Type.Optional(Type.Boolean({ description: '默认提交并失焦；需要继续选择补全候选时设为 false 保持焦点' })),
      view: Type.Optional(Type.Union(['list', 'characters', 'library', 'aitag', 'danbooru', 'pixiv', 'inspiration', 'history', 'playground'].map(value => Type.Literal(value)))),
      key: Type.Optional(Type.String()), direction: Type.Optional(Type.Union(['up', 'down', 'left', 'right'].map(value => Type.Literal(value)))), amount: Type.Optional(Type.Number()), timeoutMs: Type.Optional(Type.Number()),
      expect: Type.Optional(Type.Object({ label: Type.Optional(Type.String()), text: Type.Optional(Type.String()), view: Type.Optional(Type.String()), value: Type.Optional(Type.String()), checked: Type.Optional(Type.Boolean()), selected: Type.Optional(Type.Boolean()), expanded: Type.Optional(Type.Boolean()), pressed: Type.Optional(Type.Boolean()) })),
    }), execute: async (_id, args) => request(args),
  }];
};
