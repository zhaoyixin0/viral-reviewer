import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
