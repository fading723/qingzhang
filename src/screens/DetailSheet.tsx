import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Transaction } from '../domain/types';
import { deleteTransaction } from '../domain/ledger';
import { formatMoney } from '../domain/money';
import { localDateTime } from '../domain/time';
import { useLedger } from '../store/LedgerProvider';
import { Button, Hint, ModalSheet, Money } from '../ui/components';
import { kindLabels } from '../ui/TransactionRow';
import { useTheme } from '../ui/theme';
import type { EntryRequest } from './EntrySheet';

export function DetailSheet({
  transaction,
  onClose,
  onEdit,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onEdit: (request: EntryRequest) => void;
}) {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = transaction
    ? state.transactions.find((item) => item.id === transaction.id) || null
    : null;
  const remove = async () => {
    if (!t || busy) return;
    setBusy(true);
    try {
      await mutate((s) => deleteTransaction(s, t.id));
      setConfirm(false);
      onClose();
      notify('账目已删除，余额和报表已更新');
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setConfirm(false);
    onClose();
  };
  const edit = (request: EntryRequest) => {
    close();
    setTimeout(() => onEdit(request), 300);
  };
  const refunded = t
    ? state.transactions
        .filter((r) => r.refundOfId === t.id)
        .reduce((sum, r) => sum + r.amountCents, 0)
    : 0;
  const fields = t
    ? [
        ['发生时间', localDateTime(t.occurredAt).replace('T', ' ') + '（北京时间）'],
        ['分类', state.categories.find((c) => c.id === t.categoryId)?.name || '不计入收支分类'],
        ['账户', state.accounts.find((a) => a.id === t.accountId)?.name || ''],
        ...(t.toAccountId
          ? [['转入账户', state.accounts.find((a) => a.id === t.toAccountId)?.name || '']]
          : []),
        ['备注', t.note || '未填写'],
        ['标签', t.tags.length ? t.tags.map((tag) => '#' + tag).join('  ') : '未添加'],
        ['录入时间', localDateTime(t.createdAt).replace('T', ' ')],
        ...(refunded ? [['已退金额', '¥' + formatMoney(refunded)]] : []),
      ]
    : [];
  return (
    <ModalSheet visible={!!t} onClose={close} title="账目详情">
      {t && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{kindLabels[t.kind]}</Text>
            <Money
              cents={t.kind === 'expense' ? -t.amountCents : t.amountCents}
              size={40}
              color={t.kind === 'expense' ? colors.expense : colors.primary}
              signed={t.kind === 'income' || t.kind === 'refund'}
            />
          </View>
          {fields.map(([key, value]) => (
            <View
              key={key}
              style={{
                flexDirection: 'row',
                gap: 20,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 12, width: 66 }}>{key}</Text>
              <Text
                selectable
                style={{ flex: 1, color: colors.text, fontSize: 13, lineHeight: 20 }}
              >
                {value}
              </Text>
            </View>
          ))}
          {confirm ? (
            <View style={{ marginTop: 18 }}>
              <Hint>确定删除这笔账目？账户余额和统计会随之更新，删除后无法撤销。</Hint>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button label="保留账目" variant="secondary" onPress={() => setConfirm(false)} />
                <Button
                  label="确认删除"
                  variant="danger"
                  loading={busy}
                  onPress={() => void remove()}
                />
              </View>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
                <Button
                  label="编辑"
                  icon="create-outline"
                  onPress={() => edit({ transaction: t })}
                />
                {t.kind !== 'refund' && t.kind !== 'adjustment' && (
                  <Button
                    label="再记一笔"
                    icon="copy-outline"
                    variant="secondary"
                    onPress={() => edit({ transaction: t, copy: true })}
                  />
                )}
                {t.kind === 'expense' && refunded < t.amountCents && (
                  <Button
                    label="记录退款"
                    variant="secondary"
                    onPress={() => edit({ refundOf: t })}
                  />
                )}
              </View>
              <View style={{ alignItems: 'center', marginTop: 12 }}>
                <Button label="删除这笔账" variant="ghost" onPress={() => setConfirm(true)} />
              </View>
            </>
          )}
        </>
      )}
    </ModalSheet>
  );
}
