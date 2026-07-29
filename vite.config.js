import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // three.js is large; raise the warning limit so builds stay quiet
    chunkSizeWarningLimit: 1200,
  },
});
