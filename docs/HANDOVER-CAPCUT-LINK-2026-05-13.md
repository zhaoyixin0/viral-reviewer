# Handover — CapCut "Couldn't link" Investigation

**Branch:** `worktree-capcut-link`
**Worktree:** `.claude/worktrees/capcut-link`
**Last work:** 2026-05-13 ~17:00 (本机), 待续到换电脑后
**Status:** Investigation paused — 等 user 一个手动验证实验结果

---

## TL;DR — 当前位置

正在追 `Couldn't link` 真因。已排除多个嫌疑（path 格式、duration、schema 字段），
最后剩一个待验证的 hypothesis: **"CapCut 5.7+ 国际版不允许 link 到 project 内部
`materials/*.mp4`"**。如果实验成功，方案改 zip 结构；如果失败，挖 mp4 codec/container。

---

## 已排除的假设

| # | 假设 | 验证手段 | 结论 |
|---|---|---|---|
| 1 | `path` 必须绝对路径（5/12 working sample 是绝对路径） | 手动改 PORK/draft_content.json 的 `path` 为 `C:/Users/.../PORK/materials/input.mp4` 绝对路径，重开 CapCut | ❌ 还是 "Couldn't link" — 且 CapCut 自己把 path 改回相对路径 `materials/input.mp4`。CapCut **故意**用相对路径存储 |
| 2 | `duration` 不一致导致 link 校验失败（我们写 25217000μs vs CapCut 自测 25233333μs，差 16ms ≈ 0.5 帧） | 手动改 PORK/draft_content.json + draft_meta_info.json 的 duration 为 CapCut 自测值 25233333μs，重开 | ❌ 还是 "Couldn't link" |
| 3 | 缺 schema 字段（capcut-cli factory.ts 写 30+ 字段，我们只写 8 个） | 读 PORK/draft_content.json — CapCut 加载时**自动 enrich** 到 70+ 字段（check_flag=65535、crop、video_algorithm 等都填了）；schema 不完整不是 link 失败原因，是 schema parsing 之后的 link 阶段 reject | ❌ 不是 schema 字段问题 |
| 4 | `material_name` 不为空（5/12 working sample 是空字符串） | 未测试 — 已被 #1/#2 排除主要 path 嫌疑 | — |

---

## 关键证据 (PORK 项目状态)

**位置:** `C:\Users\Admin\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\PORK\`

打开后 CapCut 已 enrich 出 sidecars:
```
.locked
adjust_mask/
attachment_pc_common.json
common_attachment/
draft_agency_config.json
draft_biz_config.json (0 bytes)
draft_content.json (102KB, enriched to 36 root keys / 70+ video material fields)
draft_content.json.bak                  ← 原始我们 export 的
draft_content.json.bak-relative-test    ← 我备份的（实验 #1 之前的状态）
draft_content.json.bak-duration-test    ← 我备份的（实验 #2 之前的状态）
draft_cover.jpg
draft_meta_info.json
draft_settings
draft_virtual_store.json
materials/input.mp4                     ← 真实 mp4 在这
matting/
performance_opt_info.json
qr_upload/
README.txt                              ← 我们打包的
Resources/
smart_crop/
subdraft/
template-2.tmp                          ← CapCut 工作副本
```

**ffprobe 数据 (PORK/materials/input.mp4):**
- `r_frame_rate`: 30/1
- `streams[0].duration`: 25.167000s = 25167000μs (码流真实)
- `format.duration`: 25.217000s = 25217000μs (container, 我们写的)
- `nb_frames`: 755 帧 → 755/30 = 25166666μs (按帧算)
- CapCut 自测: 25233333μs (= 757 帧 @ 30fps，比 ffprobe 多 2 帧)

**draft_meta_info.json `draft_materials[0].value[0]` (CapCut 自己加的):**
```json
{
  "id": "E4CE6FC1-FC6E-4960-B99A-268AF2D3B523",
  "file_Path": "materials/input.mp4",   ← CapCut 自己写相对路径！
  "duration": 25217000,
  "width": 960, "height": 540,
  "extra_info": "input.mp4",
  "metetype": "video",
  "md5": "",
  "create_time": -1
}
```

---

## 待验证的最后一个 Hypothesis

**"CapCut 5.7+ 国际版不允许 link 到 project 内 `materials/*.mp4`，认为已 link 状态"**

### 实验设置 (已就绪)
- `C:\Users\Admin\Desktop\PORK-input-external.mp4` — 已从 PORK/materials/ 复制到 Desktop（**project 外部**位置）

### 测试步骤（user 待做）
1. 完全关闭 CapCut（包括 tray icon）
2. 重开 CapCut
3. 双击 PORK 项目
4. 弹 Link Media 对话框
5. 点 "Link media" 按钮
6. **不要勾** "Link media when selecting a folder"
7. 文件选择器导航到 **Desktop**
8. 选 `PORK-input-external.mp4` → Open

### 预期判断

| 结果 | 含义 | 下一步方案 |
|---|---|---|
| ✅ Link 成功 | CapCut 拒绝 link 到 project 内部 mp4 (project-internal 视为已 link) | **修改 zip 结构** — mp4 不放 project 内 (例如放到 zip 根目录 + draft_content.json 写相对路径 `../<mp4-filename>`，让 user 解压后 mp4 在 project 外) |
| ❌ 还是 Couldn't link | mp4 文件本身被 CapCut 拒绝（codec / container / metadata 不被接受） | 挖 mp4 codec：CapCut 可能要求 H.264 Baseline/Main、yuv420p、特定 SPS 配置；当前从 Vercel function 拿的 mp4 可能 not CapCut-friendly |

---

## 假设 #1 (Link 成功) 的方案细化

如果实验 success，可能的实现方向：

**方案 X1: 把 mp4 放 zip 根，project 文件夹在 zip 内**
```
zip:
  PORK/
    draft_content.json   ← path: "../input.mp4"
    draft_meta_info.json
  input.mp4              ← user 解压后 mp4 在 project 外
```
风险：user 拖整个 zip 内容到 CapCut Projects 目录时，mp4 可能丢

**方案 X2: 不打包 mp4，instructions 让 user 自己拖 mp4 进去**
- zip 只含 `<projectName>/` 不含 mp4
- README.txt 指导 user 拖 mp4
- 风险：user 一定记错 mp4 命名/位置

**方案 X3: 用 `media_path` 字段 instead of `path`**
- 看 capcut-cli factory.ts 有 `media_path: ""` 字段
- CapCut enrich 后的 PORK 也保留 `media_path: ""` 空字符串
- 可能 CapCut 用 `media_path` 解析 user-side mp4 location（绝对/相对）

需要在选定方案前再做一组对照实验。

---

## 假设 #2 (mp4 codec 问题) 的下一步

如果实验 ❌：

1. **跑 ffprobe -show_streams** 看完整 codec 参数：
   ```bash
   node -e "require('ffprobe-static'); require('child_process').execSync('ffprobe -show_streams ...')"
   ```
2. 对比 5/12 working sample mp4 的 codec（如果还在 user 机器上）
3. 测试方案：用 ffmpeg 把 mp4 重新编码为 baseline H.264 + yuv420p + faststart：
   ```
   ffmpeg -i input.mp4 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart output.mp4
   ```
4. 用 reencoded mp4 测 CapCut link

如果 reencode 后能 link → schema 修在 compile-capcut server-side 流程加 ffmpeg transcoding 步骤

---

## 文件参照

- **本项目 build.ts**: `lib/capcut/build.ts` — draft_content.json 生成入口
- **capcut-cli (本地下载):** `/tmp/capcut_cli_factory.ts` — full 33-field VideoMaterial schema (参考)
- **capcut-cli sample (本地下载):** `$TEMP/sample_draft_content.json` — minimal 8-field 测试样例
- **5/12 working draft (历史):** 之前 user 提供的 working sample — path 是绝对路径，由 user 手动 link 后 CapCut 写回
- **PORK project:** `C:\Users\Admin\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\PORK\` — 当前调试现场

## 备份的 PORK draft_content.json
- `draft_content.json.bak` — 我们 export 的原始版本 (CapCut 未 enrich)
- `draft_content.json.bak-relative-test` — 实验 #1 (绝对路径) 之前的状态
- `draft_content.json.bak-duration-test` — 实验 #2 (duration 改 CapCut 值) 之前的状态

恢复任一备份：
```bash
cp "<PORK>/draft_content.json.bak" "<PORK>/draft_content.json"
```

---

## 切换电脑流程

1. 在新电脑 `git fetch && git checkout worktree-capcut-link`
2. 但 PORK 项目状态在原电脑！换电脑后**不能继续直接复现**实验。需要：
   - 在新电脑重新跑 compile-capcut export 一份新 zip
   - 解压安装 PORK 项目
   - 重做实验（步骤见上方"待验证"段）
3. 或者：原电脑同步 PORK 文件夹到新电脑（不推荐 — 可能跨 CapCut 安装实例有 cache 不一致）

最稳妥：换电脑后从头跑一遍 compile-capcut + 实验，把结果记到这个 handover 文件下面的 "Findings" 章节，继续推进。
