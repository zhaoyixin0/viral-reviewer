/**
 * CapCut draft_content.json schema (逆向自社区 capcut-cli + 直接观察 CapCut 桌面项目)
 *
 * 时间单位：全部 μs（微秒）
 * 路径：material.path 在 CapCut 里是绝对路径，但解压后第一次打开 CapCut 会自动 fix 到当前项目目录的子路径
 */

export type TimeRange = {
  start: number; // μs
  duration: number; // μs
};

// ===== Materials =====

export type VideoMaterial = {
  id: string; // UUID
  type: "video";
  path: string; // 相对当前项目目录的 "materials/xxx.mp4"
  material_name: string;
  width: number;
  height: number;
  duration: number; // μs
  has_audio: boolean;
};

export type AudioMaterial = {
  id: string;
  type: "extract_music" | "music";
  path: string;
  name: string;
  duration: number; // μs
};

export type TextMaterial = {
  id: string;
  type: "text";
  content: string; // CapCut 实际是 JSON-encoded text style，简化版用纯字符串
  font_size?: number;
  color?: string; // "#RRGGBB"
  alignment?: number; // 0=left, 1=center, 2=right
};

export type SpeedMaterial = {
  id: string;
  type: "speed";
  speed: number;
  mode: 0;
};

export type CanvasMaterial = {
  id: string;
  type: "canvas_color";
  color: "";
  image: "";
};

export type SoundChannelMaterial = {
  id: string;
  type: "none";
  audio_channel_mapping: 0;
  is_config_open: false;
};

export type PlaceholderMaterial = {
  id: string;
  type: "placeholder_info";
  error_path: "";
  error_text: "";
  meta_type: "none";
};

export type VocalSeparationMaterial = {
  id: string;
  type: "vocal_separation";
  choice: 0;
  production_path: "";
  removed_sounds: never[];
  time_range: { duration: 0; start: 0 };
};

// ===== Segments =====

export type Keyframe = {
  /** 相对 segment 起点的微秒偏移 */
  time_offset: number;
  /** 单值 keyframe（scale_x 1 个值） */
  values: number[];
};

export type CommonKeyframe = {
  /**
   * 常见类型：
   *   KFTypeScaleX / KFTypeScaleY (push_in / pull_out 缩放)
   *   KFTypePositionX / KFTypePositionY (平移)
   *   KFTypeAlpha (淡入淡出)
   *   KFTypeRotation
   */
  property_type: string;
  keyframe_list: Keyframe[];
};

export type SegmentClip = {
  alpha: number;
  rotation: number;
  scale: { x: number; y: number };
  transform: { x: number; y: number };
  flip?: { horizontal: false; vertical: false };
};

export type VideoSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange; // 在主时间轴的位置
  source_timerange: TimeRange; // 从视频源里截取的范围
  speed: number;
  volume: number;
  visible: boolean;
  clip?: SegmentClip;
  extra_material_refs: string[]; // 关联的 speed / canvas_color 等 material id
  render_index: number;
  common_keyframes?: CommonKeyframe[];
};

export type AudioSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange;
  source_timerange: TimeRange;
  speed: number;
  volume: number;
  visible: boolean;
  extra_material_refs: string[];
  render_index: number;
};

export type TextSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange;
  source_timerange: TimeRange;
  visible: boolean;
  extra_material_refs: string[];
  render_index: number;
};

// ===== Tracks =====

export type VideoTrack = {
  id: string;
  type: "video";
  attribute: 0;
  flag: 0;
  segments: VideoSegment[];
  is_default_name: boolean;
  name?: string;
};

export type AudioTrack = {
  id: string;
  type: "audio";
  attribute: 0;
  flag: 0;
  segments: AudioSegment[];
  is_default_name: boolean;
  name?: string;
};

export type TextTrack = {
  id: string;
  type: "text";
  attribute: 0;
  flag: 0;
  segments: TextSegment[];
  is_default_name: boolean;
  name?: string;
};

export type Track = VideoTrack | AudioTrack | TextTrack;

// ===== Root =====

export type DraftContent = {
  id: string;
  name: string;
  duration: number; // μs，整个项目时长
  fps: number;
  canvas_config: {
    width: number;
    height: number;
    ratio: string; // "9:16" / "16:9" / "original"
  };
  tracks: Track[];
  materials: {
    videos: VideoMaterial[];
    audios: AudioMaterial[];
    texts: TextMaterial[];
    speeds: SpeedMaterial[];
    canvases: CanvasMaterial[];
    sound_channel_mappings: SoundChannelMaterial[];
    placeholder_infos: PlaceholderMaterial[];
    vocal_separations: VocalSeparationMaterial[];
    /** Phase 5+ 字段：material_animations / audio_fades / transitions / video_effects */
    material_animations: unknown[];
    audio_fades: unknown[];
    transitions: unknown[];
    video_effects: unknown[];
  };
  /** 创建时间戳，CapCut 用 100-nanosecond ticks 自 1601-01-01 */
  create_time: number;
  update_time: number;
  /** 版本相关（CapCut 桌面端会读但兼容多版本） */
  version: number;
  new_version: string;
  last_modified_platform: {
    app_id: number;
    /** "lv" = 剪映国内版，"cc" = CapCut 国际版 */
    app_source: "lv" | "cc";
    app_version: string;
    device_id: string;
    hard_disk_id: string;
    mac_address: string;
    os: "windows" | "mac";
    os_version: string;
  };
};

// ===== Meta (draft_meta_info.json) =====

/**
 * draft_meta_info 设计 — R 方案（2026-05-13）：
 *
 * 历史：5db8fce 试图填 draft_materials[0].value[] = [{ file_Path: "./materials/<file>", ... }]
 * 让 CapCut 自动定位媒体。结果：CapCut 国际版 (cc / 8.5.0) 看到 entry 存在就跳过链接对话框，
 * 但又 resolve 不出 "./materials/..." 相对路径（draft_fold_path 是空字符串），陷入死锁
 * —— "链接素材"按钮无响应。
 *
 * 教训：CapCut 自己保存的 file_Path 是 user 第一次手动 link 时选的真实绝对路径
 * （如 "C:/Users/Admin/Downloads/.../materials/input.mp4"），不是 "./materials/..."。
 * 那个相对路径根本不是 CapCut 接受的格式，是 5db8fce 反向工程时取错了样本。
 *
 * R 方案：保留 draft_materials = [] 空数组（实际写 [{ type: 0, value: [] }]）。
 * CapCut 看到空就走"链接素材"对话框流程：用户选 zip 里的 materials/<file>.mp4，
 * CapCut 把绝对路径自己写回 draft_materials + draft_content videos[].path。
 * 用户每个新机器解压一次都要 link 一次，但至少能 work。
 *
 * 长期解药：在 zip 里附 PowerShell / bash 脚本，用户运行脚本时它知道 cwd，
 * 直接写绝对路径回 draft_meta_info.json 再启动 CapCut。本期不做。
 */
export type DraftMaterialGroup = {
  type: number; // 通常 0 = video/audio 主组
  value: never[]; // R 方案：始终空
};

export type DraftMetaInfo = {
  draft_id: string; // 同 DraftContent.id
  draft_name: string;
  draft_root_path: string; // 用空 — CapCut 自己会填
  draft_fold_path: string; // 用空 — CapCut 自己会填
  draft_removable_storage_device: "";
  draft_timeline_materials_size_: number;
  draft_materials: DraftMaterialGroup[];
  draft_materials_copied_info: never[];
  tm_draft_create: number;
  tm_draft_modified: number;
  tm_duration: number;
  draft_cover: "draft_cover.jpg";
  draft_deleted: false;
  draft_is_ai_packaging_used: false;
  draft_is_ai_shorts: false;
  draft_is_ai_translate: false;
  draft_is_article_video_draft: false;
  draft_is_from_deeplink: "false";
  draft_is_invisible: false;
  draft_new_version: string;
  draft_segment_extra_info: never[];
  draft_type: "";
};
