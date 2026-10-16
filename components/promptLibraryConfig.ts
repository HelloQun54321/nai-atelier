import type { ChainType } from '../types';
import type { PromptLibraryKind } from '../services/promptAgent';

/** 一个「限定项」下拉：key 作为生成请求的顶层字段名，空串代表「不限」。 */
export interface PromptLibraryFacet {
  key: string;
  label: string;
  options: string[];
  multiple?: boolean;
}

export interface PromptLibraryKindConfig {
  kind: PromptLibraryKind;
  /** 条目落库时的 PromptChain.type（三个领域与 kind 同名）。 */
  type: ChainType | ChainType[];
  hideActions?: boolean;
  /** 中文栏目名，如「人物形象库」。 */
  title: string;
  /** 条目量词说明用的名词，如「人物形象」。 */
  itemNoun: string;
  /** 计数单位：个 / 套。 */
  unit: string;
  /** 生成按钮文案（含 ✦ 前缀，按钮上会去掉）。 */
  generateLabel: string;
  createLabel: string;
  defaultName: string;
  briefLabel: string;
  briefPlaceholder: string;
  tagPlaceholder: string;
  generateHint: string;
  emptyTitle: string;
  emptyHint: string;
  facets: PromptLibraryFacet[];
}

export const PROMPT_LIBRARY_KINDS: Record<PromptLibraryKind, PromptLibraryKindConfig> = {
  appearance: {
    kind: "appearance",
    type: "appearance",
    title: "人物形象库",
    itemNoun: "形象",
    unit: "个",
    briefLabel: "想要什么人物形象",
    briefPlaceholder: "例如：银发红瞳的少女，短发，娇小身材，精灵耳",
    generateLabel: "✦ AI 生成人物形象",
    generateHint: "使用创作助手当前配置的模型生成，输出两版：中英对照与纯英文。只含人物外貌特征（发色/发型/瞳色/体型/年龄/特征），不含服装、姿势、镜头与背景；不消耗生图额度。",
    createLabel: "新建形象",
    defaultName: "新形象",
    tagPlaceholder: "银发, 红瞳, 短发",
    emptyTitle: "人物形象库还是空的",
    emptyHint: "用「AI 生成形象」按一句话需求生成中英对照与纯英文两版提示词，或点「新建形象」手写一条；每条都能从本地历史挑封面和参考图对照。",
    facets: [
      {"key":"hair","label":"发色","options":["","黑","棕","金","银白","红","蓝","粉","绿","渐变","亚麻色","栗色","灰","紫","橙","白色","双色","挑染"],"multiple":false},
      {"key":"hairstyle","label":"发型","options":["","短发","长发","马尾","双马尾","丸子头","卷发","齐刘海","麻花辫","波波头","公主切","盘发","狼尾","空气刘海","中分","侧分","呆毛","编发"],"multiple":false},
      {"key":"eyes","label":"瞳色","options":["","黑","棕","蓝","红","绿","紫","金","异色瞳","灰","粉","银","橙","青","渐变色"],"multiple":false},
      {"key":"body","label":"体型","options":["","纤细","标准","丰满","娇小","高挑","健壮","肌肉","骨感","梨形","沙漏型","倒三角"],"multiple":false},
      {"key":"age","label":"年龄","options":["","少女","成年","成熟","幼女","御姐","熟女","中年"],"multiple":false},
      {"key":"height","label":"身高","options":["","娇小","标准","高挑","极矮","极高","偏矮","偏高","修长"],"multiple":false},
      {"key":"gender","label":"性别","options":["","女性","男性","中性","双性","扶她","无性别","偏女性","偏男性"],"multiple":false},
      {"key":"breasts","label":"胸部","options":["","平胸","小胸","中等","丰满","巨乳","爆乳","挺立","下垂"],"multiple":false},
      {"key":"skin","label":"肤色","options":["","白皙","健康","小麦色","古铜色","苍白","黑","深棕","晒痕"],"multiple":false},
      {"key":"traits","label":"特征","options":["","精灵耳","兽耳","雀斑","泪痣","眼镜","纹身","虎牙","尖牙","角","翅膀","尾巴","伤疤","胎记","唇钉","舌钉","脐钉","兽尾","机械义体"],"multiple":true},
    ],
  },
  wardrobe: {
    kind: "wardrobe",
    type: "wardrobe",
    title: "服饰库",
    itemNoun: "服饰",
    unit: "套",
    briefLabel: "想要什么穿搭",
    briefPlaceholder: "例如：夏天海边度假，少女，清爽一点的连衣裙配草帽",
    generateLabel: "✦ AI 生成穿搭",
    generateHint: "使用创作助手当前配置的模型生成，输出两版：中英对照与纯英文。只含服装与穿戴的 Tag，不含人物外貌、镜头与背景；不消耗生图额度。",
    createLabel: "新建服饰",
    defaultName: "新服饰",
    tagPlaceholder: "连衣裙, 夏, 甜美",
    emptyTitle: "服饰库还是空的",
    emptyHint: "用「AI 生成穿搭」按一句话需求生成中英对照与纯英文两版提示词，或点「新建服饰」手写一套；每套都能从本地历史挑封面和参考图。",
    facets: [
      {"key":"season","label":"季节","options":["","春","夏","秋","冬","四季","初春","盛夏","深秋","隆冬","梅雨"],"multiple":false},
      {"key":"occasion","label":"场合","options":["","日常","约会","职场","宴会","海边","校园","居家","运动","婚礼","派对","节日","旅行","正式","休闲","演出"],"multiple":false},
      {"key":"style","label":"风格","options":["","休闲","正式","甜美","复古","哥特","未来感","街头","居家","洛丽塔","朋克","和风","中式","蒸汽朋克","赛博","军装","女仆","护士","校服","制服","运动风"],"multiple":true},
      {"key":"gender","label":"对象","options":["","女性","男性","中性","双性","儿童","情侣","亲子","无性别"],"multiple":false},
      {"key":"palette","label":"配色","options":["","浅色","深色","暖色","冷色","黑白","撞色","单色","彩虹色","渐变色","透明感"],"multiple":false},
      {"key":"accessory","label":"配饰","options":["","帽子","眼镜","项链","耳饰","手套","围巾","腰带","头饰","口罩","墨镜","发饰","胸针","手链","戒指","臂环","腿环","颈圈","领带","蝴蝶结","耳麦"],"multiple":true},
      {"key":"footwear","label":"鞋子","options":["","高跟鞋","平底鞋","靴子","过膝靴","凉鞋","运动鞋","裸足","皮鞋","帆布鞋","拖鞋","木屐","短靴","长靴","厚底鞋","细跟","粗跟","玛丽珍鞋"],"multiple":false},
      {"key":"legwear","label":"袜饰","options":["","连裤袜","过膝袜","短袜","网袜","吊带袜","无","长筒袜","蕾丝袜","条纹袜","白丝","黑丝","肉丝","船袜"],"multiple":false},
    ],
  },
  pose: {
    kind: "pose",
    type: "pose",
    title: "姿势库",
    itemNoun: "姿势",
    unit: "个",
    briefLabel: "想要什么姿势",
    briefPlaceholder: "例如：坐在地板上回头看镜头，双腿屈起，慵懒一点",
    generateLabel: "✦ AI 生成姿势",
    generateHint: "使用创作助手当前配置的模型生成，输出两版：中英对照与纯英文。只含姿态、四肢与视角相关的 Tag，不含人物外貌、服装与背景；不消耗生图额度。",
    createLabel: "新建姿势",
    defaultName: "新姿势",
    tagPlaceholder: "坐姿, 回头, 动态",
    emptyTitle: "姿势库还是空的",
    emptyHint: "用「AI 生成姿势」按一句话需求生成中英对照与纯英文两版提示词，或点「新建姿势」手写一条；每条都能从本地历史挑封面和参考图对照。",
    facets: [
      {"key":"view","label":"视角","options":["","正面","侧面","背面","三分之二侧","俯视","仰视","特写","半身","全身","过肩","鸟瞰","第一人称","仰角","斜角"],"multiple":false},
      {"key":"posture","label":"姿态","options":["","站姿","坐姿","躺姿","跪姿","蹲姿","跳跃","行走","趴姿","倒立","蜷缩","劈叉","弯腰","后仰","前倾","侧身","悬浮"],"multiple":false},
      {"key":"motion","label":"动态","options":["","静态","动态","张力","放松","舒展","奔跑","转身","挥手","漂浮","颤抖","伸展"],"multiple":false},
      {"key":"interaction","label":"互动","options":["","看向镜头","回头","抱膝","叉腰","举手","伸展","摸头","捂脸","牵手","拥抱","亲吻","递物","比心","竖大拇指","单手托腮","双手背后"],"multiple":true},
    ],
  },
  scene: {
    kind: "scene",
    type: "scene",
    title: "场景及补充库",
    itemNoun: "场景",
    unit: "个",
    briefLabel: "想要什么场景",
    briefPlaceholder: "例如：雨天的城市街道，夜晚，霓虹灯，安静的氛围",
    generateLabel: "✦ AI 生成场景",
    generateHint: "使用创作助手当前配置的模型生成，输出两版：中英对照与纯英文。含主体数量、地点时间天气、环境陈设、光线氛围、构图镜头、表情特效，以及人物在该场景中的情境化动作；不含人物外貌、服装与孤立姿态；不消耗生图额度。",
    createLabel: "新建场景",
    defaultName: "新场景",
    tagPlaceholder: "雨天, 夜晚, 霓虹",
    emptyTitle: "场景及补充库还是空的",
    emptyHint: "用「AI 生成场景」按一句话需求生成中英对照与纯英文两版提示词，或点「新建场景」手写一条；每条都能从本地历史挑封面和参考图对照。",
    facets: [
      {"key":"subject","label":"主体","options":["","单人","双人","多人","无人物","一名男性","一名女性","男女各一","群像"],"multiple":false},
      {"key":"scene","label":"场景","options":["","室内","室外","街道","校园","森林","海边","咖啡厅","卧室","废墟","神社","教室","图书馆","医院","车站","天台","浴室","厨房","公园","花田","雨中","走廊"],"multiple":false},
      {"key":"time","label":"时间","options":["","清晨","白天","黄昏","夜晚","深夜","黎明","正午","日落","午夜","破晓"],"multiple":false},
      {"key":"season","label":"季节","options":["","春","夏","秋","冬","初春","盛夏","深秋","隆冬","梅雨"],"multiple":false},
      {"key":"weather","label":"天气","options":["","晴","阴","雨","雪","雾","雷雨","暴风雨","多云","大风","冰雹","彩虹","樱花飘落"],"multiple":true},
      {"key":"light","label":"光线","options":["","自然光","逆光","霓虹","烛光","昏暗","明亮","柔光","硬光","侧光","顶光","轮廓光","月光","荧光","火光","斑驳光影"],"multiple":true},
      {"key":"framing","label":"构图","options":["","特写","半身","全身","远景","俯视","仰视","中景","近景","超远景","对称构图","三分法","对角线","框架构图","广角"],"multiple":false},
      {"key":"mood","label":"氛围","options":["","安静","热闹","梦幻","压抑","温馨","神秘","恐怖","浪漫","悲伤","欢快","紧张","怀旧","治愈"],"multiple":true},
      {"key":"effect","label":"特效","options":["","光斑","花瓣","粒子","辉光","动态模糊","雨滴","雪花","火花","烟雾","闪光","镜头光晕","色差","噪点","景深虚化","速度线"],"multiple":true},
    ],
  },
};
