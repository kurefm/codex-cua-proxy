# codex-cua-proxy

让 ChatGPT / Codex 桌面应用的 CUA 子进程使用 macOS 系统中的手动 HTTP/HTTPS 代理。无第三方依赖，不写死代理地址或端口。

模块通过 `/usr/sbin/scutil --proxy` 读取系统配置，设置当前进程的环境变量；CUA 随后启动的 `node_repl` 继承这些变量。

## 前提

- macOS，系统设置中已配置可用的手动 HTTP/HTTPS 代理，代理客户端保持运行。
- CUA 的 Node 支持 `NODE_USE_ENV_PROXY=1`。本机验证版本为应用自带的 Node `v24.22.1`。
- 可以编辑应用的 CUA 入口文件。本项目不会自动修改应用包。

## 安装与使用

### 1. 将项目放到固定位置

新安装时执行（已有项目无需重复克隆）：

```sh
git clone git@github.com:kurefm/codex-cua-proxy.git \
  "$HOME/Repositories/kurefm/chatgpt-system-proxy"
cd "$HOME/Repositories/kurefm/chatgpt-system-proxy"
pwd
```

记下 `pwd` 输出的绝对路径；接入后不要移动或删除模块。

### 2. 备份当前版本的 CUA 入口

本机当前版本的入口及备份命令：

```sh
cua_entry="/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs"
cp -p "$cua_entry" "$cua_entry.backup-$(date +%Y%m%d-%H%M%S)"
```

不同版本的入口位置可能变化，以当前实际使用的 CUA 入口为准。

### 3. 在原入口添加一行 import

在 `try` 内、`await cua_repl.launch();` 前加入下面那行 import。把模块路径替换为第 1 步得到的实际绝对路径：

```js
try {
  await import("/absolute/path/to/chatgpt-system-proxy/macos-system-proxy.mjs");
  await cua_repl.launch();
} catch (error) {
  // 原有错误处理保持原样。
}
```

只添加 import，不需要复制代理函数，也不要替换原有错误处理。

### 4. 检查语法并重启

在同一个终端、项目目录中执行：

```sh
cua_node="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
"$cua_node" --check "$cua_entry"
"$cua_node" --check ./macos-system-proxy.mjs
```

没有错误后，完全退出并重新打开 ChatGPT / Codex。正在运行的旧 CUA 进程不会自动加载改动。

## 运行行为

- import 模块时自动执行 `applySystemProxy()`。
- HTTP、HTTPS 分别使用系统的启用状态、地址和端口，设置大写与小写代理环境变量；某项关闭时，对应变量设为空。
- 设置 `NODE_USE_ENV_PROXY=1`，供后续新启动的 Node 子进程使用。
- 固定覆盖 `NO_PROXY` 和 `no_proxy` 为：

```text
127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local
```

## 验证

检查系统代理配置：

```sh
/usr/sbin/scutil --proxy
```

在项目目录，用独立测试进程检查模块生成的环境变量：

```sh
"$cua_node" --input-type=module -e '
await import("./macos-system-proxy.mjs");
console.log({
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY,
  NO_PROXY: process.env.NO_PROXY,
});
'
```

该命令只改变测试进程的环境，不能证明桌面应用已加载模块。

重启应用后，让 CUA 在 Chrome 打开一个临时公开页面、读取内容、点击链接并确认跳转，最后关闭测试标签页。仅发现 Chrome 或列出标签页不足以证明页面操作恢复。

本机曾通过打开页面、读取、点击跳转和关闭测试标签页的验证，不保证其他版本或其他 CUA 功能都可用。

## 更新与回滚

应用更新可能覆盖入口中的 import。检查新版本实际使用的入口；若缺失，先备份新版本文件，再加回 import，检查语法并重启。不要用旧版完整入口覆盖新版。

回滚时删除入口中添加的 import，并重启应用。若恢复备份，应使用同一应用版本的备份。本项目文件可以保留在应用包外。

## 限制

- 这是本地临时绕过方案，不是官方持久代理配置接口。
- 仅支持 macOS 手动 HTTP/HTTPS 代理；不解析 PAC、自动发现、SOCKS、系统绕过列表或按网络接口划分的代理配置。
- 假定系统地址和端口有效，按 `scutil` 当前文本格式解析，不额外校验配置。
- 系统代理变化后需重新启动 CUA；同一进程中的重复 import 通常不会再次执行模块。
- 环境代理开关作用于后续新启动的 Node 子进程，不保证改变已运行进程中初始化过的网络客户端。
- 覆盖已有的 HTTP/HTTPS 代理变量和 `NO_PROXY`，不合并原有绕过列表，也不处理 `ALL_PROXY`。
- `NO_PROXY` 中 CIDR 和通配符的匹配取决于底层网络实现，尚未验证；不能据此保证所有内网流量都绕过代理。
- 不修复代理节点、上游连接、证书、登录、扩展权限、原生通信或其他 CUA 问题；未验证登录、上传等其他流程。
- 修改应用包可能影响完整性校验；更新可能覆盖入口或改变启动方式。
- 模块路径必须保持可读；文件移动、删除或系统配置读取失败可能导致 CUA 启动失败，错误由原入口的 catch 输出。
