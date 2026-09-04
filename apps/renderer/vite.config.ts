import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const CODEMIRROR_CORE = [
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "@codemirror/search",
  "@codemirror/autocomplete",
  "@codemirror/lint",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../out/renderer", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {

        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const path = id.split("\\").join("/");
          if (path.includes("react")) return "react";
          if (path.includes("/@xterm/")) return "xterm";
          if (CODEMIRROR_CORE.some((pkg) => path.includes(`/node_modules/${pkg}/`))) {
            return "codemirror";
          }
          return undefined;
        },
      },
    },
  },
  server: { port: 5199, strictPort: false },
});
