/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        poker: {
          green: '#073b1e',
          felt: '#0c5c2e'
        }
      }
    },
  },
  plugins: [],
}