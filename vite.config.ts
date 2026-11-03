import { defineConfig, loadEnv } from "vite";
import { validateCollaborationPath } from "./src/lib/collaboration-url";
import { browserNotices } from "./scripts/browser-notices";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  validateCollaborationPath(
    loadEnv(mode, process.cwd(), "VITE_").VITE_COLLAB_PATH,
  );
  return {
    plugins: [react(), browserNotices()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: "http://127.0.0.1:4174", ws: true },
        "/collab": { target: "ws://127.0.0.1:4175", ws: true },
      },
    },
    build: { sourcemap: true },
  };
});
