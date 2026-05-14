/**
 * zip 根目录附带的 setup 脚本。用户解压后运行，脚本：
 *   1. 找到同级唯一的项目文件夹
 *   2. 校验路径不含会破坏字面替换的字符（| & 换行）
 *   3. 探测 CapCut / 剪映 drafts 目录（VR_SETUP_DRAFTS_DIR 环境变量可覆盖）
 *   4. 把项目文件夹搬进 drafts 目录（找不到则就地处理）
 *   5. 对 draft_content.json / draft_meta_info.json 做纯字面 token 替换
 * 脚本不解析 JSON —— 所以 PowerShell 和 bash 都能可靠实现。
 * 纯本地文件操作，零网络请求。VR_SETUP_DRAFTS_DIR 既支持 CI 测试，
 * 也支持真实用户的自定义 CapCut 安装路径。
 */

export const SETUP_BAT = `@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
echo 按任意键关闭此窗口...
pause >nul
`;

export const SETUP_PS1 = `﻿$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot

$subDirs = @(Get-ChildItem -LiteralPath $scriptDir -Directory)
if ($subDirs.Count -ne 1) {
  Write-Host ("错误：脚本同级应正好有 1 个项目文件夹，实际找到 " + $subDirs.Count + " 个。") -ForegroundColor Red
  Write-Host "请确认解压结构为 setup.bat + setup.ps1 + setup.sh + 单个项目文件夹。"
  exit 1
}
$projectDir = $subDirs[0].FullName
$projectName = $subDirs[0].Name

# 正则匹配 管道符 & 回车 换行 —— 这些字符会破坏后续字面 token 替换或 JSON。
# 不拦反斜杠：PS1 用 .Replace 字面替换，且 finalFwd 已把反斜杠转成正斜杠。
if ($projectDir -match '[\\|&\\r\\n]') {
  Write-Host "错误：项目路径含特殊字符（| 或 &），CapCut 可能无法识别。" -ForegroundColor Red
  Write-Host "请把整个文件夹移到简单路径（如 C:\\Temp\\）后重新运行。"
  exit 1
}

# drafts 目录：VR_SETUP_DRAFTS_DIR 环境变量优先（CI 测试 / 自定义安装路径），
# 否则探测 CapCut + 剪映 标准路径。
$draftsDir = $null
if ($env:VR_SETUP_DRAFTS_DIR -and (Test-Path -LiteralPath $env:VR_SETUP_DRAFTS_DIR)) {
  $draftsDir = $env:VR_SETUP_DRAFTS_DIR
} else {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "CapCut\\User Data\\Projects\\com.lveditor.draft"),
    (Join-Path $env:LOCALAPPDATA "JianyingPro\\User Data\\Projects\\com.lveditor.draft")
  )
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { $draftsDir = $c; break } }
}

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

if ($final -match '[\\|&\\r\\n]') {
  Write-Host "错误：最终项目路径含特殊字符（| 或 &），CapCut 可能无法识别。" -ForegroundColor Red
  Write-Host "请把 CapCut 项目目录移到不含 | & 的路径后重新运行。"
  exit 1
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
  *"|"*|*"&"*|*\\\\*|*[[:cntrl:]]*)
    echo "错误：项目路径含特殊字符（| & 反斜杠 或控制字符）。请移到简单路径后重试。"
    exit 1 ;;
esac

# drafts 目录：VR_SETUP_DRAFTS_DIR 环境变量优先（CI 测试 / 自定义安装路径），
# 否则探测 CapCut + 剪映 标准路径。
draftsDir=""
if [ -n "\${VR_SETUP_DRAFTS_DIR:-}" ] && [ -d "$VR_SETUP_DRAFTS_DIR" ]; then
  draftsDir="$VR_SETUP_DRAFTS_DIR"
else
  candidates=(
    "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
    "$HOME/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
  )
  for c in "\${candidates[@]}"; do
    if [ -d "$c" ]; then draftsDir="$c"; break; fi
  done
fi

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

case "$final" in
  *"|"*|*"&"*|*\\\\*|*[[:cntrl:]]*)
    echo "错误：最终项目路径含特殊字符（| & 反斜杠 或控制字符），无法安全处理。"
    echo "请把 CapCut 项目目录移到简单路径后重试。"
    exit 1 ;;
esac

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
