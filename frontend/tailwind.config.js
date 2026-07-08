/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Design tokens lifted from the OxyCost design system.
      colors: {
        bg: "#f4f6f7",
        surface: "#ffffff",
        "surface-alt": "#f0f3f4",
        line: { DEFAULT: "#e2e7ea", strong: "#cfd7db" },
        ink: { DEFAULT: "#233139", muted: "#6a7b83", faint: "#9aa8ae" },
        brand: {
          DEFAULT: "#0f7c8b",
          dark: "#0a5b66",
          mid: "#1597a8",
          light: "#e8f3f5",
        },
        gold: { DEFAULT: "#b08400", bg: "#fcf8ea", border: "#e3cf8f" },
        danger: { DEFAULT: "#a52c2c", bg: "#fbeded", border: "#e6b0b0" },
        warn: { DEFAULT: "#8a5512", bg: "#fbf2e6", border: "#e6c79a" },
        good: { bg: "#eaf6ee", border: "#2f9e44", text: "#1f7a32" },
        info: { bg: "#eef4f6" },
      },
      fontFamily: {
        sans: ['"Trebuchet MS"', '"Segoe UI"', "Tahoma", "sans-serif"],
        mono: ['"Cascadia Code"', "Consolas", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
        sm: "5px",
        lg: "12px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(35, 49, 57, .05)",
        pop: "0 4px 18px rgba(35, 49, 57, .12)",
      },
    },
  },
  plugins: [],
};
