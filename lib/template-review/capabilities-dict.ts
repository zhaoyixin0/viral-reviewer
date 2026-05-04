/**
 * TikTok 特效团队能力字典 — 给 Generator 做能力多选输入用。
 *
 * 每个能力含 `disambiguation` 字段，用于区分最容易混淆的兄弟能力。
 * Generator system prompt 引用这些信息，避免 LLM 把"换脸"和"风格化"混为一谈。
 */

export type CapabilityCategory = "AI" | "VFX" | "Tool";

export type Capability = {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  disambiguation: string;
  typicalUse: string;
};

export const CAPABILITIES: Capability[] = [
  // ===== AI 类 =====
  {
    id: "ai_face_swap",
    name: "AI 换脸",
    category: "AI",
    description: "把视频中某人脸部替换为另一人或角色的脸",
    disambiguation: "vs AI 风格化：换脸只改脸部 ID，画面整体风格不变；风格化改整体色调质感",
    typicalUse: "把用户脸换成历史人物 / 明星 / IP 角色出演经典片段",
  },
  {
    id: "ai_face_morph",
    name: "AI 渐变换脸",
    category: "AI",
    description: "在两张脸之间做平滑过渡动画",
    disambiguation: "vs AI 换脸：换脸是替换，渐变换脸是过程展示；常用于变身/进化叙事",
    typicalUse: "丑变美 / 普通人变名人 / 童年到现在的渐变",
  },
  {
    id: "ai_lip_sync",
    name: "AI 唇形同步",
    category: "AI",
    description: "让画面中人物嘴型自动对齐目标音频",
    disambiguation: "vs AI 配音：唇形同步是视觉对齐音频，配音是生成音频本身；两者经常组合",
    typicalUse: "让历史人物开口讲现代台词 / 多语言版本快速本地化",
  },
  {
    id: "ai_voice_clone",
    name: "AI 声音克隆",
    category: "AI",
    description: "用少量音频样本生成目标人声音色的合成语音",
    disambiguation: "vs AI 配音：声音克隆需要参考样本生成同音色，AI 配音是直接生成预设音色",
    typicalUse: "用自己的声音替亲人发声 / IP 角色保持音色一致出新内容",
  },
  {
    id: "ai_voiceover",
    name: "AI 配音",
    category: "AI",
    description: "从文本生成自然人声朗读",
    disambiguation: "vs AI 声音克隆：配音用预设音色库，无需样本；克隆需要 30s+ 样本",
    typicalUse: "字幕一键生成口播 / 多语言旁白 / 商品介绍批量配音",
  },
  {
    id: "ai_motion_transfer",
    name: "AI 动作迁移",
    category: "AI",
    description: "把参考视频的人物动作映射到目标人/角色身上",
    disambiguation: "vs AI 换脸：动作迁移改的是动作姿态，不动脸；vs 唇形同步：动作迁移是全身动作",
    typicalUse: "用户跳明星舞蹈 / IP 角色复刻经典动作 / 老照片让人物动起来",
  },
  {
    id: "ai_stylize",
    name: "AI 风格化",
    category: "AI",
    description: "把照片/视频转换为油画 / 卡通 / 漫画 / 像素等艺术风格",
    disambiguation: "vs AI 换脸：风格化整体改画面，不改身份；vs 滤镜：风格化是 AI 重绘，滤镜是色彩调整",
    typicalUse: "自拍变吉卜力风 / 视频整段转 8-bit 像素风 / 一秒漫画化",
  },
  {
    id: "ai_text_to_image",
    name: "AI 文生图",
    category: "AI",
    description: "从文本提示词生成图像",
    disambiguation: "vs AI 风格化：文生图是从零生成，风格化是改造已有图",
    typicalUse: "封面图快速生成 / 用户脑洞具象化 / 表情包生产",
  },
  {
    id: "ai_text_to_video",
    name: "AI 文生视频",
    category: "AI",
    description: "从文本提示词生成短视频片段",
    disambiguation: "vs AI 文生图：文生视频含时间维度；vs 动作迁移：文生视频是从零生成，迁移有源动作",
    typicalUse: "无素材生成转场片段 / 故事板可视化 / 爆款关键帧扩展为视频",
  },
  {
    id: "ai_image_to_video",
    name: "AI 图生视频",
    category: "AI",
    description: "把静态图片驱动成有运镜/动作的短视频",
    disambiguation: "vs AI 文生视频：图生视频有具体起始帧约束，效果可控性更高",
    typicalUse: "老照片让人物动起来 / 静态海报变动态宣传片",
  },
  {
    id: "ai_inpaint",
    name: "AI 智能擦除",
    category: "AI",
    description: "去除画面中指定的人 / 物体 / 水印 / 路人",
    disambiguation: "vs AI 抠图：抠图是分离主体保留前景，擦除是去掉主体补全背景",
    typicalUse: "去前任 / 去路人甲 / 去掉 logo 水印",
  },
  {
    id: "ai_cutout",
    name: "AI 智能抠图",
    category: "AI",
    description: "自动识别并分离前景主体（人 / 商品 / 物体）",
    disambiguation: "vs 绿幕：抠图无需特殊背景；vs 擦除：抠图保留主体，擦除丢弃",
    typicalUse: "无绿幕换背景 / 商品图免抠 / 主体单独做特效",
  },
  {
    id: "ai_super_resolution",
    name: "AI 超分辨率",
    category: "AI",
    description: "把模糊低清素材提升到高清",
    disambiguation: "vs AI 修复：超分主要解决分辨率；修复主要解决划痕/老化损伤",
    typicalUse: "老视频修复 / 截图放大不糊 / 录屏画质增强",
  },
  {
    id: "ai_old_photo_repair",
    name: "AI 老照片修复",
    category: "AI",
    description: "修复老照片的划痕 / 褪色 / 模糊",
    disambiguation: "vs AI 超分：修复关注损伤，超分关注分辨率；vs AI 上色：老照片修复包含但不限于上色",
    typicalUse: "祖辈老照片修复 / 历史影像还原 / 婚礼纪念修复",
  },
  {
    id: "ai_colorize",
    name: "AI 黑白上色",
    category: "AI",
    description: "把黑白照片/视频自动上色",
    disambiguation: "vs AI 老照片修复：上色只是修复的一个子能力",
    typicalUse: "黑白历史影像彩色化 / 黑白童年照重现",
  },
  {
    id: "ai_avatar",
    name: "AI 数字分身",
    category: "AI",
    description: "用户上传几张照片，生成可用于多场景的数字角色",
    disambiguation: "vs AI 换脸：分身是建模一次到处用，换脸是单次替换",
    typicalUse: "数字员工口播 / IP 化分身演绎 / 同人创作",
  },
  {
    id: "ai_emotion_swap",
    name: "AI 表情替换",
    category: "AI",
    description: "改变照片/视频中人物的表情（哭→笑、严肃→搞怪）",
    disambiguation: "vs AI 换脸：表情替换不改身份只改表情",
    typicalUse: "证件照笑脸化 / 严肃照片变搞笑 / 表情包批量制作",
  },
  {
    id: "ai_age_morph",
    name: "AI 年龄变换",
    category: "AI",
    description: "预测/还原人物在不同年龄段的样貌",
    disambiguation: "vs AI 渐变换脸：年龄变换沿用同一身份，渐变换脸是不同身份过渡",
    typicalUse: "看自己 80 岁 / 老人变年轻 / 童年→现在过渡",
  },
  {
    id: "ai_dance_gen",
    name: "AI 舞蹈生成",
    category: "AI",
    description: "根据音乐和身高数据生成对应舞蹈动作",
    disambiguation: "vs AI 动作迁移：舞蹈生成无需源动作，从音乐直接生成",
    typicalUse: "不会跳舞也能产出舞蹈视频 / IP 角色 cover 流行舞",
  },
  {
    id: "ai_translate",
    name: "AI 视频翻译",
    category: "AI",
    description: "字幕翻译 + 唇形对齐 + 配音克隆，整片本地化",
    disambiguation: "组合能力：基于 lip_sync + voice_clone + ASR + 翻译",
    typicalUse: "中文视频一键英文版 / 跨地区市场扩散",
  },

  // ===== VFX 特效类 =====
  {
    id: "vfx_sticker",
    name: "贴纸",
    category: "VFX",
    description: "在画面上贴静态/动态图层（emoji、IP、品牌 logo）",
    disambiguation: "vs AR 道具：贴纸是 2D 浮层不跟踪空间；AR 道具有 3D 跟踪",
    typicalUse: "标注重点 / 加 IP 元素 / 趣味装饰",
  },
  {
    id: "vfx_filter",
    name: "滤镜",
    category: "VFX",
    description: "调整色温 / 对比度 / 饱和度等色彩参数的预设",
    disambiguation: "vs AI 风格化：滤镜是参数调整，风格化是 AI 重绘",
    typicalUse: "胶片感 / 复古感 / 莫兰迪 / 电影感预设",
  },
  {
    id: "vfx_transition",
    name: "转场",
    category: "VFX",
    description: "镜头之间的过渡效果（whip pan / 速度斜坡 / 撕裂）",
    disambiguation: "vs 卡点：转场是视觉过渡效果，卡点是节奏控制（两者常配合）",
    typicalUse: "前后对比变装 / 多镜头剪辑串联 / 节奏切换",
  },
  {
    id: "vfx_ar_prop",
    name: "AR 道具",
    category: "VFX",
    description: "跟踪头部/手部/空间的 3D 虚拟道具",
    disambiguation: "vs 贴纸：AR 道具有 3D 跟踪，能贴合面部/动作；贴纸是平面",
    typicalUse: "面部猫耳 / 手势触发特效 / 空间放置 3D 物体",
  },
  {
    id: "vfx_green_screen",
    name: "绿幕合成",
    category: "VFX",
    description: "用绿幕拍摄后替换背景",
    disambiguation: "vs AI 抠图：绿幕需要拍摄时配合，效果稳定但门槛高；抠图无需绿幕但稳定性弱",
    typicalUse: "天气主播效果 / 假装在世界各地 / 综艺花絮风格",
  },
  {
    id: "vfx_distortion",
    name: "扭曲变形",
    category: "VFX",
    description: "对画面做扭曲 / 拉伸 / 鱼眼 / 水波等几何变形",
    disambiguation: "vs AI 风格化：变形不改色彩内容只改形状；风格化改整体观感",
    typicalUse: "搞笑表情夸张 / 视觉冲击 hook / 节拍同步变形",
  },
  {
    id: "vfx_particle",
    name: "粒子特效",
    category: "VFX",
    description: "火花 / 雪花 / 樱花 / 烟雾等粒子动画",
    disambiguation: "vs AR 道具：粒子是充满画面的环境特效，道具是单点 3D 物体",
    typicalUse: "烟雾弹转场 / 漫天樱花氛围 / 闪光强调",
  },
  {
    id: "vfx_light_effect",
    name: "光效",
    category: "VFX",
    description: "光斑 / 光剑 / 体积光 / 霓虹等光线特效",
    disambiguation: "vs 滤镜：光效是局部叠加图层，滤镜是整体色彩调整",
    typicalUse: "动作高光强调 / 赛博朋克氛围 / 强化转场冲击",
  },
  {
    id: "vfx_text_animation",
    name: "动态文字",
    category: "VFX",
    description: "字幕的入场 / 强调 / 退场动画（Kinetic Typography）",
    disambiguation: "vs 字幕生成：动态文字是视觉动画，字幕生成是从音频出文本（两者常组合）",
    typicalUse: "音乐卡点字幕 / 重点强调 / 节奏感叙事",
  },
  {
    id: "vfx_slow_motion",
    name: "慢动作",
    category: "VFX",
    description: "时间维度变慢的特效（变速 / 高速摄影模拟）",
    disambiguation: "vs 倒放：慢动作是同方向放慢；倒放是逆向播放",
    typicalUse: "动作高光放大 / 变装高潮慢镜 / 情绪烘托",
  },
  {
    id: "vfx_reverse",
    name: "倒放",
    category: "VFX",
    description: "画面逆向播放",
    disambiguation: "vs 慢动作：倒放是反向，慢动作是同向慢速",
    typicalUse: "悬念逆转 / 因果颠倒搞笑 / 入场退场反转",
  },
  {
    id: "vfx_clone_paste",
    name: "分身合成",
    category: "VFX",
    description: "把同一人在画面中复制出多个分身",
    disambiguation: "vs AI 数字分身：分身合成是视频后期合成，AI 分身是模型生成",
    typicalUse: "一个人演多个角色 / 自己跟自己对话 / 群舞效果",
  },
  {
    id: "vfx_time_warp",
    name: "时空扭曲 (Time Warp)",
    category: "VFX",
    description: "拍摄时间维度扭曲，水平/垂直方向波浪推进",
    disambiguation: "vs 慢动作：Time Warp 是空间方向上的时间差，整张图不同区域时间不同",
    typicalUse: "Tiktok 经典玩法 / 集体舞蹈定格波浪 / 创意肖像",
  },
  {
    id: "vfx_bullet_time",
    name: "子弹时间",
    category: "VFX",
    description: "围绕静止主体环绕拍摄/合成的旋转效果",
    disambiguation: "vs 慢动作：子弹时间是空间旋转 + 时间冻结组合",
    typicalUse: "酷炫人物展示 / 动作高潮定格 / 婚礼跳跃留念",
  },
  {
    id: "vfx_loop",
    name: "无缝循环",
    category: "VFX",
    description: "首尾帧自动衔接形成无缝循环",
    disambiguation: "vs 倒放：循环是首尾接但保持方向；倒放反向",
    typicalUse: "GIF 化场景 / 催眠感叙事 / 节奏强化",
  },
  {
    id: "vfx_picture_in_picture",
    name: "画中画",
    category: "VFX",
    description: "在主画面叠加一个小画面（反应视频 / 双重视角）",
    disambiguation: "vs 分身合成：画中画是两个独立画面叠层；分身是同一画面里多个自己",
    typicalUse: "Reaction 视频 / 直播 + 屏幕录制 / 双视角解说",
  },
  {
    id: "vfx_3d_projection",
    name: "3D 投影",
    category: "VFX",
    description: "把 2D 画面投射到 3D 几何体表面",
    disambiguation: "vs AR 道具：投影是把画面贴到几何体；AR 道具是把几何体贴到现实",
    typicalUse: "立体海报展示 / 创意空间叙事 / 创意片头",
  },

  // ===== Tool 工具类 =====
  {
    id: "tool_auto_caption",
    name: "自动字幕",
    category: "Tool",
    description: "从音频自动生成字幕（带时间码）",
    disambiguation: "vs 动态文字：自动字幕是从音频出内容，动态文字是字幕的视觉动画",
    typicalUse: "口播视频字幕 / 多语言生成 / 无声场景识别",
  },
  {
    id: "tool_beat_sync",
    name: "自动卡点",
    category: "Tool",
    description: "自动检测音乐节拍并对齐画面切换",
    disambiguation: "vs 转场：卡点是节奏对齐，转场是过渡效果；卡点决定何时切，转场决定怎么切",
    typicalUse: "卡点变装 / 节拍同步切换 / 高节奏剪辑",
  },
  {
    id: "tool_template",
    name: "模板套用",
    category: "Tool",
    description: "用户用预设模板替换素材一键产出",
    disambiguation: "vs AI 文生视频：模板是结构固定换素材，文生视频是结构灵活生成",
    typicalUse: "节日模板 / 卡点变装模板 / 商品介绍模板",
  },
  {
    id: "tool_collab_invite",
    name: "合拍邀请",
    category: "Tool",
    description: "邀请其他用户基于当前视频做接力 / 同框 / 反应",
    disambiguation: "vs 普通分享：合拍是结构化协作，自动建立内容关系链",
    typicalUse: "情侣合拍 / 朋友接力 / 挑战赛传播机制",
  },
  {
    id: "tool_chain_unlock",
    name: "解锁入口",
    category: "Tool",
    description: "完成特定动作后才解锁下一步功能/特效",
    disambiguation: "vs 模板：解锁是流程门槛设计，强调用户行为路径",
    typicalUse: "看完三条解锁同款 / 拍三人合影解锁 IP 道具",
  },
  {
    id: "tool_batch",
    name: "批量处理",
    category: "Tool",
    description: "一次操作应用到多条素材",
    disambiguation: "vs 模板：批量是同一动作应用多个素材；模板是同一结构换素材",
    typicalUse: "批量风格化照片 / 批量翻译多语言 / 批量加水印",
  },
  {
    id: "tool_remix",
    name: "二创素材",
    category: "Tool",
    description: "提供原片可被剪取的片段供二创",
    disambiguation: "vs 合拍邀请：Remix 拿原片素材剪辑，合拍是分屏共演",
    typicalUse: "明星授权片段 / 经典电影素材库 / IP 二创激励",
  },
  {
    id: "tool_template_share",
    name: "模板共享",
    category: "Tool",
    description: "用户把自己做的模板发布给他人复用",
    disambiguation: "vs 模板套用：共享是上传方，套用是使用方",
    typicalUse: "UGC 模板社区 / 创作者经济 / 玩法裂变",
  },
  {
    id: "tool_dm_trigger",
    name: "DM 触发器",
    category: "Tool",
    description: "用户在 DM 里触发的特效/玩法",
    disambiguation: "vs feed 玩法：DM 是私域低频异步，玩法节奏不能过高频",
    typicalUse: "情侣纪念日触发 / 朋友圈生日特效 / 好友互动小卡片",
  },
  {
    id: "tool_live_effect",
    name: "直播特效",
    category: "Tool",
    description: "直播中的实时特效 / 互动按钮 / 礼物特效",
    disambiguation: "vs 录播特效：直播要求实时低延迟、抗带宽抖动",
    typicalUse: "直播打 PK 特效 / 礼物全屏触发 / 主播游戏化互动",
  },
  {
    id: "tool_growth_loop",
    name: "成长系统",
    category: "Tool",
    description: "等级 / 累积 / 衰减 / 长周期状态系统",
    disambiguation: "vs 解锁入口：成长是长期累积，解锁是单次门槛",
    typicalUse: "连续打卡奖励 / 数字宠物养成 / 用户等级特效",
  },
];

export const CAPABILITIES_BY_ID: Record<string, Capability> = Object.fromEntries(
  CAPABILITIES.map((c) => [c.id, c]),
);

export const CAPABILITIES_BY_CATEGORY: Record<CapabilityCategory, Capability[]> = {
  AI: CAPABILITIES.filter((c) => c.category === "AI"),
  VFX: CAPABILITIES.filter((c) => c.category === "VFX"),
  Tool: CAPABILITIES.filter((c) => c.category === "Tool"),
};

/**
 * 给 LLM 看的能力字典文本格式，每行一个能力的精简描述。
 * 用于 Generator system prompt 注入参考词库（防止 LLM 编造不存在的能力名）。
 */
export function formatCapabilitiesForPrompt(ids?: string[]): string {
  const list = ids
    ? CAPABILITIES.filter((c) => ids.includes(c.id))
    : CAPABILITIES;
  return list
    .map((c) => `- [${c.id}] ${c.name}（${c.category}）：${c.description}。区别：${c.disambiguation}`)
    .join("\n");
}
