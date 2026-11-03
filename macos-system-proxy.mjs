// 本文件会被 CLI 原样内联进 CUA 入口的 try 块，因此不能使用顶层 import/export。
const { execFileSync } = await import("node:child_process");

// shortcut: 仅读取启动时的手动 HTTP/HTTPS 代理，改用 PAC 时需扩展。
function applySystemProxy() {
  const settings = execFileSync("/usr/sbin/scutil", ["--proxy"], {
    encoding: "utf8",
  });
  const get = key =>
    settings.match(new RegExp(`^  ${key} : (.+)$`, "m"))?.[1].trim();

  for (const protocol of ["HTTP", "HTTPS"]) {
    const proxy = get(`${protocol}Enable`) === "1"
      ? `http://${get(`${protocol}Proxy`)}:${get(`${protocol}Port`)}`
      : "";

    process.env[`${protocol}_PROXY`] =
      process.env[`${protocol.toLowerCase()}_proxy`] = proxy;
  }

  process.env.NODE_USE_ENV_PROXY = "1";
  process.env.NO_PROXY = process.env.no_proxy =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local";
}

applySystemProxy();
