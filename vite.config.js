import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/graphbin-visualise-wasm/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"]
  }
});
