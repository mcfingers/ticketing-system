import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local (non-Docker) dev, proxy /api to a backend on localhost:3000.
// In production the nginx container handles this instead.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
