import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // tsconfig.json jsx="preserve"(Next.js 编译需要),vite/vitest 自己不能 preserve,
  // 这里告诉 oxc transformer(vite 8 默认)用 React automatic runtime,让测试可 import .tsx 组件。
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    // T5 C7:.tsx 测试用 per-file `// @vitest-environment jsdom` directive
    // 切到 DOM env;.ts 仍跑 default node env (无 React 依赖,启动快)。
    //
    // 写新 RTL test 必须做的两件事 (否则 DOM API 不存在 / matcher 报错):
    //   1. 文件首行加 `// @vitest-environment jsdom`
    //   2. 顶部 import `@testing-library/jest-dom/vitest` 加载 toBeInTheDocument 等 matcher
    // 参考 tests/components/trending/insight-tabs.test.tsx 作模板。
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // P3 #2 phase 3 commit 5/6 (W3 verdict 9154701 §"Pre-commit verify" 防御性 exclude):
    // 当前 include 用 tests/** 不会扫到 lib/__demo__/,但显式 exclude 保证未来 test
    // 范围扩展时 lib/url-allowlist/__demo__/dns-rebinding-poc.ts (runnable PoC,需真实
    // dns2 server + dns.setServers) 不进 vitest CI（CI DNS 不可控,会 flaky）。
    exclude: [...configDefaults.exclude, "lib/**/__demo__/**"],
    environment: "node",
    // 让 vitest 解析 `import "server-only"` 时走 server 分支（resolved 成空 noop），
    // 否则测试运行 next.js 服务端模块会抛 "cannot be imported from Client Component"
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
    alias: {
      "server-only": resolve(__dirname, "tests/__stubs__/server-only.ts"),
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
