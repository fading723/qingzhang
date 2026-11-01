import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { RecurringRule } from '../../domain/types';
import { saveRule } from '../../domain/recurring';
import { makeId, parseMoney } from '../../domain/money';
import { localDateTime } from '../../domain/time';
import { scheduleReminders } from '../../services/notifications';
import { useLedger } from '../../store/LedgerProvider';
import {
  Button,
  Card,
  Choice,
  EmptyState,
  Field,
  Hint,
  ModalSheet,
  Money,
  SectionTitle,
} from '../../ui/components';
import { DateTimeField } from '../../ui/DateTimeField';
import { useTheme } from '../../ui/theme';
import {
  activeCategories,
  categoryName,
  Choices,
  editAmount,
  ItemRow,
  Label,
  useTask,
} from './common';

const frequencies: Array<{ value: RecurringRule['frequency']; name: string }> = [
  { value: 'daily', name: '每天' },
  { value: 'weekly', name: '每周' },
  { value: 'monthly', name: '每月' },
  { value: 'yearly', name: '每年' },
];
export function Recurring() {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { run, working } = useTask();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RecurringRule['kind']>('expense');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>('monthly');
  const [startAt, setStartAt] = useState(new Date().toISOString());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const begin = (rule?: RecurringRule) => {
    setEditing(rule || null);
    setName(rule?.name || '');
    setKind(rule?.kind || 'expense');
    setAmount(rule ? editAmount(rule.amountCents) : '');
    setFrequency(rule?.frequency || 'monthly');
    setStartAt(rule?.startAt || new Date().toISOString());
    setAccountId(rule?.accountId || state.accounts.find((a) => !a.archived)?.id || '');
    setCategoryId(rule?.categoryId || activeCategories(state, 'expense')[0]?.id || '');
    setNote(rule?.note || '');
    setOpen(true);
  };
  const lockedSchedule = !!editing && state.occurrences.some((o) => o.ruleId === editing.id);
  const persistRule = async (rule: RecurringRule) => {
    await mutate((s) => saveRule(s, rule));
  };
  return (
    <>
      <Card tint>
        <ItemRow
          icon="notifications-outline"
          title="到期提醒，由你确认"
          subtitle="提醒不会自动扣款，也不会直接生成支出。"
        />
        <View style={{ marginTop: 12 }}>
          <Button
            label="开启 / 更新通知提醒"
            icon="notifications-outline"
            variant="secondary"
            loading={working}
            onPress={() =>
              run(async () => {
                const result = await scheduleReminders(state);
                notify(
                  result.granted
                    ? `已更新 ${result.scheduled} 个近期提醒`
                    : Platform.OS === 'web'
                      ? '请在手机 App 开启通知，网页首页仍会显示待确认账单'
                      : '未开启系统通知，首页仍会显示待确认账单',
                );
              })
            }
          />
        </View>
      </Card>
      <SectionTitle title="定期发生的收支" action="添加账单" onAction={() => begin()} />
      {state.recurringRules.map((rule) => (
        <Card key={rule.id}>
          <ItemRow
            icon={rule.kind === 'expense' ? 'repeat-outline' : 'trending-up-outline'}
            title={rule.name}
            subtitle={`${frequencies.find((f) => f.value === rule.frequency)?.name} · ${rule.enabled ? '提醒中' : '已暂停'}`}
            right={
              <Money
                cents={rule.amountCents}
                size={22}
                color={rule.kind === 'expense' ? colors.expense : colors.income}
              />
            }
          />
          <Hint>
            首次发生：{localDateTime(rule.startAt).replace('T', ' ')} ·{' '}
            {state.accounts.find((a) => a.id === rule.accountId)?.name}
          </Hint>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="编辑" variant="ghost" onPress={() => begin(rule)} />
            <Button
              label={rule.enabled ? '暂停' : '恢复'}
              disabled={working}
              variant="ghost"
              onPress={() =>
                run(async () => {
                  await persistRule({ ...rule, enabled: !rule.enabled });
                  notify(rule.enabled ? '已暂停周期账单' : '已恢复周期账单');
                })
              }
            />
          </View>
        </Card>
      ))}
      {!state.recurringRules.length && (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title="给规律的生活，一点提醒"
            description="房租、工资、订阅会员，都可以在这里设置周期账单。"
            action={<Button label="添加周期账单" icon="add" onPress={() => begin()} />}
          />
        </Card>
      )}
      <Hint>
        每期可在首页确认记账或跳过。同一期不会重复生成账目。每月 29、30、31
        日遇到短月份时，自动顺延为该月最后一天。
      </Hint>
      <ModalSheet
        visible={open}
        onClose={() => !working && setOpen(false)}
        title={editing ? '编辑周期账单' : '添加周期账单'}
      >
        <Field
          label="账单名称"
          value={name}
          onChangeText={setName}
          placeholder="例如：每月房租"
          maxLength={50}
        />
        <Choices>
          <Choice
            label="支出"
            active={kind === 'expense'}
            onPress={() => {
              setKind('expense');
              setCategoryId(activeCategories(state, 'expense')[0]?.id || '');
            }}
          />
          <Choice
            label="收入"
            active={kind === 'income'}
            onPress={() => {
              setKind('income');
              setCategoryId(activeCategories(state, 'income')[0]?.id || '');
            }}
          />
        </Choices>
        <Field
          label="每期金额"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <Label>发生频率</Label>
        {lockedSchedule ? (
          <Hint>
            {frequencies.find((f) => f.value === frequency)?.name} ·
            已有确认记录，频率和起始时间保持不变；如需更改，请暂停后新建。
          </Hint>
        ) : (
          <Choices>
            {frequencies.map((f) => (
              <Choice
                key={f.value}
                label={f.name}
                active={frequency === f.value}
                onPress={() => setFrequency(f.value)}
              />
            ))}
          </Choices>
        )}
        {lockedSchedule ? (
          <Hint>首次发生：{localDateTime(startAt).replace('T', ' ')}</Hint>
        ) : (
          <DateTimeField label="首次发生时间" value={startAt} onChange={setStartAt} />
        )}
        <Label>使用账户</Label>
        <Choices>
          {state.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <Choice
                key={a.id}
                label={a.name}
                active={accountId === a.id}
                onPress={() => setAccountId(a.id)}
              />
            ))}
        </Choices>
        <Label>记账分类</Label>
        <Choices>
          {activeCategories(state, kind).map((c) => (
            <Choice
              key={c.id}
              label={categoryName(state, c)}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </Choices>
        <Field
          label="备注（可选）"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1000}
        />
        <Button
          label="保存周期账单"
          loading={working}
          onPress={() =>
            run(async () => {
              await persistRule({
                id: editing?.id || makeId(),
                name: name.trim(),
                kind,
                amountCents: parseMoney(amount),
                frequency,
                startAt,
                accountId,
                categoryId,
                note: note.trim(),
                tags: editing?.tags || [],
                enabled: editing?.enabled ?? true,
                createdAt: editing?.createdAt || new Date().toISOString(),
              });
              setOpen(false);
              notify('周期账单已保存');
            })
          }
        />
      </ModalSheet>
    </>
  );
}
