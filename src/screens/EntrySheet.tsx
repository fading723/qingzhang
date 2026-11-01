import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Transaction, TransactionKind } from '../domain/types';
import { saveTransaction } from '../domain/ledger';
import { formatMoney, makeId, parseMoney } from '../domain/money';
import { useLedger } from '../store/LedgerProvider';
import { useTheme } from '../ui/theme';
import { Button, Choice, Field, Hint, Icon, ModalSheet } from '../ui/components';
import { DateTimeField } from '../ui/DateTimeField';

export type EntryRequest = { transaction?: Transaction; copy?: boolean; refundOf?: Transaction };
export function EntrySheet({
  request,
  onClose,
}: {
  request: EntryRequest | null;
  onClose: () => void;
}) {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const lock = useRef(false);
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString());
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState('');
  useEffect(() => {
    if (!request) return;
    const t = request.transaction;
    const original = request.refundOf;
    const selectedKind = original ? 'refund' : t?.kind || 'expense';
    setKind(selectedKind);
    setAmount(t ? formatMoney(t.amountCents).replace(/,/g, '') : '');
    setAccountId(
      t?.accountId || original?.accountId || state.accounts.find((a) => !a.archived)?.id || '',
    );
    setToAccountId(t?.toAccountId || state.accounts.filter((a) => !a.archived)[1]?.id || '');
    setCategoryId(
      t?.categoryId ||
        original?.categoryId ||
        state.categories.find((c) => c.kind === selectedKind && !c.archived)?.id ||
        '',
    );
    setOccurredAt(t && !request.copy ? t.occurredAt : new Date().toISOString());
    setNote(t?.note || '');
    setTags(t?.tags.join('，') || '');
    setId(t && !request.copy ? t.id : makeId());
  }, [request]);
  const changeKind = (next: TransactionKind) => {
    setKind(next);
    setCategoryId(state.categories.find((c) => c.kind === next && !c.archived)?.id || '');
  };
  const save = async (again = false) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    try {
      const cents = parseMoney(amount, kind === 'adjustment');
      await mutate((current) =>
        saveTransaction(current, {
          id,
          kind,
          amountCents: cents,
          accountId,
          toAccountId: kind === 'transfer' ? toAccountId : null,
          categoryId: kind === 'transfer' || kind === 'adjustment' ? null : categoryId,
          refundOfId:
            kind === 'refund'
              ? request?.refundOf?.id || request?.transaction?.refundOfId || null
              : null,
          occurredAt,
          note: note.trim(),
          tags: [
            ...new Set(
              tags
                .split(/[,，\s#]+/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ],
          recurringOccurrenceId: request?.copy
            ? null
            : request?.transaction?.recurringOccurrenceId || null,
        }),
      );
      notify('这一笔，记好了');
      if (again) {
        setId(makeId());
        setAmount('');
        setNote('');
        setOccurredAt(new Date().toISOString());
      } else onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败，请重试', true);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const categories = state.categories
    .filter((c) => c.kind === kind && (!c.archived || c.id === categoryId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const accounts = state.accounts.filter(
    (a) => !a.archived || a.id === accountId || a.id === toAccountId,
  );
  const addKey = (key: string) => {
    if (key === '⌫') setAmount((v) => v.slice(0, -1));
    else
      setAmount((v) => {
        const next = v === '0' && key !== '.' ? key : v + key;
        return /^\d{0,10}(\.\d{0,2})?$/.test(next) ? (next === '.' ? '0.' : next) : v;
      });
  };
  return (
    <ModalSheet
      visible={!!request}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={
        request?.refundOf
          ? '记录退款'
          : request?.transaction && !request.copy
            ? '编辑账目'
            : request?.copy
              ? '再记一笔'
              : '记下这一笔'
      }
    >
      <View style={styles.wrap}>
        {kind === 'refund' || kind === 'adjustment' ? (
          <Choice label={kind === 'refund' ? '退款' : '余额调整'} active onPress={() => {}} />
        ) : (
          (['expense', 'income', 'transfer'] as const).map((k) => (
            <Choice
              key={k}
              label={{ expense: '支出', income: '收入', transfer: '转账' }[k]}
              active={kind === k}
              onPress={() => changeKind(k)}
            />
          ))
        )}
      </View>
      <View style={[styles.amountBox, { borderColor: colors.border }]}>
        <Text style={{ fontSize: 22, color: colors.muted }}>¥</Text>
        <TextInput
          accessibilityLabel="金额"
          placeholder="0.00"
          placeholderTextColor={colors.muted}
          keyboardType={kind === 'adjustment' ? 'numbers-and-punctuation' : 'decimal-pad'}
          value={amount}
          onChangeText={setAmount}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 38,
            fontWeight: '700',
            padding: 8,
            fontVariant: ['tabular-nums'],
          }}
        />
      </View>
      {request?.refundOf && (
        <Hint>
          原支出 ¥{formatMoney(request.refundOf.amountCents)}，退款计入所选时间对应的报表。
        </Hint>
      )}
      {(kind === 'expense' || kind === 'income') && (
        <View style={{ marginBottom: 18 }}>
          <Text style={[styles.label, { color: colors.muted }]}>分类</Text>
          <View style={styles.wrap}>
            {categories.map((c) => (
              <Choice
                key={c.id}
                label={
                  c.parentId
                    ? `${state.categories.find((p) => p.id === c.parentId)?.name} / ${c.name}`
                    : c.name
                }
                icon={c.icon}
                active={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
          </View>
        </View>
      )}
      <Text style={[styles.label, { color: colors.muted }]}>
        {kind === 'transfer' ? '转出账户' : kind === 'refund' ? '退款到账账户' : '账户'}
      </Text>
      <View style={[styles.wrap, { marginBottom: 18 }]}>
        {accounts.map((a) => (
          <Choice
            key={a.id}
            label={a.name}
            active={accountId === a.id}
            onPress={() => setAccountId(a.id)}
            icon={a.type === 'credit' ? 'card-outline' : 'wallet-outline'}
          />
        ))}
      </View>
      {kind === 'transfer' && (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>
            转入账户 · 信用卡还款也选择转账
          </Text>
          <View style={[styles.wrap, { marginBottom: 18 }]}>
            {accounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <Choice
                  key={a.id}
                  label={a.name}
                  active={toAccountId === a.id}
                  onPress={() => setToAccountId(a.id)}
                />
              ))}
          </View>
          <Hint>账户间转账不计入收入和支出。</Hint>
        </>
      )}
      <DateTimeField
        value={occurredAt}
        onChange={setOccurredAt}
        label={kind === 'expense' ? '消费时间' : '发生时间'}
      />
      <Field
        label="备注"
        placeholder="这一笔花在了哪里？"
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <Field
        label="标签"
        placeholder="例如：旅行，工作（用逗号分隔）"
        value={tags}
        onChangeText={setTags}
        maxLength={200}
      />
      <View style={styles.keypad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <Pressable
            key={k}
            accessibilityLabel={k === '⌫' ? '删除一位金额' : `输入${k}`}
            onPress={() => addKey(k)}
            style={({ pressed }) => [
              styles.key,
              { backgroundColor: pressed ? colors.primarySoft : colors.surfaceAlt },
            ]}
          >
            {k === '⌫' ? (
              <Icon name="backspace-outline" size={21} />
            ) : (
              <Text style={{ fontSize: 21, color: colors.text }}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <View style={{ flex: 1 }}>
          <Button label="保存账目" icon="checkmark" onPress={() => void save()} loading={saving} />
        </View>
        {!request?.transaction && !request?.refundOf && (
          <Button
            label="保存并再记"
            variant="secondary"
            onPress={() => void save(true)}
            disabled={saving}
          />
        )}
      </View>
    </ModalSheet>
  );
}
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingVertical: 15,
    marginBottom: 20,
  },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 9 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  key: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 43,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
