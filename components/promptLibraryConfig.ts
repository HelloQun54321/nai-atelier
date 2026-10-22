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
  general?: boolean;
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
    title: "外貌",
    itemNoun: "形象",
    unit: "个",
    briefLabel: "想要什么人物形象",
    briefPlaceholder: "例如：银发红瞳的少女，短发，娇小身材，精灵耳",
    generateLabel: "✦ AI 生成人物形象",
    generateHint: "仅生成外貌标签。",
    createLabel: "新建形象",
    defaultName: "新形象",
    tagPlaceholder: "银发, 红瞳, 短发",
    emptyTitle: "人物形象库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
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
      {"key":"hair_cut","label":"发型剪裁","options":["","直发","卷发","微卷","波波头","狼尾","双马尾","丸子头","短发","中长发"],"multiple":false},
      {"key":"hair_length","label":"发型长度","options":["","超短发","短发","及肩","中长","长发","及腰","超长"],"multiple":false},
      {"key":"hair_texture","label":"发质","options":["","顺滑","柔顺","蓬松","微卷","粗硬","潮湿","凌乱"],"multiple":false},
      {"key":"hair_tone","label":"发色构成","options":["","单色","渐层","内层挑染","发梢渐层","双色分区"],"multiple":false},
      {"key":"hair_second","label":"副发色","options":["","同主色","白色","黑色","粉色","蓝色","紫色","银色","金色"],"multiple":false},
      {"key":"bangs","label":"刘海","options":["","齐刘海","空气刘海","斜刘海","中分","无刘海","碎刘海","公主切"],"multiple":false},
      {"key":"hair_updo","label":"扎发方式","options":["","披发","马尾","高马尾","低马尾","双马尾","丸子头","半扎","编发"],"multiple":false},
      {"key":"waist","label":"腰线","options":["","无明显腰线","收腰","极细腰","柔软腰身"],"multiple":false},
      {"key":"presentation","label":"外观呈现","options":["","清纯","成熟","中性","幼态","御姐","少年感"],"multiple":true},
      {"key":"hair_detail","label":"发型细节","options":["","同基础","微碎","层次","挑染发丝","湿润"],"multiple":false},
      {"key":"eye_left","label":"左眼瞳色","options":["","同右眼","红色","蓝色","绿色","紫色","金色","异色"],"multiple":false},
      {"key":"eye_right","label":"右眼瞳色","options":["","同左眼","红色","蓝色","绿色","紫色","金色","异色"],"multiple":false},
      {"key":"breasts_shape","label":"胸部·形态","options":["","自然","圆润","挺拔","柔软","丰满"],"multiple":false},
    ],
  },
  wardrobe: {
    kind: "wardrobe",
    type: "wardrobe",
    title: "服饰",
    itemNoun: "服饰",
    unit: "套",
    briefLabel: "想要什么穿搭",
    briefPlaceholder: "例如：夏天海边度假，少女，清爽一点的连衣裙配草帽",
    generateLabel: "✦ AI 生成穿搭",
    generateHint: "仅生成服装与穿戴标签。",
    createLabel: "新建服饰",
    defaultName: "新服饰",
    tagPlaceholder: "连衣裙, 夏, 甜美",
    emptyTitle: "服饰库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
    facets: [
      {"key":"season","label":"季节","options":["","春","夏","秋","冬","四季","初春","盛夏","深秋","隆冬","梅雨"],"multiple":false},
      {"key":"occasion","label":"场合","options":["","日常","约会","职场","宴会","海边","校园","居家","运动","婚礼","派对","节日","旅行","正式","休闲","演出"],"multiple":false},
      {"key":"style","label":"风格","options":["","休闲","正式","甜美","复古","哥特","未来感","街头","居家","洛丽塔","朋克","和风","中式","蒸汽朋克","赛博","军装","女仆","护士","校服","制服","运动风"],"multiple":true},
      {"key":"gender","label":"对象","options":["","女性","男性","中性","双性","儿童","情侣","亲子","无性别"],"multiple":false},
      {"key":"palette","label":"配色","options":["","浅色","深色","暖色","冷色","黑白","撞色","单色","彩虹色","渐变色","透明感"],"multiple":false},
      {"key":"accessory","label":"配饰","options":["","帽子","眼镜","项链","耳饰","手套","围巾","腰带","头饰","口罩","墨镜","发饰","胸针","手链","戒指","臂环","腿环","颈圈","领带","蝴蝶结","耳麦"],"multiple":true},
      {"key":"footwear","label":"鞋子","options":["","高跟鞋","平底鞋","靴子","过膝靴","凉鞋","运动鞋","裸足","皮鞋","帆布鞋","拖鞋","木屐","短靴","长靴","厚底鞋","细跟","粗跟","玛丽珍鞋"],"multiple":false},
      {"key":"legwear","label":"袜饰","options":["","连裤袜","过膝袜","短袜","网袜","吊带袜","无","长筒袜","蕾丝袜","条纹袜","白丝","黑丝","肉丝","船袜"],"multiple":false},
      {"key":"top","label":"上装","options":["","无","衬衫","T恤","吊带","背心","针织衫","卫衣","露肩上衣","水手服"],"multiple":false},
      {"key":"top_color","label":"上装颜色","options":["","白色","黑色","灰色","蓝色","粉色","红色","米色","紫色","绿色"],"multiple":true},
      {"key":"bottom","label":"下装","options":["","无","短裙","长裙","百褶裙","热裤","牛仔裤","西装裤","短裤"],"multiple":false},
      {"key":"bottom_color","label":"下装颜色","options":["","同主色","白色","黑色","灰色","蓝色","粉色","红色","格纹"],"multiple":true},
      {"key":"outer","label":"外套","options":["","无","开衫","风衣","西装外套","夹克","大衣","斗篷","马甲"],"multiple":false},
      {"key":"outer_color","label":"外套颜色","options":["","同主色","白色","黑色","驼色","灰色","蓝色","红色"],"multiple":false},
      {"key":"onesie","label":"连体装","options":["","无","连衣裙","吊带裙","衬衫裙","泳装","连体衣","睡裙"],"multiple":false},
      {"key":"onesie_color","label":"连体装颜色","options":["","白色","黑色","蓝色","粉色","红色","花色"],"multiple":false},
      {"key":"cut","label":"版型","options":["","贴身","修身","宽松","oversize","短款","长款","A字"],"multiple":false},
      {"key":"length","label":"长度","options":["","超短","短","及膝","过膝","中长","长","拖地"],"multiple":false},
      {"key":"sleeve","label":"袖型","options":["","无袖","短袖","七分袖","长袖","泡泡袖","喇叭袖","露肩"],"multiple":false},
      {"key":"material","label":"材质","options":["","棉质","丝质","蕾丝","牛仔","皮革","针织","雪纺","薄纱"],"multiple":true},
      {"key":"translucency","label":"透光","options":["","不透明","微透","半透","透明"],"multiple":false},
      {"key":"pattern","label":"纹样","options":["","纯色","条纹","格纹","花朵","波点","蕾丝边","十字架","动物纹"],"multiple":true},
      {"key":"layering","label":"层次","options":["","单层","双层","叠穿","外套叠穿"],"multiple":false},
      {"key":"wear_state","label":"穿着状态","options":["","整齐","宽松","半脱","凌乱","湿润贴身"],"multiple":false},
      {"key":"temp_body","label":"身体临时状态","options":["","无","汗湿","湿润","沾水","破损"],"multiple":true},
      {"key":"legwear_color","label":"袜饰颜色","options":["","黑色","白色","灰色","肤色","蓝色","条纹"],"multiple":true},
      {"key":"accessory_color","label":"配饰颜色","options":["","金色","银色","黑色","红色","白色"],"multiple":true},
      {"key":"footwear_color","label":"鞋子颜色","options":["","黑色","白色","棕色","红色","银色"],"multiple":true},
      {"key":"outfit_scope","label":"生成范围","options":["","完整穿搭","仅上装","仅下装","仅配饰"],"multiple":false},
    ],
  },
  pose: {
    kind: "pose",
    type: "pose",
    title: "动作",
    itemNoun: "姿势",
    unit: "个",
    briefLabel: "想要什么姿势",
    briefPlaceholder: "例如：坐在地板上回头看镜头，双腿屈起，慵懒一点",
    generateLabel: "✦ AI 生成姿势",
    generateHint: "仅生成身体姿态、动作与互动标签。",
    createLabel: "新建姿势",
    defaultName: "新姿势",
    tagPlaceholder: "坐姿, 回头, 动态",
    emptyTitle: "姿势库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
    facets: [
      {"key":"posture","label":"姿态","options":["","站姿","坐姿","躺姿","跪姿","蹲姿","跳跃","行走","趴姿","倒立","蜷缩","劈叉","弯腰","后仰","前倾","侧身","悬浮"],"multiple":false},
      {"key":"motion","label":"动态","options":["","静态","动态","张力","放松","舒展","奔跑","转身","挥手","漂浮","颤抖","伸展"],"multiple":false},
      {"key":"interaction","label":"互动","options":["","看向镜头","回头","抱膝","叉腰","举手","伸展","摸头","捂脸","牵手","拥抱","亲吻","递物","比心","竖大拇指","单手托腮","双手背后"],"multiple":true},
      {"key":"activity","label":"活动","options":["","无","站立","行走","奔跑","坐着","躺着","蹲下","跳跃","倚靠"],"multiple":false},
      {"key":"head","label":"头部方向","options":["","正面","侧头","低头","抬头","回头"],"multiple":false},
      {"key":"facing","label":"身体朝向","options":["","正面","侧面","背面","四分之三侧"],"multiple":false},
      {"key":"facing_ref","label":"朝向参照","options":["","面向镜头","背对镜头","侧对镜头"],"multiple":false},
      {"key":"arms","label":"手臂","options":["","自然下垂","交叉抱胸","抬手","摸头发","背手"],"multiple":true},
      {"key":"legs","label":"腿部动作","options":["","并拢站立","交叉","屈膝","抬起一腿","跪坐"],"multiple":true},
      {"key":"gesture","label":"单人手势","options":["","无","比心","挥手","举杯","竖指抵唇","V字手势"],"multiple":true},
      {"key":"hold","label":"手持物","options":["","无","书","伞","杯子","花","武器","手机"],"multiple":true},
      {"key":"hold_hand","label":"持握手","options":["","左手","右手","双手"],"multiple":false},
      {"key":"gaze","label":"视线目标","options":["","看镜头","看他处","闭眼","低头看","望向上方"],"multiple":false},
      {"key":"support","label":"支撑物","options":["","无","靠墙","坐椅","倚栏","躺地"],"multiple":true},
    ],
  },
  scene: {
    kind: "scene",
    type: "scene",
    title: "场景",
    itemNoun: "场景",
    unit: "个",
    briefLabel: "想要什么场景",
    briefPlaceholder: "例如：雨天的城市街道，夜晚，霓虹灯，安静的氛围",
    generateLabel: "✦ AI 生成场景",
    generateHint: "生成场景、构图与光线等补充标签。",
    createLabel: "新建场景",
    defaultName: "新场景",
    tagPlaceholder: "雨天, 夜晚, 霓虹",
    emptyTitle: "场景及补充库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
    facets: [
      {"key":"subject","label":"主体","options":["","单人","双人","多人","无人物","一名男性","一名女性","男女各一","群像"],"multiple":false},
      {"key":"scene","label":"场景","options":["","室内","室外","街道","校园","森林","海边","咖啡厅","卧室","废墟","神社","教室","图书馆","医院","车站","天台","浴室","厨房","公园","花田","雨中","走廊"],"multiple":false},
      {"key":"time","label":"时间","options":["","清晨","白天","黄昏","夜晚","深夜","黎明","正午","日落","午夜","破晓"],"multiple":false},
      {"key":"season","label":"季节","options":["","春","夏","秋","冬","初春","盛夏","深秋","隆冬","梅雨"],"multiple":false},
      {"key":"weather","label":"天气","options":["","晴","阴","雨","雪","雾","雷雨","暴风雨","多云","大风","冰雹","彩虹","樱花飘落"],"multiple":true},
      {"key":"light","label":"光线","options":["","自然光","逆光","霓虹","烛光","昏暗","明亮","柔光","硬光","侧光","顶光","轮廓光","月光","荧光","火光","斑驳光影"],"multiple":true},
      {"key":"mood","label":"氛围","options":["","安静","热闹","梦幻","压抑","温馨","神秘","恐怖","浪漫","悲伤","欢快","紧张","怀旧","治愈"],"multiple":true},
      {"key":"spot","label":"地点与室内外","options":["","室内","室外","街道","校园","森林","海边","咖啡厅","卧室","废墟","神社","教室","图书馆","天台","车站","浴室"],"multiple":false},
      {"key":"props","label":"陈设与环境元素","options":["","无","桌椅","书架","花丛","窗帘","路灯","床铺"],"multiple":true},
      {"key":"background_crowd","label":"背景人群","options":["","无","少量路人","人群","模糊人群"],"multiple":false},
      {"key":"env_event","label":"环境事件","options":["","无","下雨","飘雪","风吹","花瓣飘落","落叶","烟花"],"multiple":true},
      {"key":"season_signs","label":"季节标志物","options":["","无","樱花","向日葵","红叶","雪","梅花"],"multiple":true},
      {"key":"light_dir","label":"光源方向","options":["","无明确","正面光","侧光","逆光","顶光","底光"],"multiple":false},
      {"key":"light_intensity","label":"光源强度","options":["","柔和","适中","强烈"],"multiple":false},
      {"key":"light_softness","label":"光源软硬","options":["","软光","硬光"],"multiple":false},
    ],
  },
  expression: {
    kind: "expression",
    type: "expression",
    title: "表情",
    itemNoun: "表情",
    unit: "个",
    briefLabel: "想要什么表情与情绪",
    briefPlaceholder: "例如：含泪的回眸，勉强的微笑，眼角泛红，气息不稳",
    generateLabel: "✦ AI 生成表情",
    generateHint: "生成情绪、可见表情、眼神与嘴部等表情状态标签。",
    createLabel: "新建表情",
    defaultName: "新表情",
    tagPlaceholder: "含泪, 勉强微笑, 泛红眼角",
    emptyTitle: "表情状态库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
    facets: [
      {"key":"emotion","label":"情绪基调","options":["","平静","喜悦","害羞","愤怒","悲伤","恐惧","惊讶","厌恶","兴奋","疲倦","空虚","魅惑","委屈","怀念"],"multiple":false},
      {"key":"expression","label":"可见表情","options":["","微笑","大笑","假笑","苦笑","冷笑","含泪微笑","嘟嘴","咬唇","挑眉","皱眉","闭眼","半睁眼","面无表情","张口"],"multiple":true},
      {"key":"expression_combo","label":"组合表情","options":["","含泪+微笑","脸红+低头","皱眉+咬唇","惊讶+张嘴","闭眼+浅笑"],"multiple":true},
      {"key":"eyes_state","label":"眼睛状态","options":["","睁开","半睁","闭上","眯眼","湿润","含泪","泛红","失焦","向上看","向下看","侧视"],"multiple":true},
      {"key":"brow","label":"眉部","options":["","平眉","皱眉","挑眉","八字眉","眉梢下垂"],"multiple":false},
      {"key":"mouth","label":"嘴部","options":["","闭合","微张","张开","微笑","吐舌","咬唇","鼓腮"],"multiple":false},
      {"key":"tears","label":"眼泪","options":["","含泪","流泪","泪痕","眼角泛红"],"multiple":true},
      {"key":"blush","label":"脸红","options":["","轻微微红","明显脸红","通红"],"multiple":false},
      {"key":"sweat","label":"汗水","options":["","额头汗珠","汗湿","紧张出汗"],"multiple":true},
      {"key":"eye_glow","label":"发光瞳","options":["","无","微弱","明显","强烈"],"multiple":false},
    ],
  },
  camera: {
    kind: "camera",
    type: "camera",
    title: "镜头",
    itemNoun: "镜头",
    unit: "个",
    briefLabel: "想要什么取景与镜头",
    briefPlaceholder: "例如：低角度仰拍，全身，广角，浅景深，画面微微倾斜",
    generateLabel: "✦ AI 生成镜头",
    generateHint: "生成景别、视角、透视与成像效果等镜头语言标签。",
    createLabel: "新建镜头",
    defaultName: "新镜头",
    tagPlaceholder: "全身, 低角度, 广角, 浅景深",
    emptyTitle: "镜头画面库还是空的",
    emptyHint: "新建条目或用一句话生成提示词。",
    facets: [
      {"key":"shot","label":"景别","options":["","特写","大特写","面部特写","半身","七分身","全身","远景","中景","近景","超远景"],"multiple":false},
      {"key":"angle","label":"俯仰角","options":["","平视","低角度","高角度","俯拍","仰拍","鸟瞰","虫眼"],"multiple":false},
      {"key":"viewpoint","label":"视点","options":["","正面","侧面","背面","四分之三侧","过肩","主观视角"],"multiple":false},
      {"key":"perspective","label":"透视","options":["","标准透视","广角","长焦","超广角","鱼眼","等距"],"multiple":false},
      {"key":"composition","label":"构图","options":["","居中构图","三分法","对称构图","对角线构图","框架构图","留白构图","引导线"],"multiple":true},
      {"key":"focus","label":"对焦","options":["","对焦人物","对焦面部","对焦眼睛","对焦手部","对焦道具"],"multiple":false},
      {"key":"dof","label":"景深","options":["","深景深","浅景深","背景虚化","前景虚化","全景清晰"],"multiple":false},
      {"key":"roll","label":"画面倾斜","options":["","不倾斜","轻微倾斜","明显倾斜"],"multiple":false},
      {"key":"clarity","label":"清晰度","options":["","清晰","锐利","柔和","轻微模糊"],"multiple":false},
      {"key":"effect","label":"成像效果","options":["","胶片颗粒","暗角","镜头光晕","色差","动态模糊","快门拖影"],"multiple":true},
      {"key":"motion","label":"运动趋势","options":["","静态","轻微动感","明显动感","运动模糊"],"multiple":false},
    ],
  },
};
