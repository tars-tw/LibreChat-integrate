import { IThemeRGB } from '../types';

/**
 * Dark theme
 * RGB values extracted from the existing dark mode CSS variables
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '236 236 236', // #ececec (gray-100)
  'rgb-text-secondary': '205 205 205', // #cdcdcd (gray-300)
  'rgb-text-secondary-alt': '153 150 150', // #999696 (gray-400)
  'rgb-text-tertiary': '153 150 150', // #999696 (gray-400)
  'rgb-text-warning': '245 158 11', // #f59e0b (amber-500)
  'rgb-text-destructive': '248 113 113', // #f87171 (red-400)
  'rgb-shimmer-base': '255 255 255', // #ffffff, carried at 0.8 alpha
  'rgb-shimmer-dip': '179 179 179', // #b3b3b3

  // Link and accent colors
  'rgb-link': '96 165 250', // #60a5fa (blue-400)
  'rgb-link-hover': '147 197 253', // #93c5fd (blue-300)
  'rgb-link-visited': '192 132 252', // #c084fc (purple-400)
  'rgb-accent-primary': '254 124 57', // #fe7c39 (pwc-orange-400)
  'rgb-accent-primary-hover': '255 170 114', // #ffaa72 (pwc-orange-300)

  // Ring colors (not defined in dark mode, using default)
  'rgb-ring-primary': '253 81 8', // #fd5108 (pwc-orange-500)

  // Header colors
  'rgb-header-primary': '47 47 47', // #2f2f2f (gray-700)
  'rgb-header-hover': '66 66 66', // #424242 (gray-600)
  'rgb-header-button-hover': '47 47 47', // #2f2f2f (gray-700)

  // Surface colors
  'rgb-surface-active': '89 89 89', // #595959 (gray-500)
  'rgb-surface-active-alt': '47 47 47', // #2f2f2f (gray-700)
  'rgb-surface-hover': '57 57 57', // #393939 (gray-650)
  'rgb-surface-hover-alt': '66 66 66', // #424242 (gray-600)
  'rgb-surface-composer-hover': '66 66 66', // #424242 (gray-600)
  'rgb-surface-primary': '13 13 13', // #0d0d0d (gray-900)
  'rgb-surface-primary-alt': '23 23 23', // #171717 (gray-850)
  'rgb-surface-primary-contrast': '23 23 23', // #171717 (gray-850)
  'rgb-surface-secondary': '33 33 33', // #212121 (gray-800)
  'rgb-surface-secondary-alt': '33 33 33', // #212121 (gray-800)
  'rgb-surface-tertiary': '47 47 47', // #2f2f2f (gray-700)
  'rgb-surface-tertiary-alt': '47 47 47', // #2f2f2f (gray-700)
  'rgb-surface-dialog': '18 18 18', // #121212 (legacy dark dialog)
  'rgb-surface-overlay': '0 0 0', // #000 (black)
  'rgb-surface-submit': '253 81 8', // #fd5108 (pwc-orange-500)
  'rgb-surface-submit-hover': '224 71 5', // #e04705 (pwc-orange-600)
  'rgb-surface-destructive': '153 27 27', // #991b1b (red-800)
  'rgb-surface-destructive-hover': '127 29 29', // #7f1d1d (red-900)
  'rgb-surface-chat': '47 47 47', // #2f2f2f (gray-700)
  'rgb-surface-inverted': '255 255 255', // #fff (white)
  'rgb-surface-inverted-hover': '236 236 236', // #ececec (gray-100)
  'rgb-text-inverted': '23 23 23', // #171717 (gray-850)
  'rgb-surface-fixed': '255 255 255', // #fff (white) — same in light + dark
  'rgb-surface-fixed-hover': '236 236 236', // #ececec (gray-100) — same in light + dark
  'rgb-text-fixed': '33 33 33', // #212121 (gray-800) — same in light + dark

  // Border colors
  'rgb-border-light': '47 47 47', // #2f2f2f (gray-700)
  'rgb-border-medium': '66 66 66', // #424242 (gray-600)
  'rgb-border-medium-alt': '66 66 66', // #424242 (gray-600)
  'rgb-border-heavy': '89 89 89', // #595959 (gray-500)
  'rgb-border-xheavy': '153 150 150', // #999696 (gray-400)
  'rgb-border-destructive': '239 68 68', // #ef4444 (red-500)

  // Status colors
  'rgb-status-success': '110 231 183', // #6ee7b7 (green-300)
  'rgb-status-success-subtle': '2 44 34', // #022c22 (green-950)
  'rgb-status-success-border': '6 95 70', // #065f46 (green-800)
  'rgb-status-success-strong': '6 95 70', // #065f46 (green-800)
  'rgb-status-info': '147 197 253', // #93c5fd (blue-300)
  'rgb-status-info-subtle': '23 37 84', // #172554 (blue-950)
  'rgb-status-info-border': '30 64 175', // #1e40af (blue-800)
  'rgb-status-info-strong': '66 66 66', // #424242 (gray-600)
  'rgb-status-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-subtle': '69 26 3', // #451a03 (amber-950)
  'rgb-status-warning-border': '146 64 14', // #92400e (amber-800)
  'rgb-status-warning-strong': '146 64 14', // #92400e (amber-800)
  'rgb-status-error': '252 165 165', // #fca5a5 (red-300)
  'rgb-status-error-subtle': '69 10 10', // #450a0a (red-950)
  'rgb-status-error-border': '153 27 27', // #991b1b (red-800)
  'rgb-status-error-strong': '153 27 27', // #991b1b (red-800)
  'rgb-status-neutral': '205 205 205', // #cdcdcd (gray-300)
  'rgb-status-neutral-subtle': '33 33 33', // #212121 (gray-800)
  'rgb-status-neutral-border': '47 47 47', // #2f2f2f (gray-700)
  'rgb-text-on-status': '255 255 255', // #fff (white)

  // Brand colors
  'rgb-brand-purple': '254 124 57', // #fe7c39 (pwc-orange-400)

  /** Categorical series scale — the same seven hues in the same slot order as
   *  the light theme, stepped for the #212121 surface. Slot order is shared so
   *  a category keeps its hue when the theme flips; solving each theme's order
   *  independently buys ~2 ΔE of adjacent headroom and costs the reader the
   *  colour they had just learned, which is the worse trade.
   *
   *  The dark track is forgiving enough that both brand colours land on their
   *  own token values: orange-400 in slot 1, the true PwC gold in slot 3.
   *  Worst adjacent CVD ΔE 19.0, normal-vision ΔE 39.7, floor 3.42. */
  'rgb-series-1': '254 124 57', // #fe7c39 (pwc-orange-400)
  'rgb-series-2': '9 140 238', // #098cee (cerulean)
  'rgb-series-3': '233 176 31', // #e9b01f (pwc gold)
  'rgb-series-4': '6 158 152', // #069e98 (aqua)
  'rgb-series-5': '171 104 254', // #ab68fe (violet)
  'rgb-series-6': '80 167 49', // #50a731 (green)
  'rgb-series-7': '213 82 130', // #d55282 (magenta)

  // Presentation
  'rgb-presentation': '33 33 33', // #212121 (gray-800)
};
