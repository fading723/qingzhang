import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Budget } from '../../domain/types';
import { budgetProgress, saveBudget } from '../../domain/ledger';
import { makeId, parseMoney } from '../../domain/money';
import { localDateTime, monthKey, shiftPeriod, toInstant } from '../../domain/time';
import { useLedger } from '../../store/LedgerProvider';
import {
  Button,
  Card,
  Choice,
  Confirm,
  EmptyState,
  Field,
  Hint,
  Icon,
  ModalSheet,
  Money,
  SectionTitle,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { activeCategories, categoryName, Choices, editAmount, Label, useTask } from './common';

export function Budgets() {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { run, working } = useTask();
  const [month, setMonth] = useState(monthKey());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [removing, setRemoving] = useState<Budget | null>(null);
  const changeMonth = (delta: number) =>
    setMonth(
      localDateTime(shiftPeriod(toInstant(`${month}-01T00:00`), 'month', delta)).slice(0, 7),
    );
  const begin = (budget?: Budget) => {
    setEditing(budget || null);
    setCategoryId(budget?.categoryId || null);
    setAmount(budget ? editAmount(budget.limitCents) : '');
    setOpen(true);
  };
  const budgets = state.budgets
    .filter((b) => b.month === month)
    .sort((a, b) => Number(!!a.categoryId) - Number(!!b.categoryId));
  const categoryLabel = (id: string | null) =>
    id ? state.categories.find((c) => c.id === id)?.name || '历史分类' : '月总预算';
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="上个月预算"
          onPress={() => changeMonth(-1)}
          style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-back" color={colors.primary} />
        </Pressable>
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            color: colors.text,
            fontSize: 19,
            fontWeight: '700',
          }}
        >
          {month.replace('-', ' 年 ')} 月
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="下个月预算"
          onPress={() => changeMonth(1)}
          style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-forward" color={colors.primary} />
        </Pressable>
      </View>
      <SectionTitle title="给开销一个计划" action="新增预算" onAction={() => begin()} />
      {budgets.map((budget) => {
        const progress = budgetProgress(state, budget);
        const warning =
          progress.ratio >= 1
            ? '已达到预算'
            : progress.ratio >= 0.8
              ? '接近预算上限'
              : '预算内，继续保持';
        const tone =
          progress.ratio >= 1
            ? colors.danger
            : progress.ratio >= 0.8
              ? colors.expense
              : colors.primary;
        return (
          <Card key={budget.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17, flex: 1 }}>
                {categoryLabel(budget.categoryId)}
              </Text>
              <Button label="编辑" onPress={() => begin(budget)} variant="ghost" />
            </View>
            <Label>本月净支出</Label>
            <Money cents={progress.spentCents} size={27} />
            <View
              style={{
                height: 7,
                borderRadius: 6,
                backgroundColor: colors.surfaceAlt,
                marginTop: 17,
                marginBottom: 12,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: 7,
                  borderRadius: 6,
                  width: `${Math.min(1, Math.max(0, progress.ratio)) * 100}%`,
                  backgroundColor: tone,
                }}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <View>
                <Label>{progress.remainingCents < 0 ? '已超出' : '还可使用'}</Label>
                <Money cents={Math.abs(progress.remainingCents)} size={19} color={tone} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Label>预算总额</Label>
                <Money cents={budget.limitCents} size={19} />
              </View>
            </View>
            <Hint>
              {warning} · 已用 {Math.max(0, progress.ratio * 100).toFixed(0)}%
            </Hint>
          </Card>
        );
      })}
      {!budgets.length && (
        <Card>
          <EmptyState
            icon="pie-chart-outline"
            title="这个月，还没有预算"
            description="设置总预算或分类预算，提前知道还能花多少。"
            action={<Button label="设置预算" icon="add" onPress={() => begin()} />}
          />
        </Card>
      )}
      <Hint>
        预算按支出减去当月退款计算。一级分类预算包含其子分类；总预算和分类预算分别展示，不叠加计算。
      </Hint>
      <ModalSheet
        visible={open}
        onClose={() => !working && setOpen(false)}
        title={editing ? '编辑预算' : '新增预算'}
      >
        <Hint>{month} · 本月预算</Hint>
        <Label>预算范围</Label>
        <Choices>
          <Choice label="月总预算" active={!categoryId} onPress={() => setCategoryId(null)} />
          {activeCategories(state, 'expense').map((c) => (
            <Choice
              key={c.id}
              label={categoryName(state, c)}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </Choices>
        <Field
          label="预算金额"
          placeholder="0.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <Button
          label="保存预算"
          loading={working}
          onPress={() =>
            run(async () => {
              await mutate((s) =>
                saveBudget(s, {
                  id: editing?.id || makeId(),
                  month,
                  categoryId,
                  limitCents: parseMoney(amount),
                }),
              );
              setOpen(false);
              notify('预算已保存');
            })
          }
        />
        {editing && (
          <View style={{ marginTop: 10 }}>
            <Button
              label="删除这项预算"
              variant="ghost"
              disabled={working}
              onPress={() => {
                setOpen(false);
                setRemoving(editing);
              }}
            />
          </View>
        )}
      </ModalSheet>
      <Confirm
        visible={!!removing}
        title="删除预算"
        message="只删除这项预算，已有账单和账户余额不会改变。"
        onCancel={() => !working && setRemoving(null)}
        busy={working}
        onConfirm={() =>
          run(async () => {
            await mutate((s) => ({
              ...s,
              budgets: s.budgets.filter((b) => b.id !== removing?.id),
            }));
            setRemoving(null);
            notify('预算已删除');
          })
        }
      />
    </>
  );
}
