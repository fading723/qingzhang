import { useColorScheme } from 'react-native';
import { useLedger } from '../store/LedgerProvider';
export const light = {
  bg: '#F4F7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF3F0',
  text: '#183C34',
  muted: '#7B8F87',
  border: '#E4ECE7',
  primary: '#16846B',
  primarySoft: '#E4F3EC',
  income: '#16846B',
  expense: '#CE7952',
  danger: '#C45050',
  navy: '#173F35',
  white: '#FFFFFF',
};
export type Palette = typeof light;
export const dark: Palette = {
  bg: '#101D19',
  surface: '#1A2C25',
  surfaceAlt: '#22382E',
  text: '#E6F2EB',
  muted: '#9BB3A5',
  border: '#2D4438',
  primary: '#6BD2AA',
  primarySoft: '#234C3B',
  income: '#6BD2AA',
  expense: '#F0AA81',
  danger: '#F09393',
  navy: '#244B3D',
  white: '#FFFFFF',
};
export function useTheme() {
  const { state } = useLedger();
  const system = useColorScheme();
  const isDark =
    state.settings.theme === 'dark' || (state.settings.theme === 'system' && system === 'dark');
  return { colors: isDark ? dark : light, isDark };
}
