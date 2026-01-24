import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out forwards",
        "fade-in": "fade-in 0.4s ease-out forwards",
        "scale-in": "scale-in 0.4s ease-out forwards",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "float-slow": "float-slow 8s ease-in-out infinite",
        "shimmer": "shimmer 2s infinite",
        pulse: "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        blob: "blob 7s infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        "gradient-shift": "gradient-shift 8s ease infinite",
      },
      keyframes: {
        "fade-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(12px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": {
            opacity: "0",
            transform: "scale(0.95)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1)",
          },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.02)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0) translateX(0)" },
          "25%": { transform: "translateY(-10px) translateX(5px)" },
          "50%": { transform: "translateY(-5px) translateX(-5px)" },
          "75%": { transform: "translateY(-15px) translateX(3px)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        blob: {
          "0%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(30px, -50px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
          "100%": { transform: "translate(0px, 0px) scale(1)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      backgroundImage: {
        "grid-dark":
          "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32' fill='none' stroke='rgb(255 255 255 / 0.02)'%3e%3cpath d='M0 .5H31.5V32'/%3e%3c/svg%3e\")",
        "dots-cyan":
          "radial-gradient(circle, rgba(6, 182, 212, 0.15) 1px, transparent 1px)",
        "gradient-radial-cyan":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(6, 182, 212, 0.15), transparent)",
        "gradient-radial-violet":
          "radial-gradient(ellipse 60% 40% at 80% 100%, rgba(139, 92, 246, 0.1), transparent)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        // Dark Command Center theme colors
        "bg-deepest": "#09090b",
        "bg-surface": "#121218",
        "bg-elevated": "#18181b",
        // Electric Cyan accent system
        "accent-cyan": "#06b6d4",
        "accent-cyan-bright": "#22d3ee",
        "accent-cyan-dim": "#0891b2",
        "accent-violet": "#8b5cf6",
        "accent-violet-bright": "#a78bfa",
        // Status indicators
        status: {
          success: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          info: "#06b6d4",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "0.875rem",
        "2xl": "1rem",
      },
      boxShadow: {
        "glow-cyan": "0 0 20px rgba(6, 182, 212, 0.3)",
        "glow-cyan-lg": "0 0 40px rgba(6, 182, 212, 0.4)",
        "glow-cyan-intense": "0 0 60px rgba(6, 182, 212, 0.5), 0 0 120px rgba(6, 182, 212, 0.2)",
        "glow-violet": "0 0 20px rgba(139, 92, 246, 0.3)",
        "glow-violet-lg": "0 0 40px rgba(139, 92, 246, 0.4)",
        "glow-success": "0 0 20px rgba(16, 185, 129, 0.2)",
        "glow-warning": "0 0 20px rgba(245, 158, 11, 0.2)",
        "glow-error": "0 0 20px rgba(239, 68, 68, 0.2)",
        "card-hover": "0 20px 40px rgba(0, 0, 0, 0.15), 0 0 40px rgba(6, 182, 212, 0.15)",
        "inner-glow": "inset 0 0 20px rgba(6, 182, 212, 0.1)",
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      backgroundSize: {
        "dots": "24px 24px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
