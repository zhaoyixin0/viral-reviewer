# CapCut Setup-Script Link Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/analyze` 导出的 CapCut zip 解压后能稳定 link 素材（不再 "Couldn't link"），方式是在 zip 里附一个 setup 脚本，由用户机器本地把素材路径改写成绝对路径。

**Architecture:** Server 端在 `draft_content.json` / `draft_meta_info.json` 里把所有绝对路径位置写成唯一占位 token（`__VR_PROJECT_DIR__` / `__VR_DRAFTS_DIR__`），并预先构造完整、合法的 JSON（server 有 ffprobe 元数据）。zip 根目录附 `setup.bat` / `setup.ps1` / `setup.sh`，脚本只做三件事：探测 CapCut drafts 目录 → 把项目文件夹搬进去 → 对两个 JSON 文件做**纯字面文本替换**把 token 换成本机绝对路径。脚本不解析 JSON，所以 PowerShell 和 bash 都能可靠实现。

**Tech Stack:** Next.js App Router + `jszip` + `vitest` + PowerShell 5.1 / bash 3.2。

---

## 根因（已由窗口 3 review 通过）

CapCut 用「指向素材原始位置的绝对路径」引用素材，存在 `draft_content.json` 的 `materials.*.path` **和** `draft_meta_info.json` 的 `draft_materials[].value[].file_Path`。三方证据交叉验证：本机原生项目 `0203`（`C:/Users/yixin/Downloads/...mp4`）、`0205`、capcut-cli 源码（`resolve(assetsDir, filename)` 绝对路径 + 本地运行）。

我们服务端生成 zip 无法知道用户解压到哪 → 写不出有效绝对路径 → 过去 4 次尝试（placeholder / 填相对 file_Path / 纯文件名 / `materials/` 相对路径）全失败。绝对路径只能在用户机器本地生成，这正是 capcut-cli 必须本地运行的原因。

**纠正历史误判**：`schema.ts` 注释说 commit `5db8fce` 填 `draft_materials` 导致"死锁"——错。死锁是因为它填的 `file_Path` 是相对的 `./materials/input.mp4`；原生 `0203` 证明填**绝对** `file_Path` 正是 CapCut 能用的状态。

## 决策点（窗口 3 要求明确）

**决策 1 — 跨平台 JSON 改写策略：选「占位 token + 纯字面文本替换」（不在任一平台解析 JSON）。**
- 否决方案 (a)「附 setup.mjs 纯 Node」：引入"用户需装 Node"前提，目标用户是 CapCut 剪辑师不是开发者，绝大多数没装 Node。
- 否决方案 (b)「.sh 内嵌 Node/Python」：macOS 默认无 `jq`、无 Node、自 macOS 12.3 起无可靠 `python3`（只剩 stub）；实现不对称且脆弱。
- 选定方案 (c)：server 已有全部 ffprobe 元数据 → server 预构造**完整合法**的 `draft_content.json` / `draft_meta_info.json`，只在绝对路径处留唯一 token。脚本做字面 `String.Replace` / `sed` 替换。替换值用**正斜杠**路径（原生 `0203` 证明 CapCut 接受 `C:/Users/...` 正斜杠），彻底绕开 JSON 反斜杠转义问题。脚本会校验路径不含 `|` `&` 换行（sed 特殊字符 / JSON 破坏字符），含则 abort 并提示。

**决策 2 — Windows 双击执行**：`.ps1` 双击默认被记事本打开、execution policy 默认 Restricted 会 block。附 `setup.bat`（双击能跑），内部 `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1`。README 写明 Windows 用户双击 `setup.bat`。

**决策 3 — drafts 目录探测带 fallback**：探测多个候选（CapCut + 剪映 JianyingPro）。全失败时**不静默失败**——在当前位置就地修复路径 + 提示用户「若要换位置，重新解压 zip 到目标位置再运行脚本」（原始 zip 永远带 token，可重复使用）。

**决策 4 — 安全**：脚本纯本地文件操作、零网络请求、内容简短可读。README 说明脚本做什么。窗口 3 review 时把"零网络 / 纯文件操作"作为 checklist。

**决策 5 — 占位 token**：`__VR_PROJECT_DIR__`（项目文件夹绝对路径）、`__VR_DRAFTS_DIR__`（其父目录 = drafts 目录）。两个 token 全大写下划线包裹，绝不与真实路径冲突；脚本做可靠 find & replace。

**配套服务端改动**：保留用户原始视频文件名（不再 hardcode `input.mp4`）；`draft_meta_info.draft_materials` 复刻原生 `0203` 的七组结构（type 0/1/2/3/6/7/8）。

---

## File Structure

**新建：**
- `lib/capcut-compiler/setup-scripts/tokens.ts` — 两个 token 常量。被 `build.ts`、`package.ts`、测试共享（DRY 单一来源）。
- `lib/capcut-compiler/setup-scripts/index.ts` — `SETUP_BAT` / `SETUP_PS1` / `SETUP_SH` 三个脚本字符串常量。存为 `.ts` 而非真实脚本文件，是为了 Next.js serverless 打包可靠（避免 `fs.readFileSync` + `outputFileTracingIncludes` 的坑）。
- `tests/capcut-compiler/build.test.ts` — `buildDraftContent` 的 token 路径 + 七组 meta 测试。
- `tests/capcut-compiler/package.test.ts` — zip 结构 + token 替换契约测试。
- `tests/capcut-compiler/sanitize.test.ts` — `sanitizeVideoFileName` 单元测试。

**修改：**
- `lib/capcut-compiler/schema.ts` — `DraftMaterialGroup` 类型 + 新增 `DraftMaterialEntry`；修正 `5db8fce` 错误注释。
- `lib/capcut-compiler/build.ts` — `path` 用 token；`draft_meta_info` 构造七组 `draft_materials`；导出 `sanitizeVideoFileName`。
- `lib/capcut-compiler/package.ts` — 把三个脚本写进 zip 根；重写 README。
- `app/api/compile-capcut/route.ts` — `RequestSchema` 加 `videoFileName`；sanitize 后传给 build/package。
- `components/technique-match/InputPanel.tsx` — `onSubmit` 带上 `videoFileName`。
- `components/technique-match/useAnalyzeStream.ts` — `SubmitArgs` + state 携带 `videoFileName`。
- `components/technique-match/ResultsArea.tsx` — `AnalyzeResultsProps` 加可选 `videoFileName`，传给 `CapCutExport`。
- `app/analyze/page.tsx` — 把 `stream.videoFileName` 传给 `AnalyzeResults`。
- `components/technique-match/CapCutExport.tsx` — 加可选 `videoFileName` prop，放进 compile-capcut 请求体。

---

### Task 1: Token 常量 + schema 类型 + 修正错误注释

**Files:**
- Create: `lib/capcut-compiler/setup-scripts/tokens.ts`
- Modify: `lib/capcut-compiler/schema.ts:227-277`

- [ ] **Step 1: 创建 token 常量文件**

创建 `lib/capcut-compiler/setup-scripts/tokens.ts`：

```ts
/**
 * 占位 token：server 把它写进 draft JSON 的绝对路径位置，
 * setup 脚本在用户机器上做纯字面替换换成本机绝对路径。
 * 必须是绝不与真实路径/内容冲突的唯一串。
 */
export const TOKEN_PROJECT_DIR = "__VR_PROJECT_DIR__";
export const TOKEN_DRAFTS_DIR = "__VR_DRAFTS_DIR__";
```

- [ ] **Step 2: 替换 schema.ts 的 DraftMetaInfo 注释块 + 类型**

定位 `lib/capcut-compiler/schema.ts` 第 227-277 行（`// ===== Meta` 到文件结尾）。整段替换为：

```ts
// ===== Meta (draft_meta_info.json) =====

/**
 * draft_meta_info 设计 — Setup-Script 方案（2026-05-13）：
 *
 * CapCut 用「指向素材原始位置的绝对路径」引用素材，存在 draft_content.json 的
 * materials.*.path 和 draft_meta_info.json 的 draft_materials[].value[].file_Path
 * （本机原生项目 0203 / 0205 + capcut-cli 源码三方验证）。
 *
 * 历史教训纠正：commit 5db8fce 试图填 draft_materials 让 CapCut 自动定位媒体，
 * 失败的真正原因是它填的 file_Path 是相对路径 "./materials/input.mp4" —— 不是
 * "填 draft_materials" 这个动作错。原生 0203 证明：填**绝对** file_Path 正是
 * CapCut 能用的状态。
 *
 * 本方案：server 端把 file_Path / draft_fold_path / draft_root_path / videos[].path
 * 全写成占位 token（见 setup-scripts/tokens.ts），zip 附 setup 脚本，用户解压后
 * 运行脚本在本机把 token 字面替换成绝对路径。draft_materials 复刻原生 0203 的
 * 七组结构（type 0/1/2/3/6/7/8），type 0 组放视频（和 BGM）条目。
 */

/** draft_materials[].value[] 单条素材记录，对齐原生 0203 项目结构 */
export type DraftMaterialEntry = {
  ai_group_type: "";
  create_time: number;
  duration: number; // μs
  extra_info: string; // 文件名，如 "20260429-200100.mp4"
  /** 素材绝对路径；server 写 token，setup 脚本替换 */
  file_Path: string;
  height: number;
  /** 必须等于 draft_content.json 里对应 material 的 id */
  id: string;
  import_time: number;
  import_time_ms: number;
  item_source: 1;
  md5: "";
  metetype: "video" | "music";
  roughcut_time_range: { duration: number; start: number };
  sub_time_range: { duration: number; start: number };
  type: number;
  width: number;
};

export type DraftMaterialGroup = {
  /** 0=本地导入媒体（视频/音频），1/2/3/6/7/8=其它分类，本方案只往 type 0 填 */
  type: number;
  value: DraftMaterialEntry[];
};

export type DraftMetaInfo = {
  draft_id: string; // 同 DraftContent.id
  draft_name: string;
  /** drafts 目录绝对路径（com.lveditor.draft）；server 写 token */
  draft_root_path: string;
  /** 项目文件夹绝对路径；server 写 token */
  draft_fold_path: string;
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
```

- [ ] **Step 3: 修正 schema.ts 顶部 path 注释**

定位 `lib/capcut-compiler/schema.ts` 第 1-6 行：

```ts
/**
 * CapCut draft_content.json schema (逆向自社区 capcut-cli + 直接观察 CapCut 桌面项目)
 *
 * 时间单位：全部 μs（微秒）
 * 路径：material.path 在 CapCut 里是绝对路径，但解压后第一次打开 CapCut 会自动 fix 到当前项目目录的子路径
 */
```

替换为：

```ts
/**
 * CapCut draft_content.json schema (逆向自社区 capcut-cli + 直接观察 CapCut 桌面项目)
 *
 * 时间单位：全部 μs（微秒）
 * 路径：material.path 必须是素材的绝对路径（原生项目 0203/0205 验证）。server 端
 *       写占位 token，zip 附的 setup 脚本在用户机器上替换成本机绝对路径。
 */
```

- [ ] **Step 4: 同步修正 VideoMaterial.path 行内注释**

定位 `lib/capcut-compiler/schema.ts` 第 18 行 `path: string; // 相对当前项目目录的 "materials/xxx.mp4"`，替换为：

```ts
  path: string; // 绝对路径；server 写 token（见 setup-scripts/tokens.ts）
```

- [ ] **Step 5: 验证类型编译通过**

Run: `npx tsc --noEmit`
Expected: EXIT 0（此时 `build.ts` 还没改，但 `DraftMetaInfo` 字段名未变、只是 `draft_materials` 元素类型收窄，`build.ts` 现有的 `[{ type: 0, value: [] }]` 仍兼容 `DraftMaterialGroup[]`，应编译通过）

- [ ] **Step 6: Commit**

```bash
git add lib/capcut-compiler/setup-scripts/tokens.ts lib/capcut-compiler/schema.ts
git commit -m "refactor(capcut): add path tokens, draft_materials types, fix 5db8fce comment"
```

---

### Task 2: build.ts — token 路径 + 七组 draft_materials

**Files:**
- Modify: `lib/capcut-compiler/build.ts`
- Test: `tests/capcut-compiler/build.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/capcut-compiler/build.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildDraftContent, type CompileInput } from "@/lib/capcut-compiler/build";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

const META: VideoMeta = {
  durationSec: 10,
  fps: 30,
  width: 1080,
  height: 1920,
  codec: "h264",
  bitrate: 1_000_000,
  hasAudio: true,
};

function makeInput(over: Partial<CompileInput> = {}): CompileInput {
  return {
    projectName: "test-project",
    videoFileName: "my-video.mp4",
    meta: META,
    potential: { base: { actions: [] } } as unknown as MaterialPotential,
    match: {
      userVideoId: "u",
      reports: [],
      topPriorityActions: [],
      globalDoNots: [],
      recommendedBgms: [],
      trimRanges: [],
    } as unknown as TechniqueMatchingResult,
    ...over,
  };
}

describe("buildDraftContent — token paths", () => {
  it("video material path uses the project-dir token", () => {
    const { draftContent } = buildDraftContent(makeInput());
    expect(draftContent.materials.videos[0].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/my-video.mp4`,
    );
  });

  it("bgm audio path uses the project-dir token", () => {
    const { draftContent } = buildDraftContent(
      makeInput({ bgmFileName: "song.mp3", bgmDurationSec: 5 }),
    );
    expect(draftContent.materials.audios[0].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/song.mp3`,
    );
  });
});

describe("buildDraftContent — draft_meta_info", () => {
  it("fold/root paths use tokens", () => {
    const { metaInfo } = buildDraftContent(makeInput());
    expect(metaInfo.draft_fold_path).toBe(TOKEN_PROJECT_DIR);
    expect(metaInfo.draft_root_path).toBe(TOKEN_DRAFTS_DIR);
  });

  it("draft_materials has the 7-group native structure", () => {
    const { metaInfo } = buildDraftContent(makeInput());
    expect(metaInfo.draft_materials.map((g) => g.type)).toEqual([
      0, 1, 2, 3, 6, 7, 8,
    ]);
  });

  it("type-0 group holds the video entry; id matches the video material", () => {
    const { draftContent, metaInfo } = buildDraftContent(makeInput());
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(1);
    const entry = group0.value[0];
    expect(entry.id).toBe(draftContent.materials.videos[0].id);
    expect(entry.file_Path).toBe(`${TOKEN_PROJECT_DIR}/materials/my-video.mp4`);
    expect(entry.extra_info).toBe("my-video.mp4");
    expect(entry.metetype).toBe("video");
    expect(entry.width).toBe(1080);
    expect(entry.height).toBe(1920);
  });

  it("type-0 group gets a second entry when BGM is present", () => {
    const { draftContent, metaInfo } = buildDraftContent(
      makeInput({ bgmFileName: "song.mp3", bgmDurationSec: 5 }),
    );
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(2);
    const bgmEntry = group0.value[1];
    expect(bgmEntry.id).toBe(draftContent.materials.audios[0].id);
    expect(bgmEntry.metetype).toBe("music");
    expect(bgmEntry.extra_info).toBe("song.mp3");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/capcut-compiler/build.test.ts`
Expected: FAIL —— `path` 还是 `materials/my-video.mp4` 不带 token，`draft_materials` 还是 `[{type:0,value:[]}]`。

- [ ] **Step 3: 改 build.ts import**

定位 `lib/capcut-compiler/build.ts` 第 1-2 行：

```ts
import { randomUUID } from "crypto";
import { secToMicroseconds } from "@/lib/cut-plan/time-code";
```

替换为：

```ts
import { randomUUID } from "crypto";
import { secToMicroseconds } from "@/lib/cut-plan/time-code";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { DraftMaterialEntry } from "./schema";
```

注意：`./schema` 已有的 `import type { ... }` 块（第 14-33 行）里也要加 `DraftMaterialEntry`，或单独 import 如上。用单独 import 避免改动大 import 块。

- [ ] **Step 4: 改 videoMaterial.path 用 token**

定位 `lib/capcut-compiler/build.ts` 第 163-185 行（`// ===== Materials =====` 注释块 + `videoMaterial`）。整段替换为：

```ts
  // ===== Materials =====

  // path 用占位 token：server 端写不出用户机器的绝对路径，所以写
  // `${TOKEN_PROJECT_DIR}/materials/<file>`，zip 附的 setup 脚本在用户机器上
  // 把 token 字面替换成项目文件夹的绝对路径。CapCut 要的就是绝对路径
  // （原生项目 0203/0205 验证）。
  const videoMaterial: VideoMaterial = {
    id: id(),
    type: "video",
    path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileName}`,
    material_name: input.videoFileName,
    width: input.meta.width,
    height: input.meta.height,
    duration: durationUs,
    has_audio: input.meta.hasAudio,
  };
```

- [ ] **Step 5: 改 bgmMaterial.path 用 token**

定位 `lib/capcut-compiler/build.ts` 第 187-201 行（`// 视频自带音轨...` 注释 + `bgmMaterial`）。整段替换为：

```ts
  // 视频自带音轨已经在 video segment 里播放（speed=1, volume=1）。
  // 只有用户主动上传 BGM 时才创建独立 audio 轨（Phase 5.5）。
  //
  // BGM path 同样用占位 token。
  const bgmMaterial: AudioMaterial | null = input.bgmFileName
    ? {
        id: id(),
        type: "music",
        path: `${TOKEN_PROJECT_DIR}/materials/${input.bgmFileName}`,
        name: input.bgmFileName,
        duration: secToMicroseconds(
          Math.min(input.bgmDurationSec ?? input.meta.durationSec, input.meta.durationSec),
        ),
      }
    : null;
```

- [ ] **Step 6: 在 buildDraftContent 里构造七组 draft_materials**

定位 `lib/capcut-compiler/build.ts` 第 516-544 行（`// R 方案：draft_materials 留空...` 注释块 + 整个 `metaInfo` 对象）。整段替换为：

```ts
  // Setup-Script 方案：draft_materials 复刻原生 0203 项目的七组结构
  // （type 0/1/2/3/6/7/8）。type 0 = 本地导入媒体组，放视频（和 BGM）条目。
  // file_Path 写占位 token，setup 脚本在用户机器上替换成绝对路径。
  // entry.id 必须等于 draft_content 里对应 material 的 id（CapCut 靠它关联）。
  const nowSec = Math.floor(Date.now() / 1000);
  const nowUs = Date.now() * 1000;

  const videoMetaEntry: DraftMaterialEntry = {
    ai_group_type: "",
    create_time: nowSec,
    duration: durationUs,
    extra_info: input.videoFileName,
    file_Path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileName}`,
    height: input.meta.height,
    id: videoMaterial.id,
    import_time: nowSec,
    import_time_ms: nowUs,
    item_source: 1,
    md5: "",
    metetype: "video",
    roughcut_time_range: { duration: durationUs, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
    width: input.meta.width,
  };

  const group0Entries: DraftMaterialEntry[] = [videoMetaEntry];

  if (bgmMaterial && input.bgmFileName) {
    group0Entries.push({
      ai_group_type: "",
      create_time: nowSec,
      duration: bgmMaterial.duration,
      extra_info: input.bgmFileName,
      file_Path: `${TOKEN_PROJECT_DIR}/materials/${input.bgmFileName}`,
      height: 0,
      id: bgmMaterial.id,
      import_time: nowSec,
      import_time_ms: nowUs,
      item_source: 1,
      md5: "",
      metetype: "music",
      roughcut_time_range: { duration: bgmMaterial.duration, start: 0 },
      sub_time_range: { duration: -1, start: -1 },
      type: 0,
      width: 0,
    });
  }

  const metaInfo: DraftMetaInfo = {
    draft_id: projectId,
    draft_name: input.projectName,
    // setup 脚本会把这两个 token 替换成本机绝对路径
    draft_root_path: TOKEN_DRAFTS_DIR,
    draft_fold_path: TOKEN_PROJECT_DIR,
    draft_removable_storage_device: "",
    draft_timeline_materials_size_: 0,
    draft_materials: [
      { type: 0, value: group0Entries },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    tm_draft_create: nowMs(),
    tm_draft_modified: nowMs(),
    tm_duration: outputDurationUs,
    draft_cover: "draft_cover.jpg",
    draft_deleted: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_new_version: "167.0.0",
    draft_segment_extra_info: [],
    draft_type: "",
  };

  return { draftContent, metaInfo };
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/capcut-compiler/build.test.ts`
Expected: PASS（全部 6 个 it）

- [ ] **Step 8: 验证类型编译通过**

Run: `npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 9: Commit**

```bash
git add lib/capcut-compiler/build.ts tests/capcut-compiler/build.test.ts
git commit -m "feat(capcut): write path tokens + 7-group draft_materials in build"
```

---

### Task 3: setup 脚本模块（.bat / .ps1 / .sh 字符串）

**Files:**
- Create: `lib/capcut-compiler/setup-scripts/index.ts`

- [ ] **Step 1: 创建 setup-scripts/index.ts**

创建 `lib/capcut-compiler/setup-scripts/index.ts`。三个脚本以字符串常量导出。

> 注意 `SETUP_SH` 是 TS 模板字符串，bash 的 `${...}` 必须写成 `\${...}` 才不会被 TS 当插值。`SETUP_PS1` 已改写为不含反引号（PowerShell 反引号会破坏 TS 模板字符串）。`SETUP_BAT` 无需转义。

```ts
/**
 * zip 根目录附带的 setup 脚本。用户解压后运行，脚本：
 *   1. 找到同级唯一的项目文件夹
 *   2. 校验路径不含会破坏字面替换的字符（| & 换行）
 *   3. 探测 CapCut / 剪映 drafts 目录
 *   4. 把项目文件夹搬进 drafts 目录（找不到则就地处理）
 *   5. 对 draft_content.json / draft_meta_info.json 做纯字面 token 替换
 * 脚本不解析 JSON —— 所以 PowerShell 和 bash 都能可靠实现。
 * 纯本地文件操作，零网络请求。
 */

export const SETUP_BAT = `@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
echo 按任意键关闭此窗口...
pause >nul
`;

export const SETUP_PS1 = `$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot

$subDirs = @(Get-ChildItem -LiteralPath $scriptDir -Directory)
if ($subDirs.Count -ne 1) {
  Write-Host ("错误：脚本同级应正好有 1 个项目文件夹，实际找到 " + $subDirs.Count + " 个。") -ForegroundColor Red
  Write-Host "请确认解压结构为 setup.bat + setup.ps1 + setup.sh + 单个项目文件夹。"
  exit 1
}
$projectDir = $subDirs[0].FullName
$projectName = $subDirs[0].Name

if ($projectDir -match '[\\|&\\r\\n]') {
  Write-Host "错误：项目路径含特殊字符（| 或 &），CapCut 可能无法识别。" -ForegroundColor Red
  Write-Host "请把整个文件夹移到简单路径（如 C:\\Temp\\）后重新运行。"
  exit 1
}

$candidates = @(
  (Join-Path $env:LOCALAPPDATA "CapCut\\User Data\\Projects\\com.lveditor.draft"),
  (Join-Path $env:LOCALAPPDATA "JianyingPro\\User Data\\Projects\\com.lveditor.draft")
)
$draftsDir = $null
foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { $draftsDir = $c; break } }

if ($draftsDir) {
  $final = Join-Path $draftsDir $projectName
  $n = 2
  while (Test-Path -LiteralPath $final) {
    $final = Join-Path $draftsDir ($projectName + " (" + $n + ")")
    $n++
  }
} else {
  $final = $projectDir
}

if ($final -ne $projectDir) {
  Move-Item -LiteralPath $projectDir -Destination $final
}

$finalFwd = $final.Replace("\\", "/")
$draftsFwd = (Split-Path $final -Parent).Replace("\\", "/")

foreach ($f in @("draft_content.json", "draft_meta_info.json")) {
  $p = Join-Path $final $f
  $raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  $raw = $raw.Replace("__VR_PROJECT_DIR__", $finalFwd)
  $raw = $raw.Replace("__VR_DRAFTS_DIR__", $draftsFwd)
  [System.IO.File]::WriteAllText($p, $raw, (New-Object System.Text.UTF8Encoding $false))
}

if ($draftsDir) {
  Write-Host ("完成！打开 CapCut，在项目列表里双击 " + $projectName + " 即可（不会再弹链接素材对话框）。") -ForegroundColor Green
} else {
  Write-Host "路径已按当前位置修复，可直接从这里打开 CapCut 项目。" -ForegroundColor Yellow
  Write-Host "若想把项目放进 CapCut 目录：重新解压原始 zip 到目标位置后再运行本脚本。"
  Write-Host ("当前项目位置： " + $final)
}
`;

export const SETUP_SH = `#!/usr/bin/env bash
set -euo pipefail

scriptDir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

subDirs=()
while IFS= read -r d; do subDirs+=("$d"); done < <(find "$scriptDir" -mindepth 1 -maxdepth 1 -type d)
if [ "\${#subDirs[@]}" -ne 1 ]; then
  echo "错误：脚本同级应正好有 1 个项目文件夹，实际找到 \${#subDirs[@]} 个。"
  exit 1
fi
projectDir="\${subDirs[0]}"
projectName="$(basename "$projectDir")"

case "$projectDir" in
  *"|"*|*"&"*)
    echo "错误：项目路径含特殊字符（| 或 &）。请移到简单路径后重试。"
    exit 1 ;;
esac

candidates=(
  "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
  "$HOME/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
)
draftsDir=""
for c in "\${candidates[@]}"; do
  if [ -d "$c" ]; then draftsDir="$c"; break; fi
done

if [ -n "$draftsDir" ]; then
  final="$draftsDir/$projectName"
  n=2
  while [ -e "$final" ]; do
    final="$draftsDir/$projectName ($n)"
    n=$((n + 1))
  done
else
  final="$projectDir"
fi

if [ "$final" != "$projectDir" ]; then
  mv "$projectDir" "$final"
fi

draftsFwd="$(dirname "$final")"

for f in draft_content.json draft_meta_info.json; do
  p="$final/$f"
  tmp="$p.tmp"
  sed -e "s|__VR_PROJECT_DIR__|$final|g" -e "s|__VR_DRAFTS_DIR__|$draftsFwd|g" "$p" > "$tmp"
  mv "$tmp" "$p"
done

if [ -n "$draftsDir" ]; then
  echo "完成！打开 CapCut，在项目列表里双击 \\"$projectName\\" 即可（不会再弹链接素材对话框）。"
else
  echo "路径已按当前位置修复，可直接打开 CapCut 项目。"
  echo "若想放进 CapCut 目录：重新解压原始 zip 到目标位置后再运行本脚本。"
  echo "当前项目位置： $final"
fi
`;
```

- [ ] **Step 2: 验证字符串内容正确（无 TS 插值意外）**

Run: `npx tsx -e "import('./lib/capcut-compiler/setup-scripts/index.ts').then(m => { const ok = m.SETUP_SH.includes('\${BASH_SOURCE[0]}') && m.SETUP_SH.includes('\${#subDirs[@]}') && !m.SETUP_PS1.includes(String.fromCharCode(96)) && m.SETUP_BAT.includes('%~dp0'); console.log(ok ? 'OK' : 'BAD'); process.exit(ok ? 0 : 1); })"`
Expected: 输出 `OK`，EXIT 0（确认 bash `${...}` 被还原成字面、PS1 不含反引号、bat 含 `%~dp0`）

- [ ] **Step 3: Commit**

```bash
git add lib/capcut-compiler/setup-scripts/index.ts
git commit -m "feat(capcut): add setup.bat/ps1/sh script templates"
```

---

### Task 4: package.ts — 脚本写进 zip + 重写 README + 契约测试

**Files:**
- Modify: `lib/capcut-compiler/package.ts`
- Test: `tests/capcut-compiler/package.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/capcut-compiler/package.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { buildDraftContent, type CompileInput } from "@/lib/capcut-compiler/build";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

const META: VideoMeta = {
  durationSec: 10,
  fps: 30,
  width: 1080,
  height: 1920,
  codec: "h264",
  bitrate: 1_000_000,
  hasAudio: true,
};

function makeInput(): CompileInput {
  return {
    projectName: "test-project",
    videoFileName: "my-video.mp4",
    meta: META,
    potential: { base: { actions: [] } } as unknown as MaterialPotential,
    match: {
      userVideoId: "u",
      reports: [],
      topPriorityActions: [],
      globalDoNots: [],
      recommendedBgms: [],
      trimRanges: [],
    } as unknown as TechniqueMatchingResult,
  };
}

async function buildZip() {
  const { draftContent, metaInfo } = buildDraftContent(makeInput());
  const bytes = await packageDraftAsZip({
    projectName: "test-project",
    draftContent,
    metaInfo,
    videoBuffer: Buffer.from("fake-mp4-bytes"),
    videoFileName: "my-video.mp4",
  });
  return JSZip.loadAsync(Buffer.from(bytes));
}

describe("packageDraftAsZip — structure", () => {
  it("puts the 3 setup scripts at the zip root", async () => {
    const zip = await buildZip();
    expect(zip.file("setup.bat")).not.toBeNull();
    expect(zip.file("setup.ps1")).not.toBeNull();
    expect(zip.file("setup.sh")).not.toBeNull();
  });

  it("keeps the project folder structure", async () => {
    const zip = await buildZip();
    expect(zip.file("test-project/draft_content.json")).not.toBeNull();
    expect(zip.file("test-project/draft_meta_info.json")).not.toBeNull();
    expect(zip.file("test-project/README.txt")).not.toBeNull();
    expect(zip.file("test-project/materials/my-video.mp4")).not.toBeNull();
  });
});

describe("packageDraftAsZip — token replacement contract", () => {
  // 这个函数必须和 setup.ps1 / setup.sh 做的字面替换完全一致。
  // 若改了 token 或脚本替换逻辑，这里也要同步。
  function applyTokens(raw: string, projectDir: string, draftsDir: string) {
    return raw
      .split(TOKEN_PROJECT_DIR)
      .join(projectDir)
      .split(TOKEN_DRAFTS_DIR)
      .join(draftsDir);
  }

  it("draft_content.json contains tokens and resolves to valid JSON with absolute paths", async () => {
    const zip = await buildZip();
    const raw = await zip.file("test-project/draft_content.json")!.async("string");
    expect(raw).toContain(TOKEN_PROJECT_DIR);

    const resolved = applyTokens(
      raw,
      "C:/fake/com.lveditor.draft/test-project",
      "C:/fake/com.lveditor.draft",
    );
    expect(resolved).not.toContain(TOKEN_PROJECT_DIR);
    const parsed = JSON.parse(resolved);
    expect(parsed.materials.videos[0].path).toBe(
      "C:/fake/com.lveditor.draft/test-project/materials/my-video.mp4",
    );
  });

  it("draft_meta_info.json tokens resolve to valid JSON", async () => {
    const zip = await buildZip();
    const raw = await zip.file("test-project/draft_meta_info.json")!.async("string");
    expect(raw).toContain(TOKEN_DRAFTS_DIR);

    const resolved = applyTokens(
      raw,
      "C:/fake/com.lveditor.draft/test-project",
      "C:/fake/com.lveditor.draft",
    );
    const parsed = JSON.parse(resolved);
    expect(parsed.draft_fold_path).toBe(
      "C:/fake/com.lveditor.draft/test-project",
    );
    expect(parsed.draft_root_path).toBe("C:/fake/com.lveditor.draft");
    expect(parsed.draft_materials[0].value[0].file_Path).toBe(
      "C:/fake/com.lveditor.draft/test-project/materials/my-video.mp4",
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/capcut-compiler/package.test.ts`
Expected: FAIL —— zip 根目录还没有 setup 脚本。

- [ ] **Step 3: 改 package.ts import**

定位 `lib/capcut-compiler/package.ts` 第 1-2 行：

```ts
import JSZip from "jszip";
import type { DraftContent, DraftMetaInfo } from "./schema";
```

替换为：

```ts
import JSZip from "jszip";
import type { DraftContent, DraftMetaInfo } from "./schema";
import { SETUP_BAT, SETUP_PS1, SETUP_SH } from "./setup-scripts";
```

- [ ] **Step 4: 重写 README_TEMPLATE**

定位 `lib/capcut-compiler/package.ts` 第 4-82 行（整个 `README_TEMPLATE` 常量定义）。整段替换为：

```ts
const README_TEMPLATE = (projectName: string, hasBgm: boolean) => `# ${projectName} · CapCut 项目导出

由 Viral Reviewer 自动生成。素材已按 AI 推荐的剪辑清单切好镜头 + 应用 push-in / pull-out 动画 + 字幕轨${hasBgm ? " + BGM 配乐" : ""}。

## 怎么用（一步）

解压这个 zip 后，你会看到 setup 脚本和一个 \`${projectName}/\` 文件夹。

### Windows
双击 \`setup.bat\`，等它显示"完成！"，然后打开 CapCut，项目列表里双击 \`${projectName}\` 即可。

### macOS
打开"终端"，把 \`setup.sh\` 拖进终端窗口回车（或 \`bash setup.sh\`），等它显示"完成！"，然后打开 CapCut。

脚本做的事：找到你电脑上的 CapCut 项目目录 → 把 \`${projectName}/\` 文件夹放进去 → 把项目文件里的素材路径改写成你电脑上的绝对路径。**纯本地文件操作，不联网。**

## 为什么需要这一步

CapCut 用绝对路径引用素材，但这个 zip 是在服务器上生成的，不知道你会解压到哪。setup 脚本在你的电脑上补上这个绝对路径——这样 CapCut 打开时就能直接找到素材，不会弹"链接素材"对话框。

## 如果脚本说"没找到 CapCut 目录"

脚本会把路径按当前位置修好，你可以直接从当前位置打开。若想把项目放进 CapCut 目录，把这个 zip 重新解压到目标位置再运行一次脚本即可。

## 项目结构

\`\`\`
${projectName}/
├── draft_content.json   ← 时间轴 / 切镜 / 动画 / 字幕${hasBgm ? " / BGM 轨" : ""}
├── draft_meta_info.json ← 项目元数据
└── materials/           ← 你的视频${hasBgm ? " + BGM" : ""}
\`\`\`

## 已自动应用的 AI 推荐

- 按时间轴排序的切镜点（来自 topPriorityActions）
- 每段 push-in / pull-out 缩放动画（关键帧已写入）
- 字幕轨（用户原视频字幕）${hasBgm ? `
- 独立 BGM 配乐轨（你上传的音乐）` : ""}

## 还没自动应用的（Phase 6+）

- 复杂转场（whip pan / match cut / 速度坡）
- 调色、特效

运行脚本后这几个 setup 文件可以删掉。

---

Viral Reviewer · ${new Date().toISOString().slice(0, 10)}
`;
```

- [ ] **Step 5: 在 packageDraftAsZip 里写入三个脚本**

定位 `lib/capcut-compiler/package.ts` 里 `packageDraftAsZip` 函数体中的这段（在 `materials.file(...)` 之后、`return zip.generateAsync(...)` 之前）：

```ts
  const materials = root.folder("materials");
  if (!materials) throw new Error("failed to create materials folder");
  materials.file(input.videoFileName, input.videoBuffer);
  if (hasBgm) {
    materials.file(input.bgmFileName!, input.bgmBuffer!);
  }

  return zip.generateAsync({
```

替换为：

```ts
  const materials = root.folder("materials");
  if (!materials) throw new Error("failed to create materials folder");
  materials.file(input.videoFileName, input.videoBuffer);
  if (hasBgm) {
    materials.file(input.bgmFileName!, input.bgmBuffer!);
  }

  // setup 脚本写 zip 根目录（和 <projectName>/ 文件夹并列）。
  // setup.sh 标记可执行（0o755），macOS 解压后能直接 bash 运行。
  zip.file("setup.bat", SETUP_BAT);
  zip.file("setup.ps1", SETUP_PS1);
  zip.file("setup.sh", SETUP_SH, { unixPermissions: 0o755 });

  return zip.generateAsync({
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/capcut-compiler/package.test.ts`
Expected: PASS（全部 4 个 it）

- [ ] **Step 7: 验证类型编译通过**

Run: `npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 8: Commit**

```bash
git add lib/capcut-compiler/package.ts tests/capcut-compiler/package.test.ts
git commit -m "feat(capcut): bundle setup scripts in zip + rewrite README"
```

---

### Task 5: 保留用户原始视频文件名（route + sanitize + 客户端串联）

**Files:**
- Modify: `lib/capcut-compiler/build.ts`（新增 `sanitizeVideoFileName` 导出）
- Modify: `app/api/compile-capcut/route.ts`
- Modify: `components/technique-match/InputPanel.tsx`
- Modify: `components/technique-match/useAnalyzeStream.ts`
- Modify: `components/technique-match/ResultsArea.tsx`
- Modify: `app/analyze/page.tsx`
- Modify: `components/technique-match/CapCutExport.tsx`
- Test: `tests/capcut-compiler/sanitize.test.ts`

- [ ] **Step 1: 写 sanitize 失败测试**

创建 `tests/capcut-compiler/sanitize.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { sanitizeVideoFileName } from "@/lib/capcut-compiler/build";

describe("sanitizeVideoFileName", () => {
  it("keeps a normal filename unchanged", () => {
    expect(sanitizeVideoFileName("20260429-200100.mp4")).toBe(
      "20260429-200100.mp4",
    );
  });

  it("strips directory components, keeps the basename", () => {
    expect(sanitizeVideoFileName("C:\\Users\\me\\clip.mp4")).toBe("clip.mp4");
    expect(sanitizeVideoFileName("/home/me/clip.mov")).toBe("clip.mov");
  });

  it("replaces filesystem-illegal characters with underscore", () => {
    expect(sanitizeVideoFileName('my:vi*deo?.mp4')).toBe("my_vi_deo_.mp4");
  });

  it("falls back to input.mp4 when undefined or empty", () => {
    expect(sanitizeVideoFileName(undefined)).toBe("input.mp4");
    expect(sanitizeVideoFileName("")).toBe("input.mp4");
    expect(sanitizeVideoFileName("   ")).toBe("input.mp4");
  });

  it("falls back to input.mp4 when the name contains a reserved token", () => {
    expect(sanitizeVideoFileName("__VR_PROJECT_DIR__.mp4")).toBe("input.mp4");
  });

  it("keeps unicode filenames", () => {
    expect(sanitizeVideoFileName("我的视频.mp4")).toBe("我的视频.mp4");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/capcut-compiler/sanitize.test.ts`
Expected: FAIL —— `sanitizeVideoFileName` 还不存在。

- [ ] **Step 3: 在 build.ts 实现并导出 sanitizeVideoFileName**

在 `lib/capcut-compiler/build.ts` 文件中，`export type CompileInput = {...}` 定义之后插入：

```ts
/**
 * 把用户上传的视频文件名清洗成可安全放进 zip / draft JSON 路径的文件名。
 * 保留原始可识别性（消除"手动 link 文件名不匹配"那条根因），只替换会破坏
 * 文件系统 / JSON 路径的字符。缺失或异常时退化为 "input.mp4"。
 */
export function sanitizeVideoFileName(raw: string | undefined): string {
  const FALLBACK = "input.mp4";
  if (!raw) return FALLBACK;
  // 取 basename：去掉任何 / 或 \ 前缀
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return FALLBACK;
  // 占位 token 出现在文件名里 → 直接退化，避免脏了字面替换
  if (base.includes("__VR_")) return FALLBACK;
  // 替换文件系统非法字符 + 控制字符
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return FALLBACK;
  // 限长，保留扩展名
  if (cleaned.length > 120) {
    const dot = cleaned.lastIndexOf(".");
    if (dot > 0) {
      const ext = cleaned.slice(dot);
      return cleaned.slice(0, 120 - ext.length) + ext;
    }
    return cleaned.slice(0, 120);
  }
  return cleaned;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/capcut-compiler/sanitize.test.ts`
Expected: PASS（全部 6 个 it）

- [ ] **Step 5: route.ts 加 videoFileName 到 RequestSchema**

定位 `app/api/compile-capcut/route.ts` 第 18-29 行的 `RequestSchema`。在 `videoUrl` 之后加一行：

```ts
const RequestSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[^\\/:*?"<>|]+$/, "项目名包含非法字符"),
  videoUrl: z.string().url(),
  /** 用户上传的原始视频文件名（可选；缺失则退化为 input.mp4） */
  videoFileName: z.string().min(1).max(200).optional(),
  /** Phase 5.5：可选 BGM 文件 URL（Vercel Blob 上传后的 URL） */
  bgmUrl: z.string().url().nullable().optional(),
  userPotential: z.unknown(),
  match: z.unknown(),
});
```

- [ ] **Step 6: route.ts import sanitizeVideoFileName 并使用**

定位 `app/api/compile-capcut/route.ts` 第 9-10 行：

```ts
import { buildDraftContent } from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
```

替换为：

```ts
import {
  buildDraftContent,
  sanitizeVideoFileName,
} from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
```

定位第 53 行 `const { projectName, videoUrl, bgmUrl } = parsed.data;`，替换为：

```ts
  const { projectName, videoUrl, bgmUrl } = parsed.data;
  const videoFileName = sanitizeVideoFileName(parsed.data.videoFileName);
```

定位第 92-101 行 `buildDraftContent({...})` 调用，把 `videoFileName: "input.mp4",` 改成 `videoFileName,`：

```ts
    const { draftContent, metaInfo } = buildDraftContent({
      projectName,
      videoFileName,
      bgmFileName: assets.bgmPath ? "bgm.mp3" : undefined,
      bgmDurationSec,
      meta,
      potential: potentialParsed.data,
      match: matchParsed.data,
    });
```

定位第 110-118 行 `packageDraftAsZip({...})` 调用，把 `videoFileName: "input.mp4",` 改成 `videoFileName,`：

```ts
    const zipBytes = await packageDraftAsZip({
      projectName,
      draftContent,
      metaInfo,
      videoBuffer,
      videoFileName,
      bgmBuffer,
      bgmFileName: bgmBuffer ? "bgm.mp3" : undefined,
    });
```

- [ ] **Step 7: InputPanel.tsx — onSubmit 带上 videoFileName**

定位 `components/technique-match/InputPanel.tsx` 第 10-13 行的 `Props`：

```ts
type Props = {
  onSubmit: (args: { videoUrl: string; topic: string; intent: string }) => void;
  isLoading: boolean;
};
```

替换为：

```ts
type Props = {
  onSubmit: (args: {
    videoUrl: string;
    videoFileName: string;
    topic: string;
    intent: string;
  }) => void;
  isLoading: boolean;
};
```

定位第 56-61 行的 `onSubmit({...})` 调用：

```ts
      setStage("submitting");
      onSubmit({
        videoUrl: blob.url,
        topic: topic.trim(),
        intent: intent.trim(),
      });
```

替换为：

```ts
      setStage("submitting");
      onSubmit({
        videoUrl: blob.url,
        videoFileName: videoFile.name,
        topic: topic.trim(),
        intent: intent.trim(),
      });
```

- [ ] **Step 8: useAnalyzeStream.ts — SubmitArgs + state 携带 videoFileName**

定位 `components/technique-match/useAnalyzeStream.ts` 第 18-32 行：

```ts
export type SubmitArgs = {
  videoUrl: string;
  topic: string;
  intent: string;
};

export type AnalyzeStreamState = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrl: string | null;
  submit: (args: SubmitArgs) => Promise<void>;
};
```

替换为：

```ts
export type SubmitArgs = {
  videoUrl: string;
  videoFileName: string;
  topic: string;
  intent: string;
};

export type AnalyzeStreamState = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrl: string | null;
  videoFileName: string | null;
  submit: (args: SubmitArgs) => Promise<void>;
};
```

定位第 48 行 `const [videoUrl, setVideoUrl] = useState<string | null>(null);`，其后插入一行：

```ts
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
```

定位第 56 行 `setVideoUrl(args.videoUrl);`，其后插入一行：

```ts
    setVideoUrl(args.videoUrl);
    setVideoFileName(args.videoFileName);
```

定位第 115 行 `return { loading, error, stages, partial, full, videoUrl, submit };`，替换为：

```ts
  return {
    loading,
    error,
    stages,
    partial,
    full,
    videoUrl,
    videoFileName,
    submit,
  };
```

> 说明：`submit` 仍然 `body: JSON.stringify(args)` 把 `videoFileName` 一起发给 `/api/technique-match`。technique-match 的 `Schema` 不是 `.strict()`，zod 默认丢弃未知字段，无害。

- [ ] **Step 9: ResultsArea.tsx — 加可选 videoFileName prop，传给 CapCutExport**

定位 `components/technique-match/ResultsArea.tsx` 第 24-34 行的 `AnalyzeResultsProps`，在 `videoUrl: string | null;` 之后加一行：

```ts
export type AnalyzeResultsProps = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrl: string | null;
  /** 用户原始视频文件名；可选，缺失时 CapCutExport 退化为 input.mp4 */
  videoFileName?: string | null;
  /** 文案：empty state 标题/副标题 */
  emptyTitle?: string;
  emptySubtitle?: string;
};
```

定位第 45-54 行的函数签名解构，在 `videoUrl,` 之后加 `videoFileName,`：

```ts
export function AnalyzeResults({
  loading,
  error,
  stages,
  partial,
  full,
  videoUrl,
  videoFileName,
  emptyTitle = "上传你的视频草稿",
  emptySubtitle = "AI 会看完整段视频，找出你的素材能学什么、不能学什么，输出具体到秒的剪辑改动建议。",
}: AnalyzeResultsProps) {
```

定位第 162-168 行的 `<CapCutExport>`：

```tsx
            {videoUrl && (
              <CapCutExport
                videoUrl={videoUrl}
                userPotential={full.userPotential}
                match={full.match}
              />
            )}
```

替换为：

```tsx
            {videoUrl && (
              <CapCutExport
                videoUrl={videoUrl}
                videoFileName={videoFileName ?? undefined}
                userPotential={full.userPotential}
                match={full.match}
              />
            )}
```

- [ ] **Step 10: analyze/page.tsx — 传 stream.videoFileName**

定位 `app/analyze/page.tsx` 第 49-58 行的 `<AnalyzeResults>`，在 `videoUrl={stream.videoUrl}` 之后加一行：

```tsx
            <AnalyzeResults
              loading={stream.loading}
              error={stream.error}
              stages={stream.stages}
              partial={stream.partial}
              full={stream.full}
              videoUrl={stream.videoUrl}
              videoFileName={stream.videoFileName}
              emptyTitle="上传你的视频素材"
              emptySubtitle="Gemini 先 30 秒给你素材诊断，Opus 再 2 分钟给你完整的爆款对标 + 可执行剪辑清单。"
            />
```

- [ ] **Step 11: CapCutExport.tsx — 加 videoFileName prop 并放进请求体**

定位 `components/technique-match/CapCutExport.tsx` 第 9-14 行的 `Props`，在 `videoUrl: string;` 之后加一行：

```ts
type Props = {
  videoUrl: string;
  /** 用户原始视频文件名；可选，缺失时 server 退化为 input.mp4 */
  videoFileName?: string;
  userPotential: MaterialPotential;
  match: TechniqueMatchingResult;
  defaultProjectName?: string;
};
```

定位第 26-31 行的函数签名解构，在 `videoUrl,` 之后加 `videoFileName,`：

```ts
export function CapCutExport({
  videoUrl,
  videoFileName,
  userPotential,
  match,
  defaultProjectName,
}: Props) {
```

定位第 70-80 行的 `fetch("/api/compile-capcut", {...})` 请求体：

```ts
      const res = await fetch("/api/compile-capcut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim() || fallbackName,
          videoUrl,
          bgmUrl,
          userPotential,
          match,
        }),
      });
```

替换为：

```ts
      const res = await fetch("/api/compile-capcut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim() || fallbackName,
          videoUrl,
          videoFileName,
          bgmUrl,
          userPotential,
          match,
        }),
      });
```

- [ ] **Step 12: 验证类型编译 + 全量测试通过**

Run: `npx tsc --noEmit && npx vitest run tests/capcut-compiler/`
Expected: EXIT 0；vitest 全绿（build / package / sanitize / edit-plan 四个测试文件）

- [ ] **Step 13: Commit**

```bash
git add lib/capcut-compiler/build.ts app/api/compile-capcut/route.ts components/technique-match/InputPanel.tsx components/technique-match/useAnalyzeStream.ts components/technique-match/ResultsArea.tsx app/analyze/page.tsx components/technique-match/CapCutExport.tsx tests/capcut-compiler/sanitize.test.ts
git commit -m "feat(capcut): preserve original video filename through export pipeline"
```

---

### Task 6: 本地构建验证 + 用户实测

- [ ] **Step 1: 本地 build 验证**

Run: `npm run build`
Expected: EXIT 0，无类型错误，`/api/compile-capcut` 路由编译进 build 产物。

- [ ] **Step 2: 起 dev server（端口 3001）并生成一份真实导出**

Run: `npm run dev -- -p 3001`（已在跑则跳过）

让用户在 `http://localhost:3001/analyze`：
1. 上传一段视频（之前撞 "Couldn't link" 的那段最好），等分析完成
2. 点"下载 CapCut 项目 zip"，下载 zip

- [ ] **Step 3: 用户实测 — Windows**

让用户：
1. 解压 zip 到任意位置（如 Downloads）
2. 双击 `setup.bat`
3. 预期：弹窗显示"完成！打开 CapCut，在项目列表里双击 `<projectName>` 即可"
4. 打开 CapCut，双击该项目
5. **预期：直接进编辑器，不弹"链接素材"对话框，视频和时间轴正常显示**
6. 如有 BGM：确认 BGM 音轨也正常（不显示红色"媒体丢失"）

- [ ] **Step 4: 用户实测 — macOS（用户有 Mac 时）**

让用户在 Mac 上：
1. 解压同一个 zip（或重新生成）
2. 终端运行 `bash setup.sh`
3. 预期同上：CapCut 打开项目不弹对话框

- [ ] **Step 5: 记录实测结果**

把 Windows / macOS 实测结果（成功 / 失败 + 现象）记到 `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md` 的新增 "Findings" 章节。若失败：按 systematic-debugging 重新进 Phase 1，**不要**在未定位的情况下叠加修复。

---

### Task 7: Handover 文档 + memory 更新

**Files:**
- Modify: `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md`
- Create: `C:/Users/yixin/.claude/projects/G--claude-code-viral-reviewer/memory/capcut-link-root-cause.md`
- Modify: `C:/Users/yixin/.claude/projects/G--claude-code-viral-reviewer/memory/MEMORY.md`

- [ ] **Step 1: 在 handover 文档追加 Findings 章节**

在 `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md` 末尾追加：

```markdown

---

## Findings (2026-05-13 续 — Setup-Script 方案)

### 根因确认
CapCut 用绝对路径引用素材（`draft_content.json` 的 `materials.*.path` + `draft_meta_info.json`
的 `draft_materials[].value[].file_Path`）。三方证据：本机原生项目 0203/0205、capcut-cli 源码。
服务端 zip 写不出有效绝对路径 → 所有相对路径 / placeholder 变体都失败。

历史误判纠正：5db8fce "死锁" 不是因为填了 `draft_materials`，是因为填的 `file_Path`
是相对路径。原生 0203 证明填**绝对** file_Path 正是能用的状态。

### 方案
zip 附 setup.bat / setup.ps1 / setup.sh，server 写占位 token，脚本在用户机器上字面替换
成绝对路径 + 把项目搬进 CapCut drafts 目录。plan：`docs/superpowers/plans/2026-05-13-capcut-setup-script-link-fix.md`。

### 实测结果
- Windows: <待填>
- macOS: <待填>
```

- [ ] **Step 2: 创建 memory 文件**

创建 `C:/Users/yixin/.claude/projects/G--claude-code-viral-reviewer/memory/capcut-link-root-cause.md`：

```markdown
---
name: capcut-link-root-cause
description: CapCut 导入"Couldn't link"的根因——CapCut 用绝对路径引用素材，服务端 zip 必须靠用户机器本地脚本补绝对路径
metadata:
  type: project
---

CapCut 用「指向素材原始位置的绝对路径」引用素材，存在 `draft_content.json` 的
`materials.*.path` 和 `draft_meta_info.json` 的 `draft_materials[].value[].file_Path`。
不用项目相对路径，不把素材拷进项目文件夹。三方证据：本机原生项目 0203/0205、
capcut-cli 源码（本地运行所以能写绝对路径）。

**Why:** viral-reviewer 的 CapCut 导出反复 "Couldn't link"。服务端生成 zip 无法知道
用户解压位置 → 写不出有效绝对路径。10bd106→5db8fce→27e5845→ec88b2d 四次尝试
（placeholder / 填相对 file_Path / 纯文件名 / materials/ 相对路径）全是在绕这个矛盾。

**How to apply:**
- 解法：zip 附 setup 脚本（.bat/.ps1/.sh），server 写占位 token，脚本在用户机器本地
  把 token 字面替换成绝对路径 + 把项目搬进 CapCut drafts 目录。复刻 capcut-cli 行为。
- `draft_meta_info.draft_materials` 必须复刻原生 0203 的七组结构（type 0/1/2/3/6/7/8），
  type 0 组放视频/BGM 条目，entry.id 必须等于 draft_content 对应 material 的 id。
- 任何"服务端生成、用户本地用"的桌面软件项目文件，凡是含绝对路径的，都要考虑
  本地脚本补全这个模式。
```

- [ ] **Step 3: 更新 MEMORY.md 索引**

在 `C:/Users/yixin/.claude/projects/G--claude-code-viral-reviewer/memory/MEMORY.md` 末尾追加一行：

```markdown
- [CapCut 导入 Couldn't link 根因](capcut-link-root-cause.md) — CapCut 用绝对路径引用素材，服务端 zip 必须靠本地脚本补全
```

- [ ] **Step 4: Commit handover**

```bash
git add docs/HANDOVER-CAPCUT-LINK-2026-05-13.md
git commit -m "docs(capcut): handover findings for setup-script link fix"
```

> memory 文件在 `~/.claude/projects/...` 不在 repo，不进 git——只写文件即可。

---

## Self-Review

### Spec coverage

| 决策点 / 需求 | 实现 task |
|---|---|
| 决策 1：跨平台 JSON 改写 = token + 字面替换 | Task 1（token 常量）+ Task 2（server 写 token）+ Task 3（脚本字面替换）+ Task 4（契约测试验证替换→合法 JSON） |
| 决策 2：Windows 双击执行（setup.bat + ExecutionPolicy Bypass）| Task 3 `SETUP_BAT` |
| 决策 3：drafts 目录探测带 fallback，不静默失败 | Task 3 `SETUP_PS1` / `SETUP_SH`（探测 CapCut + JianyingPro，找不到就地修复 + 提示）|
| 决策 4：安全（纯本地、零网络、可读）| Task 3 脚本内容（无网络调用）+ Task 4 README 说明 |
| 决策 5：占位 token 选不冲突的串 | Task 1 `tokens.ts`（`__VR_PROJECT_DIR__` / `__VR_DRAFTS_DIR__`）|
| 服务端：不再 hardcode videoFileName | Task 5（sanitize + route + 客户端串联）|
| 服务端：package.ts 写脚本进 zip + 改 README | Task 4 |
| 服务端：draft_materials 复刻原生 0203 七组结构 | Task 2 Step 6 |
| 修正 schema.ts 的 5db8fce 错误注释 | Task 1 Step 2 |

### Placeholder scan

所有 code step 都给了完整内容。Task 6（用户实测）的"待填"是真实占位——实测结果只能用户跑完才有，不是 hand-wave。Task 7 memory 路径用本机正确路径 `G--claude-code-viral-reviewer`（不是 handover 里 capcut-cli plan 残留的 `C--Users-Admin-...`）。

### Type consistency

- `TOKEN_PROJECT_DIR` / `TOKEN_DRAFTS_DIR`：Task 1 定义，Task 2 / Task 4 测试一致引用。
- `DraftMaterialEntry`：Task 1 定义，Task 2 build.ts 构造时字段全部对齐（`ai_group_type` / `create_time` / `duration` / `extra_info` / `file_Path` / `height` / `id` / `import_time` / `import_time_ms` / `item_source` / `md5` / `metetype` / `roughcut_time_range` / `sub_time_range` / `type` / `width`）。
- `sanitizeVideoFileName`：Task 5 在 build.ts 定义并导出，route.ts 同名 import。
- `SubmitArgs.videoFileName` / `AnalyzeStreamState.videoFileName` / `AnalyzeResultsProps.videoFileName` / `CapCutExport` `Props.videoFileName`：Task 5 全链路类型一致（state 层 `string | null`，props 层可选 `string`，串接处用 `?? undefined` 收窄）。
- `SETUP_BAT` / `SETUP_PS1` / `SETUP_SH`：Task 3 定义，Task 4 import 一致。

### 已知风险

1. **bash `sed` 替换值含特殊字符**：替换值是用户主目录绝对路径，理论上可能含 `&`（sed 替换串特殊字符）。脚本已在 `case` 里校验 `|` 和 `&` 并 abort；`/` 用 `|` 作 sed 分隔符规避；macOS 路径无反斜杠。残留极小风险（路径含换行——不可能）。
2. **setup.sh 可执行权限**：JSZip `unixPermissions: 0o755` 在标准 `unzip` / Finder 解压后应保留；若用户用某些工具解压丢权限，README 已写 `bash setup.sh` 兜底。
3. **契约测试 ≠ 真实脚本执行**：`package.test.ts` 的 `applyTokens` 在 TS 里模拟字面替换，必须和 `setup.ps1` / `setup.sh` 的替换逻辑保持一致——测试注释已标注这一点。真实脚本执行由 Task 6 用户实测覆盖。
4. **BGM 的 draft_materials 条目结构**：视频条目对照原生 0203 验证过，BGM 条目（`metetype: "music"`）无本机原生纯音频项目的 `draft_materials` 样本对照。若 Task 6 实测 BGM 仍掉链接，按 systematic-debugging 重新定位（可能 `metetype` 或 type 组归属不同）。
5. **technique-match 页面**：`AnalyzeResults` 的 `videoFileName` 设为可选 prop，`app/technique-match/page.tsx` 若也用 `AnalyzeResults` 而不传该 prop，仍能编译通过、行为不变（CapCutExport 退化为 input.mp4）。无需强制改 technique-match 页面。

---

## Execution Handoff

Plan 已保存到 `docs/superpowers/plans/2026-05-13-capcut-setup-script-link-fix.md`。

按窗口协调流程：**先 commit + push 这份 plan，让窗口 3 review 任务分解，review 过了再走 `superpowers:subagent-driven-development` 实施**（每个 task fresh subagent + task 间 review）。
