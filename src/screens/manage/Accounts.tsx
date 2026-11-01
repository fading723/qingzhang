import React, { useState } from 'react';
import { View } from 'react-native';
import { Account, AccountType } from '../../domain/types';
import { balances, saveAccount, saveTransaction } from '../../domain/ledger';
import { makeId, parseMoney } from '../../domain/money';
import { useLedger } from '../../store/LedgerProvider';
import {
  Button,
  Card,
  Choice,
  Confirm,
  EmptyState,
  Field,
  Hint,
  ModalSheet,
  Money,
  SectionTitle,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { Choices, editAmount, ItemRow, Label, useTask } from './common';

const types: Array<{ value: AccountType; name: string; icon: string }> = [
  { value: 'cash', name: '现金', icon: 'cash-outline' },
  { value: 'bank', name: '银行卡', icon: 'card-outline' },
  { value: 'wechat', name: '微信', icon: 'chatbubble-ellipses-outline' },
  { value: 'alipay', name: '支付宝', icon: 'wallet-outline' },
  { value: 'credit', name: '信用卡', icon: 'card-outline' },
  { value: 'other', name: '其他', icon: 'layers-outline' },
];
export function Accounts() {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { run, working } = useTask();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [opening, setOpening] = useState('0.00');
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [target, setTarget] = useState('');
  const [archive, setArchive] = useState<Account | null>(null);
  const values = balances(state);
  const net = Object.values(values).reduce((total, value) => total + value, 0);
  const begin = (account?: Account) => {
    setEditing(account || null);
    setName(account?.name || '');
    setType(account?.type || 'cash');
    setOpening(editAmount(account?.openingBalanceCents || 0));
    setOpen(true);
  };
  const save = () =>
    run(async () => {
      const account: Account = {
        id: editing?.id || makeId(),
        name: name.trim(),
        type,
        openingBalanceCents: editing?.openingBalanceCents ?? parseMoney(opening, true),
        archived: editing?.archived || false,
        createdAt: editing?.createdAt || new Date().toISOString(),
      };
      await mutate((s) => saveAccount(s, account));
      setOpen(false);
      notify(editing ? '账户已更新' : '账户已添加');
    });
  const adjust = () =>
    run(async () => {
      if (!adjusting) return;
      const amount = parseMoney(target, true);
      const id = makeId();
      await mutate((s) => {
        const difference = amount - balances(s)[adjusting.id];
        if (difference === 0) throw new Error('目标余额与当前余额相同，无需调整');
        return saveTransaction(s, {
          id,
          kind: 'adjustment',
          amountCents: difference,
          accountId: adjusting.id,
          toAccountId: null,
          categoryId: null,
          refundOfId: null,
          occurredAt: new Date().toISOString(),
          note: '余额校准',
          tags: [],
          recurringOccurrenceId: null,
        });
      });
      setAdjusting(null);
      notify('余额已校准，不计入收支');
    });
  return (
    <>
      <Card tint>
        <Label>净资产 · 人民币</Label>
        <Money cents={net} size={32} />
        <Hint>已包含所有账户余额，信用卡欠款会抵减净资产。</Hint>
      </Card>
      <SectionTitle title="我的账户" action="添加账户" onAction={() => begin()} />
      <Choices>
        <Choice label="使用中" active={!showArchived} onPress={() => setShowArchived(false)} />
        <Choice label="已停用" active={showArchived} onPress={() => setShowArchived(true)} />
      </Choices>
      {state.accounts
        .filter((a) => a.archived === showArchived)
        .map((account) => {
          const info = types.find((t) => t.value === account.type)!;
          const value = values[account.id];
          return (
            <Card key={account.id}>
              <ItemRow
                icon={info.icon}
                title={account.name}
                subtitle={account.type === 'credit' && value < 0 ? '信用卡 · 待还金额' : info.name}
                right={
                  <Money
                    cents={account.type === 'credit' && value < 0 ? -value : value}
                    size={21}
                    color={value < 0 ? colors.expense : colors.text}
                  />
                }
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
                <Button label="编辑" variant="ghost" onPress={() => begin(account)} />
                {!account.archived && (
                  <Button
                    label="校准余额"
                    variant="ghost"
                    onPress={() => {
                      setAdjusting(account);
                      setTarget(editAmount(value));
                    }}
                  />
                )}
                <Button
                  label={account.archived ? '重新启用' : '停用'}
                  variant="ghost"
                  onPress={() => setArchive(account)}
                />
              </View>
            </Card>
          );
        })}
      {!state.accounts.some((a) => a.archived === showArchived) && (
        <EmptyState
          icon="wallet-outline"
          title={showArchived ? '没有停用的账户' : '添加你的第一个账户'}
          description="账户用于记录钱从哪里来、花到哪里去。"
        />
      )}
      <Hint>信用卡还款请在“记一笔”中选择转账：从还款账户转入信用卡，避免重复计算支出。</Hint>
      <ModalSheet
        visible={open}
        onClose={() => !working && setOpen(false)}
        title={editing ? '编辑账户' : '添加账户'}
      >
        <Field
          label="账户名称"
          value={name}
          onChangeText={setName}
          placeholder="例如：日常银行卡"
          maxLength={40}
        />
        <Label>账户类型</Label>
        <Choices>
          {types.map((t) => (
            <Choice
              key={t.value}
              label={t.name}
              icon={t.icon}
              active={type === t.value}
              onPress={() => setType(t.value)}
            />
          ))}
        </Choices>
        <Field
          label={type === 'credit' ? '期初余额（欠款请填负数）' : '期初余额'}
          value={opening}
          onChangeText={setOpening}
          keyboardType="numbers-and-punctuation"
          editable={!editing}
        />
        {editing && <Hint>要修正当前余额，请使用账户的“校准余额”。历史期初余额在此保持不变。</Hint>}
        <Button label="保存账户" onPress={save} loading={working} />
      </ModalSheet>
      <ModalSheet
        visible={!!adjusting}
        onClose={() => !working && setAdjusting(null)}
        title="校准账户余额"
      >
        <Hint>{adjusting?.name} · 将生成一笔余额调整记录，保留调整过程，不影响收入和支出。</Hint>
        <Field
          label="实际余额（欠款填负数）"
          value={target}
          onChangeText={setTarget}
          keyboardType="numbers-and-punctuation"
        />
        <Button label="确认校准" onPress={adjust} loading={working} />
      </ModalSheet>
      <Confirm
        visible={!!archive}
        title={archive?.archived ? '重新启用账户' : '停用账户'}
        message={
          archive?.archived
            ? '启用后可继续使用此账户记账。此前暂停的周期账单需要单独恢复。'
            : '历史流水和余额会保留，使用此账户的周期账单将一并暂停。'
        }
        onCancel={() => !working && setArchive(null)}
        busy={working}
        onConfirm={() =>
          run(async () => {
            if (!archive) return;
            await mutate((s) => saveAccount(s, { ...archive, archived: !archive.archived }));
            setArchive(null);
            notify('账户状态已更新');
          })
        }
      />
    </>
  );
}
