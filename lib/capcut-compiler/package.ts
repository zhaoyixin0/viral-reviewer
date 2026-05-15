import JSZip from "jszip";
import type { DraftContent, DraftMetaInfo } from "./schema";
import { SETUP_BAT, SETUP_PS1, SETUP_SH } from "./setup-scripts";

const README_TEMPLATE = (
  projectName: string,
  hasBgm: boolean,
  videoCount: number,
  transitionDesc: string,
) => `# ${projectName} · CapCut 项目导出

由 Viral Reviewer 自动生成。素材已按 AI 推荐顺序拼接 + 切好镜头 + 应用 push-in / pull-out 动画 + 字幕轨 + 真转场${hasBgm ? " + BGM 配乐" : ""}。

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
├── draft_content.json   ← 时间轴 / 切镜 / 动画 / 字幕 / 转场${hasBgm ? " / BGM 轨" : ""}
├── draft_meta_info.json ← 项目元数据
└── materials/           ← ${videoCount} 段视频${hasBgm ? " + BGM" : ""}
\`\`\`

## 已自动应用的 AI 推荐

- 按 AI 编排顺序拼接的 ${videoCount} 段视频（来自 topPriorityActions）
- 每段 push-in / pull-out 缩放动画（关键帧已写入）
- 已应用转场：${transitionDesc}
- 字幕轨（用户原视频字幕）${hasBgm ? `
- 独立 BGM 配乐轨（你上传的音乐）` : ""}

## 还没自动应用的（Phase 6+）

- 调色、特效
- 速度坡（变速）

运行脚本后这几个 setup 文件可以删掉。

---

Viral Reviewer · ${new Date().toISOString().slice(0, 10)}
`;

export type PackageVideo = {
  buffer: Buffer;
  /** 已 sanitize + dedupe 的文件名（与 draftContent.materials.videos[i].path 末段一致） */
  fileName: string;
};

export type PackageInput = {
  projectName: string;
  draftContent: DraftContent;
  metaInfo: DraftMetaInfo;
  /** N 个视频（与 draft_content 里的 videos[] 同序、同 fileName）。Task 11 起多视频化 */
  videos: ReadonlyArray<PackageVideo>;
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
 *       <视频文件名 1>
 *       <视频文件名 2>
 *       ...
 *       [bgm.mp3]   ← 只在用户传了 BGM 时存在
 *
 * 压缩：全局 DEFLATE level:1。mp4 已经是压缩格式，level:6 几乎不省体积却显著
 * 增加 CPU 时间（120s function 限制下尾部风险高）；level:1 让小文本仍轻微压缩。
 */
export async function packageDraftAsZip(
  input: PackageInput,
): Promise<Uint8Array> {
  if (input.videos.length === 0) {
    throw new Error("packageDraftAsZip: videos must be non-empty");
  }

  const zip = new JSZip();
  const root = zip.folder(input.projectName);
  if (!root) throw new Error("failed to create root folder in zip");

  const hasBgm = !!(input.bgmBuffer && input.bgmFileName);
  const transitionDesc = describeTransitions(input.draftContent);

  root.file("draft_content.json", JSON.stringify(input.draftContent, null, 2));
  root.file("draft_meta_info.json", JSON.stringify(input.metaInfo, null, 2));
  root.file(
    "README.txt",
    README_TEMPLATE(
      input.projectName,
      hasBgm,
      input.videos.length,
      transitionDesc,
    ),
  );

  const materials = root.folder("materials");
  if (!materials) throw new Error("failed to create materials folder");
  for (const v of input.videos) {
    materials.file(v.fileName, v.buffer);
  }
  if (hasBgm) {
    materials.file(input.bgmFileName!, input.bgmBuffer!);
  }

  // setup 脚本写 zip 根目录（和 <projectName>/ 文件夹并列）。
  // setup.sh 标记可执行（0o755），macOS 解压后能直接 bash 运行。
  zip.file("setup.bat", SETUP_BAT);
  zip.file("setup.ps1", SETUP_PS1);
  zip.file("setup.sh", SETUP_SH, { unixPermissions: 0o755 });

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 1 },
  });
}

function describeTransitions(draft: DraftContent): string {
  const transitions = draft.materials.transitions ?? [];
  if (transitions.length === 0) return "无（hard_cut 直切）";
  const uniq = Array.from(new Set(transitions.map((t) => t.name).filter(Boolean)));
  if (uniq.length === 0) return "无（hard_cut 直切）";
  return uniq.join(" / ");
}
