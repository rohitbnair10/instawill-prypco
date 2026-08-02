import type { Config } from "tailwindcss";

/**
 * Palette is the fallback direction from the InstaWill brief.
 * PRYPCO's live brand tokens could not be fetched (site returns 403 to bots),
 * so these are the documented fallbacks: deep ink navy, warm paper/parchment,
 * sage (done), clay/terracotta (block), amber (warn), slate (secondary).
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1A2436",
          soft: "#2C3A52",
        },
        paper: {
          DEFAULT: "#F3EFE7",
          deep: "#EAE4D7",
          parchment: "#FBF9F4",
        },
        sage: "#5B8A72",
        clay: "#B06A4F",
        amber: "#C08A2E",
        slate: "#5C6B7E",
        hairline: "#D9D2C4",
      },
      fontFamily: {
        // Editorial serif for the will document + headings; clean sans for UI.
        serif: ["Georgia", "Cambria", "'Times New Roman'", "serif"],
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "'Segoe UI'",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(26,36,54,0.04), 0 8px 24px rgba(26,36,54,0.06)",
        rail: "inset -1px 0 0 rgba(255,255,255,0.04)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};

export default config;
