import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /footballgame/.
// __BUILD__: when this build was made (UTC, "MM-DD HH:MM"), shown on the title screen.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')) },
});
