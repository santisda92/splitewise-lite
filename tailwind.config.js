/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',          // << add this line
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
