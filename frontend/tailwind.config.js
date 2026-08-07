/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Bloomberg terminal dark theme
        bg: {
          primary: '#0a0f1a',
          secondary: '#111827',
          tertiary: '#1f2937',
        },
        border: {
          primary: '#1f2937',
          secondary: '#374151',
        },
        text: {
          primary: '#f9fafb',
          secondary: '#d1d5db',
          muted: '#9ca3af',
        },
        accent: {
          gold: '#d4a843',
          goldHover: '#e5b85a',
          goldLight: '#fef3c7',
        },
        success: {
          primary: '#10b981',
          light: '#d1fae5',
        },
        error: {
          primary: '#ef4444',
          light: '#fee2e2',
        },
        warning: {
          primary: '#f59e0b',
          light: '#fef3c7',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}