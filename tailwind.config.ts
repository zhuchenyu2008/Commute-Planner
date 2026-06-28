import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f7f9fb",
        surface: "#f7f9fb",
        "surface-glass": "rgba(255, 255, 255, 0.7)",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f2f4f6",
        "surface-container": "#eceef0",
        "surface-container-high": "#e6e8ea",
        "surface-container-highest": "#e0e3e5",
        "on-background": "#191c1e",
        "on-surface": "#191c1e",
        "on-surface-variant": "#434655",
        primary: "#004ac6",
        "primary-container": "#2563eb",
        "on-primary": "#ffffff",
        "on-primary-container": "#eeefff",
        secondary: "#565e74",
        "secondary-container": "#dae2fd",
        "on-secondary-container": "#5c647a",
        tertiary: "#46566c",
        "tertiary-fixed": "#d3e4fe",
        outline: "#737686",
        "outline-variant": "#c3c6d7",
        "status-success": "#10B981",
        "status-warning": "#F59E0B",
        "status-error": "#EF4444",
        error: "#ba1a1a",
        "error-container": "#ffdad6"
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        xl: "1rem",
        "2xl": "1.5rem"
      },
      spacing: {
        "container-margin": "20px",
        gutter: "16px",
        "stack-sm": "4px",
        "stack-md": "12px",
        "stack-lg": "24px"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
