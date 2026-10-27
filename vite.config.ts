import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";

const SRC_DIR = resolve(__dirname, "./src");
const external = [
  "electron",
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, "./package.json"), "utf8"),
) as { version: string };

const BaseConfig = defineConfig({
  root: __dirname,
  resolve: {
    alias: { "@": SRC_DIR },
  },
  define: {
    // 发版时 RELEASE_VERSION 优先，与 scripts/package.cjs 保持一致
    __PLUGIN_VERSION__: JSON.stringify(
      process.env.RELEASE_VERSION?.trim().replace(/^v/, "") || version,
    ),
  },
});

const configs = {
  main: defineConfig({
    ...BaseConfig,
    build: {
      minify: true,
      ssr: true,
      outDir: resolve(__dirname, "./dist/main"),
      lib: {
        entry: resolve(SRC_DIR, "./main/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rolldownOptions: { external },
      target: "node23",
    },
  }),
  preload: defineConfig({
    ...BaseConfig,
    build: {
      minify: true,
      outDir: resolve(__dirname, "./dist/preload"),
      lib: {
        entry: resolve(SRC_DIR, "./preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rolldownOptions: { external },
    },
  }),
  renderer: defineConfig({
    ...BaseConfig,
    build: {
      minify: true,
      outDir: resolve(__dirname, "./dist/renderer"),
      lib: {
        entry: resolve(SRC_DIR, "./renderer/index.ts"),
        formats: ["iife"],
        name: "qwqntNudgeRenderer",
        fileName: () => "index.js",
      },
      rolldownOptions: { external },
    },
  }),
};

export default defineConfig(
  ({ mode }) => configs[mode as keyof typeof configs],
);
