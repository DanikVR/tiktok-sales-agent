/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Light/Dark mode через class selector
  darkMode: 'class',
  theme: {
    extend: {
      // ============================================================
      // ТИПОГРАФИКА
      // Space Grotesk — заголовки (футуристичный AI вайб)
      // Inter        — основной текст (читаемость)
      // ============================================================
      fontFamily: {
        sans:     ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display:  ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },

      // ============================================================
      // ЦВЕТОВАЯ ПАЛИТРА: ABYSS AURORA
      // ============================================================
      colors: {
        // --- Фоны (Dark Mode) ---
        abyss: {
          950: '#000000',   // Основной фон — чисто чёрный
          900: '#09090B',   // Карточки — угольный
          800: '#18181B',   // Поднятые поверхности
          700: '#27272A',   // Hover / elevated
          600: '#3F3F46',   // Модалки / sheets
          500: '#52525B',   // Бордеры / разделители
        },

        // --- Фоны (Light Mode) ---
        cloud: {
          50:  '#FAFAFA',   // Основной фон light
          100: '#F4F4F5',   // Карточки
          200: '#E4E4E7',   // Поднятые элементы
          300: '#D4D4D8',   // Бордеры light
          400: '#A1A1AA',   // Вторичные бордеры
        },

        // --- Акценты: Carbon & Silver (серебро и углерод) ---
        aurora: {
          50:  '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
          400: '#A1A1AA',
          500: '#71717A',   // PRIMARY — серебристый серый
          600: '#52525B',
          700: '#3F3F46',
          800: '#27272A',
          900: '#18181B',
          950: '#09090B',
        },

        // Sky Blue / Slate Gray
        cyan: {
          400: '#A1A1AA',
          500: '#71717A',
        },

        // Rose / Danger
        magenta: {
          400: '#F87171',
          500: '#EF4444',
        },

        // Success / Online
        jade: {
          400: '#34D399',
          500: '#10B981',
        },

        // Warning
        amber: {
          400: '#FBBF24',
          500: '#F59E0B',
        },

        // ============================================================
        // АКЦЕНТ VIBEVOX — тёплый оранжевый. ТОЛЬКО для новых публичных
        // страниц. Аддитивно: существующие страницы их не используют.
        // ============================================================
        neon: {
          orange: '#ff7300',   // основной бренд-акцент
          ember:  '#ff4d00',   // глубокий (для градиентной глубины)
          amber:  '#ffb547',   // тёплый светлый
          glow:   '#ff8a2b',   // свечение
          gold:   '#f5c24b',   // акцент-золото
        },
      },

      // ============================================================
      // ГРАДИЕНТЫ
      // ============================================================
      backgroundImage: {
        // Основной фон приложения (dark)
        'abyss-gradient':   'radial-gradient(ellipse at top, #121214 0%, #000000 75%)',
        // Фон light mode
        'cloud-gradient':   'radial-gradient(ellipse at top, #F4F4F5 0%, #FAFAFA 75%)',
        // Carbon & Silver accent gradient (CTA кнопки, FAB, highlights)
        'aurora-gradient':  'linear-gradient(135deg, #FFFFFF 0%, #A1A1AA 100%)',
        // Warm (danger, special)
        'warm-gradient':    'linear-gradient(135deg, #E4E4E7 0%, #27272A 100%)',
        // Glow halo вокруг активных элементов
        'aurora-glow':      'radial-gradient(ellipse at center, rgba(255,255,255,0.08) 0%, transparent 65%)',
        // Scrim — затемнение для текста поверх видео (снизу)
        'scrim-bottom':     'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 45%, transparent 100%)',
        // Scrim сверху
        'scrim-top':        'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.20) 50%, transparent 100%)',
        // Subtle card gradient
        'card-gradient':    'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
        // Light card
        'card-light':       'linear-gradient(145deg, rgba(9,9,11,0.02) 0%, rgba(255,255,255,0.9) 100%)',
      },

      // ============================================================
      // ТЕНИ
      // ============================================================
      boxShadow: {
        // Стеклянные тени
        'glass-sm':   '0 4px 16px rgba(0,0,0,0.4)',
        'glass-md':   '0 8px 32px rgba(0,0,0,0.5)',
        'glass-lg':   '0 16px 48px rgba(0,0,0,0.6)',
        // Aurora glow (grayscale)
        'aurora-sm':  '0 0 16px rgba(255,255,255,0.06)',
        'aurora-md':  '0 0 32px rgba(255,255,255,0.08), 0 0 64px rgba(255,255,255,0.03)',
        'aurora-lg':  '0 0 48px rgba(255,255,255,0.10), 0 0 96px rgba(255,255,255,0.04)',
        // Cyan glow -> Gray glow
        'cyan-glow':  '0 0 24px rgba(255,255,255,0.06)',
        // Card lift (light mode)
        'card-lift':  '0 4px 24px rgba(0,0,0,0.03), 0 1px 4px rgba(0,0,0,0.02)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.03)',
        // Bottom tab bar
        'tab-bar':    '0 -1px 0 rgba(255,255,255,0.04), 0 -8px 32px rgba(0,0,0,0.4)',
        'tab-bar-light': '0 -1px 0 rgba(9,9,11,0.04), 0 -4px 24px rgba(0,0,0,0.02)',
        // Текст поверх видео
        'text-scrim': '0 2px 4px rgba(0,0,0,0.8)',
      },

      // ============================================================
      // АНИМАЦИИ
      // ============================================================
      animation: {
        'fade-in':       'fadeIn 0.3s ease-out',
        'slide-up':      'slideUp 0.4s cubic-bezier(0.34,1.56,0.64,1)',
        'scale-in':      'scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        'pulse-ring':    'pulseRing 2s ease-in-out infinite',
        'shimmer':       'shimmer 1.8s linear infinite',
        'aurora-drift':  'auroraDrift 8s ease-in-out infinite',
        'float':         'float 6s ease-in-out infinite',
        'glow-pulse':    'glowPulse 3s ease-in-out infinite',
        'tab-bounce':    'tabBounce 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%':   { opacity: '0', transform: 'scale(0.88)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseRing: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(139,92,246,0.4)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(139,92,246,0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        auroraDrift: {
          '0%, 100%': { opacity: '0.6', transform: 'translateY(0px) scale(1)' },
          '50%':      { opacity: '1',   transform: 'translateY(-8px) scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 16px rgba(139,92,246,0.15)' },
          '50%':      { boxShadow: '0 0 40px rgba(139,92,246,0.35)' },
        },
        tabBounce: {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
      },

      // ============================================================
      // СКРУГЛЕНИЯ
      // ============================================================
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },

      // ============================================================
      // РАЗМЫТИЕ
      // ============================================================
      backdropBlur: {
        xs: '2px',
        '2xs': '1px',
      },

      // ============================================================
      // SPACING дополнения
      // ============================================================
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },

      // ============================================================
      // Высота bottom tab bar (с учётом safe area)
      // ============================================================
      height: {
        'tab-bar': '64px',
        'screen-safe': 'calc(100dvh - 64px)',
      },
    },
  },
  plugins: [],
};
