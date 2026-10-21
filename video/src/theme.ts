import { loadFont as loadBricolage } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

// Same faces as the app: Bricolage Grotesque for display, Inter for text.
export const display = loadBricolage('normal', { weights: ['600', '700', '800'], subsets: ['latin', 'latin-ext'] }).fontFamily;
export const text = loadInter('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin', 'latin-ext'] }).fontFamily;

// The app's dark theme, converted from its oklch tokens to sRGB hex.
export const color = {
  bg: '#110e0c',
  surface: '#1f1b18',
  border: '#36302b',
  text: '#f4efe9',
  secondary: '#c4bab0',
  tertiary: '#a39a90',
  accent: '#f4a23b',
  onAccent: '#2b1704',
  stage: {
    todo: '#a7a097',
    learning: '#79a7f2',
    shaky: '#ebd25f',
    ready: '#5fca8b',
  },
};

export const ease = [0.16, 1, 0.3, 1] as const;
