import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solid(), tailwindcss()],

  optimizeDeps: {
    exclude: ["@squidlab/phosphor-solid"],
  },

  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? { protocol: "ws", host, port: 1431 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
