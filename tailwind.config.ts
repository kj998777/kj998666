import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 메딕차트 브랜드 톤에 맞춰 기본 slate(차가운 파란회색)를 stone 계열의
        // 따뜻한 회색으로 교체한다 — 컴포넌트 코드는 그대로 slate-* 클래스를 쓰지만
        // 실제 렌더링되는 색만 따뜻하게 바뀐다(파일 하나하나 고칠 필요 없음).
        slate: {
          50: "#faf9f7",
          100: "#f2efec",
          200: "#e6e1db",
          300: "#d3ccc3",
          400: "#a89f93",
          500: "#7c7268",
          600: "#5c5349",
          700: "#453e36",
          800: "#2c2723",
          900: "#1b1815",
          950: "#0e0c0a",
        },
        // 로고의 붉은 십자(+) 톤 — 브랜드 강조색(brick red). 버튼 등 기본 색은 계속
        // ink-black(slate) 계열을 쓰고, brand는 포인트로만 쓴다.
        brand: {
          50: "#fdf3f1",
          100: "#fbe3de",
          200: "#f4c3b8",
          300: "#e89c8a",
          400: "#d66d54",
          500: "#bf4b30",
          600: "#a13a24",
          700: "#832f1d",
          800: "#6a2718",
          900: "#582214",
        },
      },
    },
  },
  plugins: [],
};

export default config;
