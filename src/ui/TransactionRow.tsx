import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Transaction } from '../domain/types';
import { localDateTime } from '../domain/time';
import { useLedger } from '../store/LedgerProvider';
import { useTheme } from './theme';
import { Icon, Money } from './components';

export const kindLabels = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  refund: '退款',
  adjustment: '余额调整',
};
export function TransactionRow({
  transaction: t,
  onPress,
  fullDate = false,
}: {
  transaction: Transaction;
  onPress: () => void;
  fullDate?: boolean;
}) {
  const { state } = useLedger();
  const { colors } = useTheme();
  const category = state.categories.find((c) => c.id === t.categoryId);
  const account = state.accounts.find((a) => a.id === t.accountId);
  const to = state.accounts.find((a) => a.id === t.toAccountId);
  const expense = t.kind === 'expense';
  const positive = t.kind === 'income' || t.kind === 'refund';
  const color = expense ? colors.expense : positive ? colors.income : colors.muted;
  const label =
    t.kind === 'transfer'
      ? `${account?.name || '账户'} → ${to?.name || '账户'}`
      : t.kind === 'adjustment'
        ? '余额调整'
        : category?.name || kindLabels[t.kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${kindLabels[t.kind]} ${(t.amountCents / 100).toFixed(2)}元`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingVertical: 15,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={
            t.kind === 'transfer'
              ? 'swap-horizontal-outline'
              : t.kind === 'adjustment'
                ? 'options-outline'
                : category?.icon || 'receipt-outline'
          }
          size={21}
          color={category?.color || colors.primary}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
          {label}
          {t.kind === 'refund' ? ' · 退款' : ''}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
          {fullDate
            ? localDateTime(t.occurredAt).replace('T', ' ')
            : localDateTime(t.occurredAt).slice(11)}{' '}
          · {t.note || account?.name || '已停用账户'}
          {t.tags.length ? ` · #${t.tags[0]}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Money
          cents={expense ? -t.amountCents : t.amountCents}
          size={16}
          color={color}
          signed={positive}
        />
        <Text style={{ fontSize: 10, color: colors.muted }}>{kindLabels[t.kind]}</Text>
      </View>
    </Pressable>
  );
}
