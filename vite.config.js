import { resolve } from "node:path";
import { defineConfig } from "vite";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

function chromeExtension() {
  return {
    name: "chrome-extension",
    writeBundle() {
      const dist = resolve(__dirname, "dist");

      // Copy manifest
      const manifest = JSON.parse(
        readFileSync(resolve(__dirname, "manifest.json"), "utf-8"),
      );
      // Rewrite paths for dist layout
      manifest.background = { service_worker: "background.js" };
      manifest.content_scripts[0].js = ["bridge.js"];
      manifest.content_scripts[1].js = ["intercept.js"];
      manifest.action.default_icon = {
        16: "icon.png",
        48: "icon.png",
        128: "icon.png",
      };
      manifest.icons = { 16: "icon.png", 48: "icon.png", 128: "icon.png" };
      writeFileSync(
        resolve(dist, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      // Copy static assets
      copyFileSync(
        resolve(__dirname, "src/icon.png"),
        resolve(dist, "icon.png"),
      );
      mkdirSync(resolve(dist, "vendor"), { recursive: true });
      cpSync(
        resolve(__dirname, "public/vendor"),
        resolve(dist, "vendor"),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  plugins: [chromeExtension()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        background: resolve(__dirname, "src/background.js"),
        intercept: resolve(__dirname, "src/intercept.js"),
        bridge: resolve(__dirname, "src/bridge.js"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
