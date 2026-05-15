# CapCut 转场结构逆向（Task 2 PROBE）

> 状态：**进行中（WIP）** — 核心结构已逆向完成，仅差「叠化 / cross dissolve」转场样本。
> 探测脚本：`scripts/probe-capcut-transitions.ts`（只读，可换机器跑）。
> 阻塞 Task 6 / 8 / 10。

## 探测环境

- CapCut **8.5.0**（Windows，`app_source: "cc"`，`platform.os: "windows"`）
- 样本项目（machine-local，不随 git 同步）：
  - `0514` — 4 段视频 + 3 转场
  - `0514 (1)` — 3 段视频 + 2 转场
- 工程格式：明文 `draft_content.json`。
  ⚠️ macOS 新版 CapCut 的 `draft_info.json` 是**加密的**，无法逆向 —— 必须用 Windows CapCut 8.5.0 的明文工程。

---

## 1. `materials.transitions[]` 字段结构

每个转场是 `draft.materials.transitions[]` 里的一个 material 对象：

```jsonc
{
  "id": "BBE15244-94AA-4be5-AAE1-DAE1D3BEDC48",  // UUID，被 segment 引用
  "type": "transition",
  "name": "Slick Twist",                          // 人类可读名
  "effect_id": "7627435157909261575",             // ★ 转场资源 ID（数字字符串）
  "resource_id": "7627435157909261575",           // = effect_id
  "third_resource_id": "0",
  "source_platform": 1,
  "path": "C:/Users/.../Cache/effect/7627435157909261575/<hash>",  // 本机 cache，生成时留空即可
  "duration": 2000000,                            // ★ 转场时长，微秒
  "is_overlap": true,                             // ★ 见第 4 节
  "platform": "all",
  "category_id": "27186",
  "category_name": "Trending",
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

| 转场名 | effect_id | 类型归类 | 来源 |
|---|---|---|---|
| Slick Twist | `7627435157909261575` | 运动 / 扭转 | 0514, 0514(1) |
| Filmstrip x2 | `7595848521199193349` | 胶片 / 特殊 | 0514, 0514(1) |
| **叠化 / cross dissolve** | **待补** | 叠化 | — |

⚠️ **缺叠化转场的 effect_id**。它是 Task 6 降级策略的落点（"未知 type → 降级 cross_dissolve"），必须实测补上。
补法：在 Windows CapCut 8.5.0 里给任一项目加一个基础「叠化 / Dissolve」转场，保存后跑 `npx tsx scripts/probe-capcut-transitions.ts`。

---

## 3. 转场如何挂到 segment

转场 material 的 `id` 出现在**前导 segment** 的 `extra_material_refs[]` 数组里。

- N 段视频 → 前 N-1 段各挂 1 个转场，**最后一段不挂**。
- `seg[i]` 的 `extra_material_refs` 里的转场 = `seg[i]` 与 `seg[i+1]` 之间的转场。
- 识别方式：遍历 `extra_material_refs`，凡 id 命中 `materials.transitions[].id` 的即转场引用（不靠数组位置，位置不固定）。

实测（`0514`，4 段 3 转场）：

```
seg[0] extra_material_refs 含 transitions[0]  → seg0↔seg1 转场
seg[1] extra_material_refs 含 transitions[1]  → seg1↔seg2 转场
seg[2] extra_material_refs 含 transitions[2]  → seg2↔seg3 转场
seg[3] extra_material_refs 不含转场           → 末段无后继
```

**与 `assemblyTimeline` 契约的差异**：我们的 `AssemblyClip.incomingTransition` 挂在「后一个 clip」上（`clip[i]` 与 `clip[i-1]` 之间，首 clip = null）。CapCut 挂「前导 segment」（末段 = 无）。Task 10 编译时做一次 index 平移：
`assemblyTimeline.clips[i].incomingTransition` → 写进 CapCut `segment[i-1]` 的 `extra_material_refs`。

---

## 4. 时间轴语义 —— 「不变，靠 `is_overlap` 标记」

plan Task 2 列了三种可能（重叠 D / 各缩短 D/2 / 不变靠标记），实测结论是**第三种**：

- `is_overlap: true`
- 但相邻段 `target_timerange` **完全首尾相接**：`seg[i].start + seg[i].duration === seg[i+1].start`，gap 恒为 0，既不重叠也不缩短。
- `source_timerange.duration === target_timerange.duration` —— 片段没有被裁短。
- `draft.duration === Σ segment.target_timerange.duration` —— 总时长就是各段时长直接相加。

两个样本项目均验证通过（见脚本 `[3]` 段输出）。

**含义**：转场的视觉重叠是 CapCut **渲染层**行为，由 `is_overlap: true` 驱动；写进 draft 的 timeline 数据保持「名义时长」，不做任何重叠/缩短换算。

**对 Task 8 的影响（重大简化）**：编排时间轴就是纯线性累加 —
`clip[i+1].targetStartSec = clip[i].targetEndSec`，转场完全不参与 `target_timerange` 的数学。Task 8 不需要实现「重叠 D」或「缩短 D/2」的复杂逻辑。

---

## 5. 对编译层（Task 6 / 8 / 10）的落地结论

- **Task 6**（schema + 映射表）：`materials.transitions` 用第 1 节的字段结构建 `TransitionMaterial` 类型；`transitions.ts` 映射表把编排枚举（`cross_dissolve` / `whip_pan` / ...）映到 effect_id。映射表至少需要叠化 + 已实测的 2 种；未知 type 降级到叠化。
- **Task 8**（edit-plan 时间轴）：转场**不影响** `target_timerange`，纯线性累加。转场时长 clamp 不超相邻较短段的一半（防御性，CapCut 应也会自己 clamp）。
- **Task 10**（接入真转场）：每个 `incomingTransition` 造一个 transition material push 进 `materials.transitions`；按第 3 节，把 material id 写进**前导 segment**（index 平移）的 `extra_material_refs`；`is_overlap` 恒 `true`；`duration` = 秒 → μs。
- **Task 12**：probe zip 在本机 CapCut 8.5.0 打开，确认转场真实出现、`path` 留空不报错。

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

## 附录 B：待办（Task 2 收尾）

1. [ ] 在 Windows CapCut 8.5.0 加一个基础「叠化 / cross dissolve」转场，跑探测脚本补 effect_id（第 2 节表格）。
2. [ ] 补全后本文件去掉「WIP」状态标注 → Task 2 完成 → 走 per-task 工作流（push / 等 merge）。
