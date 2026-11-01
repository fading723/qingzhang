import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { formatMoney } from '../domain/money';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Ionicons accessible={false} name={name as IconName} size={size} color={color || colors.text} />
  );
}
export function Screen({
  title,
  eyebrow,
  subtitle,
  action,
  children,
  scroll = true,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const contents = (
    <>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {eyebrow && <Text style={[styles.eyebrow, { color: colors.muted }]}>{eyebrow}</Text>}
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          {subtitle && <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>}
        </View>
        {action}
      </View>
      {children}
      <View style={{ height: 24 }} />
    </>
  );
  return scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {contents}
    </ScrollView>
  ) : (
    <View style={[styles.screen, { flex: 1 }]}>{contents}</View>
  );
}
export function Card({
  children,
  style,
  tint = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tint ? colors.primarySoft : colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.primarySoft
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? variant === 'primary' && colors.primary === '#6BD2AA'
        ? '#103B2B'
        : '#FFFFFF'
      : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled || loading ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={18} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 7, marginBottom: 15 }}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          { backgroundColor: colors.surfaceAlt, color: colors.text, borderColor: colors.border },
          props.multiline && { minHeight: 80, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  );
}
export function Choice({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primarySoft : colors.surface,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} size={17} color={active ? colors.primary : colors.muted} />}
      <Text
        style={{
          color: active ? colors.primary : colors.muted,
          fontSize: 13,
          fontWeight: active ? '700' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          <Text style={{ color: colors.primary, fontSize: 12 }}>{action} ›</Text>
        </Pressable>
      )}
    </View>
  );
}
export function ModalSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="关闭弹窗"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              paddingBottom: Math.max(insets.bottom, 18),
              maxHeight: Platform.OS === 'web' ? '94%' : '92%',
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 21, fontWeight: '700', flex: 1 }}
            >
              {title}
            </Text>
            <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.close}>
              <Icon name="close" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 14 }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function EmptyState({
  icon = 'leaf-outline',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
      <Text
        style={{
          color: colors.muted,
          textAlign: 'center',
          lineHeight: 22,
          maxWidth: 280,
          fontSize: 13,
        }}
      >
        {description}
      </Text>
      {action}
    </View>
  );
}
export function Money({
  cents,
  size = 24,
  color,
  signed = false,
}: {
  cents: number;
  size?: number;
  color?: string;
  signed?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      numberOfLines={Platform.OS === 'web' ? undefined : 1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      style={{
        color: color || colors.text,
        fontSize: size,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        letterSpacing: -0.6,
        flexShrink: 1,
      }}
    >
      {signed && cents > 0 ? '+' : ''}
      {formatMoney(cents)}
    </Text>
  );
}
export function Hint({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20, marginVertical: 8 }}>
      {children}
    </Text>
  );
}
export function Confirm({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
  busy,
}: {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <ModalSheet visible={visible} onClose={onCancel} title={title}>
      <Hint>{message}</Hint>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <Button label="取消" onPress={onCancel} variant="secondary" />
        <Button label="确认" onPress={onConfirm} variant="danger" loading={busy} />
      </View>
    </ModalSheet>
  );
}
const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 24,
    paddingTop: 22,
    maxWidth: 1000,
    width: '100%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 26, gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 2, fontWeight: '600', marginBottom: 9 },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, marginTop: 7, lineHeight: 21 },
  card: { borderRadius: 23, padding: 20, borderWidth: 1, marginBottom: 14 },
  button: {
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 17,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  choice: {
    minHeight: 42,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 15,
    marginBottom: 15,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#062B245F',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: { width: '100%', maxWidth: 640, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handle: { width: 36, height: 4, borderRadius: 3, alignSelf: 'center', marginTop: 11 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 16,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 14, gap: 12 },
  emptyIcon: {
    height: 60,
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
});
