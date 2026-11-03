# codex-cua-proxy

让 ChatGPT / Codex 桌面应用的 CUA 子进程使用 macOS 系统中的手动 HTTP/HTTPS 代理。无第三方依赖，不写死代理地址或端口。

模块通过 `/usr/sbin/scutil --proxy` 读取系统配置，设置当前进程的环境变量；CUA 随后启动的 `node_repl` 继承这些变量。

## 前提

- macOS，系统设置中已配置可用的手动 HTTP/HTTPS 代理，代理客户端保持运行。
- CUA 的 Node 支持 `NODE_USE_ENV_PROXY=1`。本机验证版本为应用自带的 Node `v24.22.1`。
- 运行 CLI 的 Node 版本 >= 18。

## 安装与使用

```sh
npx codex-cua-proxy install
```

然后完全退出并重新打开 ChatGPT / Codex。正在运行的旧 CUA 进程不会自动加载改动。

`install` 会：

1. 在 `/Applications`、`~/Applications` 下依次查找 `ChatGPT.app`、`Codex.app` 中的 CUA 入口 `Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs`。
2. 在入口旁生成带时间戳的备份 `cua-repl.mjs.backup-YYYYMMDD-HHMMSS`。
3. 把 `macos-system-proxy.mjs` 的内容用 `// >>> codex-cua-proxy` / `// <<< codex-cua-proxy` 标记包裹，内联到入口中唯一一处 `await cua_repl.launch();` 之前。补丁不引用任何外部文件，npx 缓存被清理也不影响应用。
4. 用应用自带的 Node 执行 `--check`；不通过则从备份恢复。

重复执行 `install` 会把已有补丁替换为当前版本，内容相同时不做修改。早期 README 中手动加入的 `await import(".../macos-system-proxy.mjs")` 会被自动移除并迁移为内联补丁。若入口中找不到或找到多处锚点，说明该应用版本的入口结构已变化，CLI 会报错并且不做任何修改。

其他命令：

```sh
npx codex-cua-proxy status      # 应用版本、入口路径、补丁状态、当前系统代理
npx codex-cua-proxy uninstall   # 移除补丁（同样先备份，再检查语法）
```

应用不在默认位置时，用 `--app` 指定：

```sh
npx codex-cua-proxy install --app /path/to/ChatGPT.app
```

`npx` 会以当前用户权限执行从 npm 下载的代码去修改应用包，建议固定版本号，例如 `npx codex-cua-proxy@0.1.0 install`。

若提示没有权限修改应用文件，在「系统设置 → 隐私与安全性 → App 管理」中允许当前使用的终端，然后重试。

### 从源码运行

```sh
git clone git@github.com:kurefm/codex-cua-proxy.git
cd codex-cua-proxy
./bin/cli.mjs install
```

## 运行行为

- CUA 启动时，在 `cua_repl.launch()` 之前执行内联的 `applySystemProxy()`。
- HTTP、HTTPS 分别使用系统的启用状态、地址和端口，设置大写与小写代理环境变量；某项关闭时，对应变量设为空。
- 设置 `NODE_USE_ENV_PROXY=1`，供后续新启动的 Node 子进程使用。
- 固定覆盖 `NO_PROXY` 和 `no_proxy` 为：

```text
127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local
```

## 验证

```sh
npx codex-cua-proxy status
```

`status` 显示补丁是否已写入入口，以及按系统设置得到的 HTTP/HTTPS 代理；它不能证明正在运行的应用已加载补丁。

重启应用后，让 CUA 在 Chrome 打开一个临时公开页面、读取内容、点击链接并确认跳转，最后关闭测试标签页。仅发现 Chrome 或列出标签页不足以证明页面操作恢复。

本机曾通过打开页面、读取、点击跳转和关闭测试标签页的验证，不保证其他版本或其他 CUA 功能都可用。

## 更新与回滚

应用更新可能覆盖入口中的补丁。更新后运行 `npx codex-cua-proxy status` 检查，若显示未安装，重新执行 `install` 并重启应用。不要用旧版完整入口或旧版备份覆盖新版。

回滚时执行 `npx codex-cua-proxy uninstall` 并重启应用。手动恢复备份时，应使用同一应用版本的备份。

## 限制

- 这是本地临时绕过方案，不是官方持久代理配置接口。
- 仅支持 macOS 手动 HTTP/HTTPS 代理；不解析 PAC、自动发现、SOCKS、系统绕过列表或按网络接口划分的代理配置。
- 假定系统地址和端口有效，按 `scutil` 当前文本格式解析，不额外校验配置。
- 系统代理变化后需重新启动 CUA；同一进程中的重复 import 通常不会再次执行模块。
- 环境代理开关作用于后续新启动的 Node 子进程，不保证改变已运行进程中初始化过的网络客户端。
- 覆盖已有的 HTTP/HTTPS 代理变量和 `NO_PROXY`，不合并原有绕过列表，也不处理 `ALL_PROXY`。
- `NO_PROXY` 中 CIDR 和通配符的匹配取决于底层网络实现，尚未验证；不能据此保证所有内网流量都绕过代理。
- 不修复代理节点、上游连接、证书、登录、扩展权限、原生通信或其他 CUA 问题；未验证登录、上传等其他流程。
- 修改应用包会使应用签名校验失败（`codesign --verify` 报 invalid signature），本机应用仍可正常启动；更新可能覆盖入口或改变启动方式。
- 系统代理配置读取失败会导致 CUA 启动失败，错误由原入口的 catch 输出。
