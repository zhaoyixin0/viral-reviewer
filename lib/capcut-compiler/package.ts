import JSZip from "jszip";
import type { DraftContent, DraftMetaInfo } from "./schema";

const README_TEMPLATE = (projectName: string, hasBgm: boolean) => `# ${projectName} · CapCut 项目导出

由 Viral Reviewer 自动生成。素材已经按 AI 推荐的剪辑清单切好镜头 + 应用 push-in / pull-out 动画 + 字幕轨${hasBgm ? "+ BGM 配乐" : ""}。

## 怎么打开

### Windows
1. 解压这个 zip 到：
   \`C:\\Users\\<你的用户名>\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft\\\`
2. 打开 CapCut 桌面版
3. 在项目列表里看到 \`${projectName}\` —— 双击进入编辑器

### macOS
1. 解压到：
   \`/Users/<你的用户名>/Movies/CapCut/User Data/Projects/com.lveditor.draft/\`
2. 打开 CapCut

## 第一次打开会弹"链接素材" — 这是预期的

CapCut 云端生成的项目不知道你电脑上的绝对路径，所以**第一次打开必定弹"链接素材"对话框**。流程：

1. **先把 zip 完整解压**（关键 — 不要直接从 zip 内拖文件）
2. 双击进入项目，弹"链接素材"对话框，列出 \`${"input.mp4"}\`
3. 点 **"链接素材"** 按钮 → 在文件选择器里**导航到解压后的 \`${"<projectName>"}/materials/\` 目录** → 选 \`input.mp4\`
4. CapCut 自动 fix 视频引用，项目就能用了

**链接成功后，下次打开就不会再弹弹窗**（CapCut 把绝对路径写入了项目元数据）。${
  hasBgm
    ? `

**视频链接好后**，时间轴上的 BGM 音频轨可能仍显示红色"媒体丢失"。CapCut 一次只能 fix 一类素材。再做一次：
- 看时间轴 audio 轨上的红色 \`bgm.mp3\`
- CapCut 再次弹"链接素材"弹窗（或顶部 banner 提示）
- 点 **"链接素材"** 按钮 → 选解压后的 \`materials/bgm.mp3\`

之后视频和 BGM 都能完整播放。`
    : `

注意：本项目**没有独立 audio 轨**。视频自带的音轨会在视频段里直接播放。如果想单独调音量或替换 BGM，右键视频段 → "分离音频" 即可分出独立音轨。`
}

> ⚠️ 如果点了"链接素材"按钮**没反应**，说明这是 2026-05-13 之前生成的旧 zip（draft_meta_info 填错路径导致死锁）。请回到 Viral Reviewer 重新导出。

## 项目结构

\`\`\`
${projectName}/
├── draft_content.json   ← 时间轴 / 切镜 / 动画 / 字幕${hasBgm ? " / BGM 轨" : ""}
├── draft_meta_info.json ← 项目元数据
└── materials/
    ├── input.mp4        ← 你上传的原视频（含原音轨）${
      hasBgm
        ? `
    └── bgm.mp3          ← AI 推荐的 BGM 配乐`
        : ""
    }
\`\`\`

## 已自动应用的 AI 推荐

- 按时间轴排序的切镜点（来自 topPriorityActions）
- 每段 push-in / pull-out 缩放动画（关键帧已写入，每段画面会有"呼吸感"）
- 字幕轨（用户原视频字幕）${hasBgm ? `
- 独立 BGM 配乐轨（你上传的音乐 + AI 适配推荐）` : ""}

## 还没自动应用的（Phase 6+）

- 复杂转场（whip pan / match cut / 速度坡）
- 调色（teal/orange grading 等）
- 特效

打开 CapCut 后参考 Viral Reviewer 网站上的 globalDoNots 红色警告区，避免做坏事。

---

Viral Reviewer · ${new Date().toISOString().slice(0, 10)}
`;

export type PackageInput = {
  projectName: string;
  draftContent: DraftContent;
  metaInfo: DraftMetaInfo;
  videoBuffer: Buffer;
  videoFileName: string; // "input.mp4"
  /** Phase 5.5：可选 BGM */
  bgmBuffer?: Buffer;
  bgmFileName?: string; // "bgm.mp3"
};

/**
 * 打包成 CapCut 项目 zip。
 * zip 结构：
 *   <projectName>/
 *     draft_content.json
 *     draft_meta_info.json
 *     README.txt
 *     materials/
 *       input.mp4
 *       [bgm.mp3]   ← 只在用户传了 BGM 时存在
 */
export async function packageDraftAsZip(
  input: PackageInput,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(input.projectName);
  if (!root) throw new Error("failed to create root folder in zip");

  const hasBgm = !!(input.bgmBuffer && input.bgmFileName);

  root.file("draft_content.json", JSON.stringify(input.draftContent, null, 2));
  root.file("draft_meta_info.json", JSON.stringify(input.metaInfo, null, 2));
  root.file("README.txt", README_TEMPLATE(input.projectName, hasBgm));

  const materials = root.folder("materials");
  if (!materials) throw new Error("failed to create materials folder");
  materials.file(input.videoFileName, input.videoBuffer);
  if (hasBgm) {
    materials.file(input.bgmFileName!, input.bgmBuffer!);
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
