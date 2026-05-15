import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // tsconfig.json jsx="preserve"(Next.js 编译需要),vite/vitest 自己不能 preserve,
  // 这里告诉 oxc transformer(vite 8 默认)用 React automatic runtime,让测试可 import .tsx 组件。
  oxc: {
    jsx: { runtime: "automatic" },
  },
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
