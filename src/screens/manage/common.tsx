import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLedger } from '../../store/LedgerProvider';
import { useTheme } from '../../ui/theme';
import { Icon } from '../../ui/components';
import { Category, LedgerState } from '../../domain/types';

export function useTask() {
  const { notify } = useLedger();
  const running = useRef(false);
  const [working, setWorking] = useState(false);
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    try {
      await task();
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作未完成，请重试', true);
    } finally {
      running.current = false;
      setWorking(false);
    }
  };
  return { run, working };
}
export const editAmount = (cents: number) =>
  `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
export function Label({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: colors.muted,
        fontWeight: '600',
        fontSize: 12,
        marginBottom: 9,
        marginTop: 3,
      }}
    >
      {children}
    </Text>
  );
}
export function Choices({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 17 }}>
      {children}
    </View>
  );
}
export function ItemRow({
  icon,
  color,
  title,
  subtitle,
  right,
  onPress,
}: {
  icon: string;
  color?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={styles.item}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} color={color || colors.primary} size={21} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{title}</Text>
        {subtitle && (
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text>
        )}
      </View>
      {right}
      {onPress && <Icon name="chevron-forward" size={17} color={colors.muted} />}
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}
export function categoryName(state: LedgerState, category: Category) {
  const parent = state.categories.find((c) => c.id === category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}
export function activeCategories(state: LedgerState, kind: Category['kind']) {
  return state.categories
    .filter(
      (c) =>
        !c.archived &&
        c.kind === kind &&
        (!c.parentId || !state.categories.find((p) => p.id === c.parentId)?.archived),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  icon: { width: 43, height: 43, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});
