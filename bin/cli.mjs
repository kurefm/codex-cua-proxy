#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = "codex-cua-proxy";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const MODULE_SOURCE = readFileSync(
  new URL("../macos-system-proxy.mjs", import.meta.url),
  "utf8",
);
const BEGIN = `// >>> ${NAME}`;
const END = `// <<< ${NAME}`;
const ANCHOR = "await cua_repl.launch();";
const ENTRY = "Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs";
const NODE = "Contents/Resources/cua_node/bin/node";
const DEFAULT_APPS = ["ChatGPT.app", "Codex.app"].flatMap(app => [
  join("/Applications", app),
  join(homedir(), "Applications", app),
]);
const BLOCK_PATTERN = new RegExp(`^[ \\t]*${BEGIN}\\b[^\\n]*\\n[\\s\\S]*?^[ \\t]*${END}[^\\n]*\\n`, "m");
// 早期 README 让用户手动加入的 import 行。
const LEGACY_PATTERN = /^[ \t]*await import\(["'][^"']*macos-system-proxy\.mjs["']\);[ \t]*\n/m;

class CliError extends Error {}

function usage() {
  return `用法: npx ${NAME} <install|status|uninstall> [--app <path>]

  install     向 CUA 入口内联系统代理补丁（重复执行会更新为当前版本）
  status      显示应用、入口和补丁状态，以及当前系统代理
  uninstall   从 CUA 入口移除补丁

  --app <path>  指定应用路径，默认依次查找 ${DEFAULT_APPS.join(", ")}`;
}

function parseArgs(argv) {
  const args = { command: undefined, app: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app") {
      args.app = argv[++i];
      if (!args.app) throw new CliError("--app 需要一个路径");
    } else if (arg.startsWith("--app=")) {
      args.app = arg.slice("--app=".length);
    } else if (arg === "-h" || arg === "--help") {
      args.command = "help";
    } else if (arg === "-v" || arg === "--version") {
      args.command = "version";
    } else if (!args.command) {
      args.command = arg;
    } else {
      throw new CliError(`多余的参数: ${arg}`);
    }
  }
  return args;
}

function locate(appOption) {
  const candidates = appOption ? [appOption] : DEFAULT_APPS;
  for (const app of candidates) {
    const entry = join(app, ENTRY);
    if (existsSync(entry)) return { app, entry, node: join(app, NODE) };
  }
  throw new CliError(
    appOption
      ? `未找到 CUA 入口: ${join(appOption, ENTRY)}`
      : `未在以下位置找到带 CUA 的应用: ${DEFAULT_APPS.join(", ")}；可用 --app 指定`,
  );
}

function appVersion(app) {
  try {
    return execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleShortVersionString", "raw", join(app, "Contents/Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "未知";
  }
}

function strip(source) {
  return source.replace(BLOCK_PATTERN, "").replace(LEGACY_PATTERN, "");
}

function patchState(source) {
  const marker = source.match(new RegExp(`${BEGIN} ([\\w.+-]+)`));
  if (marker) return { kind: "installed", version: marker[1] };
  if (LEGACY_PATTERN.test(source)) return { kind: "legacy" };
  return { kind: "none" };
}

function buildBlock(indent) {
  const body = MODULE_SOURCE.trimEnd()
    .split("\n")
    .map(line => (line ? `${indent}  ${line}` : ""))
    .join("\n");
  return `${indent}${BEGIN} ${version} (自动生成，请用 npx ${NAME} uninstall 移除)\n`
    + `${indent}{\n${body}\n${indent}}\n`
    + `${indent}${END}\n`;
}

function patch(source) {
  const stripped = strip(source);
  const anchors = [...stripped.matchAll(new RegExp(`^([ \\t]*)${ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gm"))];
  if (anchors.length !== 1) {
    throw new CliError(
      `入口中找到 ${anchors.length} 处 \`${ANCHOR}\`，需要恰好 1 处；该应用版本的入口结构可能已变化，未做任何修改`,
    );
  }
  const [match] = anchors;
  return stripped.slice(0, match.index) + buildBlock(match[1]) + stripped.slice(match.index);
}

function timestamp() {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupOf(entry) {
  const base = `${entry}.backup-${timestamp()}`;
  for (let n = 0; ; n++) {
    const backup = n ? `${base}-${n}` : base;
    try {
      copyFileSync(entry, backup, constants.COPYFILE_EXCL);
      return backup;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function writeChecked({ entry, node }, next) {
  const backup = backupOf(entry);
  writeFileSync(entry, next);
  try {
    execFileSync(existsSync(node) ? node : process.execPath, ["--check", entry], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    copyFileSync(backup, entry);
    throw new CliError(`修改后的入口未通过语法检查，已从备份恢复:\n${error.stderr ?? error.message}`);
  }
  return backup;
}

function install(target) {
  const source = readFileSync(target.entry, "utf8");
  const next = patch(source);
  if (next === source) {
    console.log(`补丁已是最新 (${version})，无需修改: ${target.entry}`);
    return;
  }
  const backup = writeChecked(target, next);
  console.log(`已写入补丁 (${version}): ${target.entry}`);
  console.log(`备份: ${backup}`);
  console.log("请完全退出并重新打开应用，正在运行的 CUA 进程不会加载改动。");
}

function uninstall(target) {
  const source = readFileSync(target.entry, "utf8");
  const next = strip(source);
  if (next === source) {
    console.log(`入口中没有补丁，无需修改: ${target.entry}`);
    return;
  }
  const backup = writeChecked(target, next);
  console.log(`已移除补丁: ${target.entry}`);
  console.log(`备份: ${backup}`);
  console.log("请完全退出并重新打开应用。");
}

async function status(target) {
  const source = readFileSync(target.entry, "utf8");
  const state = patchState(source);
  const label = {
    installed: `已安装 (${state.version})${state.version === version ? "" : `，当前 CLI 为 ${version}，可运行 install 更新`}`,
    legacy: "旧版手动 import，可运行 install 迁移为内联补丁",
    none: "未安装",
  }[state.kind];
  const anchorCount = strip(source).split(ANCHOR).length - 1;

  await import("../macos-system-proxy.mjs");
  console.log(`应用:     ${target.app} (${appVersion(target.app)})`);
  console.log(`入口:     ${target.entry}`);
  console.log(`补丁:     ${label}`);
  console.log(`锚点:     ${anchorCount === 1 ? "正常" : `异常（找到 ${anchorCount} 处）`}`);
  console.log(`HTTP 代理:  ${process.env.HTTP_PROXY || "(关闭)"}`);
  console.log(`HTTPS 代理: ${process.env.HTTPS_PROXY || "(关闭)"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || !args.command) {
    console.log(usage());
    return;
  }
  if (args.command === "version") {
    console.log(version);
    return;
  }
  const commands = { install, status, uninstall };
  const command = commands[args.command];
  if (!command) throw new CliError(`未知命令: ${args.command}\n\n${usage()}`);
  if (process.platform !== "darwin") throw new CliError("仅支持 macOS");
  await command(locate(args.app));
}

try {
  await main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`${NAME}: ${error.message}`);
  } else if (error?.code === "EPERM" || error?.code === "EACCES") {
    console.error(`${NAME}: 没有权限修改 ${error.path ?? "应用文件"}`);
    console.error("请在「系统设置 → 隐私与安全性 → App 管理」中允许当前终端，然后重试。");
  } else {
    console.error(`${NAME}: ${error?.stack ?? error}`);
  }
  process.exitCode = 1;
}
