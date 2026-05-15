# CapCut 转场结构逆向（Task 2 PROBE）

> 状态：**完成** — 11 种转场实测覆盖全部主流类别，叠化降级目标已锁定，结构逆向收口。
> 探测脚本：`scripts/probe-capcut-transitions.ts`（只读，可换机器跑）。
> 解锁 Task 6 / 8 / 10。

## 探测环境

- CapCut **8.5.0**（Windows，`app_source: "cc"`，`platform.os: "windows"`）
- 样本项目（machine-local，不随 git 同步）：
  - `0514` (2026-05-15 本机实测) — 13 段视频 + 11 转场，覆盖叠化/运镜/3D/模糊/基础/遮罩/幻灯片/故障/扭曲/Light 类别
  - `0514` / `0514 (1)` (2026-05-14 上一台机器) — 4 段 + 3 转场 / 3 段 + 2 转场（提供 Slick Twist + Filmstrip x2 历史值）
- 工程格式：明文 `draft_content.json`。
  ⚠️ macOS 新版 CapCut 的 `draft_info.json` 是**加密的**，无法逆向 —— 必须用 Windows CapCut 8.5.0 的明文工程。

---

## 1. `materials.transitions[]` 字段结构

每个转场是 `draft.materials.transitions[]` 里的一个 material 对象：

```jsonc
{
  "id": "BBE15244-94AA-4be5-AAE1-DAE1D3BEDC48",  // UUID，被 segment 引用
  "type": "transition",
  "name": "叠化",                                  // 人类可读名（与 CapCut 语言相关）
  "effect_id": "6724845717472416269",             // ★ 转场资源 ID（数字字符串）
  "resource_id": "6724845717472416269",           // = effect_id
  "third_resource_id": "0",
  "source_platform": 1,
  "path": "C:/Users/.../Cache/effect/6724845717472416269/<hash>",  // 本机 cache，生成时留空即可
  "duration": 466666,                             // ★ 转场时长，微秒（按转场类型而异，见第 2 节）
  "is_overlap": true,                             // ★ ★ ★ 按转场类型而定（非恒 true），见第 4 节
  "platform": "all",
  "category_id": "27186",
  "category_name": "叠化转场",                     // CapCut 内的分类（随语言变化）
  "request_id": "...",
  "is_ai_transition": false,
  "video_path": "",
  "task_id": ""
}
```

**生成时必填**：`id`、`type`、`name`、`effect_id`、`resource_id`、`duration`、`is_overlap`、`platform`。
`path` 指向本机 cache，我们生成的 zip 里没有 —— 实测 CapCut 会自己用 `effect_id` 重新拉资源，`path` 留空或占位不影响（待 Task 12 本机实测最终确认）。

---

## 2. effect_id 实测映射表

> 来源：2026-05-15 本机 0514（CapCut 8.5.0 Windows）+ 2026-05-14 上一台机器 0514/0514(1)。effect_id 是 CapCut 服务端稳定资源 ID，跨机器一致。

| 转场名 | effect_id | category | is_overlap | 默认 duration (μs) | 来源 |
|---|---|---|---|---|---|
| **叠化** ★ | `6724845717472416269` | 叠化转场 | `true` | 466666 | 0514 (2026-05-15) |
| 流行切换 | `7574646707154275589` | Light | `true` | 2000000 | 0514 (2026-05-15) |
| 推近 | `6724226861666144779` | 运镜 | `false` | 466666 | 0514 (2026-05-15) |
| 缩放轮播 | `7502402658632879413` | 3D | `true` | 2000000 | 0514 (2026-05-15) |
| 转场-模糊 | `6916426617455645186` | 模糊 | `false` | 466666 | 0514 (2026-05-15) |
| 替换 | `7626616498747985168` | 基础转场 | `true` | 1866666 | 0514 (2026-05-15) |
| Wispy Fade | `7607215892333890821` | 遮罩转场 | `true` | 2000000 | 0514 (2026-05-15) |
| 翻转视角 | `7507477574705073461` | 幻灯片 | `true` | 2000000 | 0514 (2026-05-15) |
| 色差故障 | `6724239785205961228` | 故障 | `false` | 200000 | 0514 (2026-05-15) |
| 幻影波动 | `7233996535921381890` | 扭曲 | `true` | 200000 | 0514 (2026-05-15) |
| Slick Twist | `7627435157909261575` | Trending | `true` | 2000000 | 0514 / 0514(1) (2026-05-14) |
| Filmstrip x2 | `7595848521199193349` | 特殊 | `true` | 2000000 | 0514 / 0514(1) (2026-05-14) |

★ **叠化是 Task 6 降级策略的落点**：未知转场 type → fallback 到 `6724845717472416269`。

**Task 6 编排枚举 → effect_id 候选映射**（细节在 Task 6 定稿）：
- `cross_dissolve` / `fade` → 叠化 `6724845717472416269`（首选）或 Wispy Fade `7607215892333890821`
- `whip_pan` → Slick Twist `7627435157909261575`（快速运动感）或 推近 `6724226861666144779`
- `match_cut` → 替换 `7626616498747985168`（基础切换）或 fallback 叠化
- `hard_cut` → **不添加 transition material**（segment 之间无转场引用）
- 未知 type → 叠化（降级）+ `console.warn`

---

## 3. 转场如何挂到 segment

转场 material 的 `id` 出现在**前导 segment** 的 `extra_material_refs[]` 数组里。

- N 段视频 → 前 N-1 段各挂 1 个转场，**最后一段不挂**。
- `seg[i]` 的 `extra_material_refs` 里的转场 = `seg[i]` 与 `seg[i+1]` 之间的转场。
- 识别方式：遍历 `extra_material_refs`，凡 id 命中 `materials.transitions[].id` 的即转场引用（不靠数组位置，位置不固定）。

实测（`0514` 2026-05-15，13 段 11 转场）：

```
seg[0]..seg[8] extra_material_refs 各含 1 个转场（叠化/流行切换/叠化/推近/缩放轮播/转场-模糊/替换/Wispy Fade/翻转视角）
seg[9] extra_material_refs 不含转场（用户故意没加，留作 hard_cut 样本）
seg[10] 挂 色差故障  → seg10↔seg11 转场
seg[11] 挂 幻影波动  → seg11↔seg12 转场
seg[12] extra_material_refs 不含转场（末段无后继，正常）
```

**与 `assemblyTimeline` 契约的差异**：我们的 `AssemblyClip.incomingTransition` 挂在「后一个 clip」上（`clip[i]` 与 `clip[i-1]` 之间，首 clip = null）。CapCut 挂「前导 segment」（末段 = 无）。Task 10 编译时做一次 index 平移：
`assemblyTimeline.clips[i].incomingTransition` → 写进 CapCut `segment[i-1]` 的 `extra_material_refs`。

**Task 9/10 兼容路径补强**：用户也可能漏配（如本次 seg[9]）。Task 10 实现时 hard_cut 路径必须能容忍「中间段没有 transition material」—— 既不抛错也不补默认转场。

---

## 4. 时间轴语义 —— 「不变，靠 `is_overlap` 标记，但标记本身不是常量」

plan Task 2 列了三种可能（重叠 D / 各缩短 D/2 / 不变靠标记），实测结论是**第三种**：

- 相邻段 `target_timerange` **完全首尾相接**：`seg[i].start + seg[i].duration === seg[i+1].start`，gap 恒为 0，既不重叠也不缩短。
- `source_timerange.duration === target_timerange.duration` —— 片段没有被裁短。
- `draft.duration === Σ segment.target_timerange.duration` —— 总时长就是各段时长直接相加。

13 段 / 11 转场样本 + 上一轮 4 段 / 3 转场样本，**全部跨 `is_overlap` 真假混合**的项目均验证通过（见脚本 `[3]` 段输出）。

**重要修正（覆写上一版结论）**：`is_overlap` **不是恒 true**。同一个 0514 项目里：

- `is_overlap: true`：叠化、流行切换、缩放轮播、替换、Wispy Fade、翻转视角、幻影波动、Slick Twist、Filmstrip x2（叠化系 / 长时段视觉重叠类）
- `is_overlap: false`：推近、转场-模糊、色差故障（短促 / 卡点 / 瞬切类）

→ **`is_overlap` 是转场类型固有属性**，由 CapCut 渲染决定是否做视觉重叠。它不影响 `target_timerange` 的数学（仍恒为线性累加），但写 draft 时必须填**正确的值**，否则 CapCut 渲染可能错位。

**含义**：转场的视觉重叠是 CapCut **渲染层**行为，由 `is_overlap` 驱动；写进 draft 的 timeline 数据保持「名义时长」，不做任何重叠/缩短换算。

**对 Task 8 的影响（重大简化）**：编排时间轴就是纯线性累加 ——
`clip[i+1].targetStartSec = clip[i].targetEndSec`，转场完全不参与 `target_timerange` 的数学。Task 8 不需要实现「重叠 D」或「缩短 D/2」的复杂逻辑。

**对 Task 6 / 10 的影响**：`TransitionMaterial.is_overlap` 必须**从映射表逐条配置**，不能 hardcode `true`。映射表（见第 2 节）已带上每种 effect_id 的实测 `is_overlap`。Task 10 写 material 时用映射表里的值。

---

## 5. 对编译层（Task 6 / 8 / 10）的落地结论

- **Task 6**（schema + 映射表）：`materials.transitions` 用第 1 节的字段结构建 `TransitionMaterial` 类型；`transitions.ts` 映射表把编排枚举（`cross_dissolve` / `whip_pan` / ...）映到 effect_id **及对应的 is_overlap + 默认 duration**（第 2 节表）。
- **Task 8**（edit-plan 时间轴）：转场**不影响** `target_timerange`，纯线性累加。转场时长 clamp 不超相邻较短段的一半（防御性，CapCut 应也会自己 clamp）。
- **Task 10**（接入真转场）：每个 `incomingTransition` 造一个 transition material push 进 `materials.transitions`；按第 3 节，把 material id 写进**前导 segment**（index 平移）的 `extra_material_refs`；`is_overlap` **从映射表逐条取值**（不 hardcode）；`duration` 优先用编排层的 `durationSec`，缺省 fallback 映射表默认值，秒 → μs；hard_cut 路径**不创建 material、不写 ref**。
- **Task 12**：probe zip 在本机 CapCut 8.5.0 打开，确认转场真实出现、`path` 留空不报错、`is_overlap` 行为符合预期。

---

## 附录 A：filter / video_effect 结构（本期不实现，存档参考）

实测发现 filter / video_effect 的 material **与 transition 高度同构** —— 都是 `effect_id` + `resource_id` + cache `path` + `category_id/name` 的引用机制：

| 类型 | name | effect_id |
|---|---|---|
| `filter` | Forgotten Sunday | `7561035708815691061` |
| `video_effect` | Flash Sharpen | `7399466526073507077` |
| `video_effect` | Particle Blur 2 | `7399470035938381062` |

差异：filter / effect 是**独立 track**（`track.type === "filter" / "effect"`），segment 的 `material_id` 直接指向该 material，`extra_material_refs` 为空；有自己的 `target_timerange`（作用时间段）和 `render_index`（图层顺序：filter≈10000 / effect≈11000 / text≈14000）。

**价值**：若未来产品要加「AI 配滤镜 / 特效」，Task 6 的 `transitions.ts` 映射表模式可直接复用。本期 plan 范围只做「多视频 + 真转场」，故此处仅存档。

`text` material 的 `content` 字段是 **JSON-in-JSON 转义字符串**，结构复杂得多，未来若做字幕需单独逆向。

---

## 附录 B：跨机器探测复现

新机器上需要补样本时：

1. Windows CapCut 8.5.0 新建项目，时间轴放 ≥2 段视频。
2. 在相邻段间加各种转场（至少包含「叠化 / Dissolve」）。
3. `Ctrl+S` 保存。
4. 跑 `npx tsx scripts/probe-capcut-transitions.ts`（自动扫描 `%LOCALAPPDATA%/CapCut/User Data/Projects/com.lveditor.draft`）或 `npx tsx scripts/probe-capcut-transitions.ts <项目目录>`（显式）。
5. 把新 effect_id 追加到本文件第 2 节的表格里。
