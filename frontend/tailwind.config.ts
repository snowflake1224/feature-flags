import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(240 6% 90%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(240 10% 4%)",
        muted: "hsl(240 5% 96%)",
        "muted-foreground": "hsl(240 4% 46%)",
        primary: "hsl(243 75% 59%)",
        "primary-foreground": "hsl(0 0% 100%)",
      },
      borderRadius: {
        lg: "0.6rem",
      },
    },
  },
  plugins: [],
};

export default config;
