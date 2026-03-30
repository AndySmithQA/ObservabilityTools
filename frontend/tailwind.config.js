/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#0c0f14", raised: "#131820", border: "#1e2836" },
        accent: { DEFAULT: "#3b82f6", muted: "#60a5fa" },
        danger: "#f43f5e",
        ok: "#34d399",
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
