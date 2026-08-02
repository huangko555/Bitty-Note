import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "./",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
