import React, { useMemo, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { categoryTotals, filterTransactions, summarize } from '../domain/ledger';
import { localDateTime, periodRange, shiftPeriod, toInstant } from '../domain/time';
import { Period, Transaction, TransactionFilter } from '../domain/types';
import { useLedger } from '../store/LedgerProvider';
import {
  Button,
  Card,
  Choice,
  EmptyState,
  Hint,
  Icon,
  Money,
  Screen,
  SectionTitle,
} from '../ui/components';
import { TransactionRow } from '../ui/TransactionRow';
import { useTheme } from '../ui/theme';

export function ReportsScreen({
  onDrill,
  onTransaction,
}: {
  onDrill: (filter: TransactionFilter) => void;
  onTransaction: (t: Transaction) => void;
}) {
  const { state } = useLedger();
  const { colors } = useTheme();
  const wide = useWindowDimensions().width >= 1120;
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(new Date().toISOString());
  const [chartKind, setChartKind] = useState<'expense' | 'income'>('expense');
  const range = periodRange(period, anchor);
  const rows = useMemo(
    () => filterTransactions(state, { start: range.start, end: range.end }),
    [state, range.start, range.end],
  );
  const totals = summarize(rows);
  const categories = categoryTotals(state, rows, chartKind);
  const chartTotal = categories.reduce((sum, c) => sum + c.amountCents, 0);
  const top = rows
    .filter((t) => t.kind === 'expense')
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5);
  const buckets = useMemo(() => {
    const result: { start: string; end: string; label: string; expense: number; income: number }[] =
      [];
    let cursor = range.start;
    for (let i = 0; cursor < range.end && i < 32; i++) {
      let end: string;
      let label: string;
      const local = localDateTime(cursor);
      if (period === 'day') {
        end = new Date(Date.parse(cursor) + 3600000).toISOString();
        label = `${Number(local.slice(11, 13))}`;
      } else if (period === 'year') {
        end = shiftPeriod(cursor, 'month', 1);
        label = `${Number(local.slice(5, 7))}月`;
      } else {
        end = new Date(Date.parse(cursor) + 86400000).toISOString();
        label =
          period === 'week'
            ? ['一', '二', '三', '四', '五', '六', '日'][i]
            : `${Number(local.slice(8, 10))}`;
      }
      result.push({ start: cursor, end, label, expense: 0, income: 0 });
      cursor = end;
    }
    for (const t of rows) {
      const index = result.findIndex(
        (b) =>
          Date.parse(t.occurredAt) >= Date.parse(b.start) &&
          Date.parse(t.occurredAt) < Date.parse(b.end),
      );
      if (index >= 0) {
        if (t.kind === 'expense') result[index].expense += t.amountCents;
        if (t.kind === 'income') result[index].income += t.amountCents;
      }
    }
    return result;
  }, [rows, period, range.start, range.end]);
  const chartMax = Math.max(1, ...buckets.flatMap((b) => [b.expense, b.income]));
  let circleOffset = 0;
  return (
    <Screen
      eyebrow="看见收支的全貌"
      title="收支统计"
      subtitle="把每一天的记录，变成看得见的生活节奏。"
    >
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
        {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
          <View key={p} style={{ flex: 1 }}>
            <Choice
              label={{ day: '每日', week: '每周', month: '每月', year: '每年' }[p]}
              active={period === p}
              onPress={() => setPeriod(p)}
            />
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <Pressable
          accessibilityLabel="上一周期"
          onPress={() => setAnchor((v) => shiftPeriod(v, period, -1))}
          style={{ padding: 10 }}
        >
          <Icon name="chevron-back" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="回到当前周期"
          onPress={() => setAnchor(new Date().toISOString())}
        >
          <Text style={{ fontSize: 16, color: colors.text, fontWeight: '700' }}>{range.label}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="下一周期"
          onPress={() => setAnchor((v) => shiftPeriod(v, period, 1))}
          style={{ padding: 10 }}
        >
          <Icon name="chevron-forward" size={20} />
        </Pressable>
      </View>
      <Card tint>
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ color: colors.primary, fontSize: 12 }}>净支出（元）</Text>
          <View style={{ marginVertical: 12 }}>
            <Money cents={totals.netExpenseCents} size={39} />
          </View>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {totals.count} 笔收支记录 · 按消费时间汇总
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: 18,
            marginTop: 10,
          }}
        >
          {[
            { label: '收入', value: totals.incomeCents, color: colors.income, kind: 'income' },
            { label: '退款', value: totals.refundCents, color: colors.primary, kind: 'refund' },
            { label: '结余', value: totals.balanceCents, color: colors.text, kind: undefined },
          ].map((item) => (
            <Pressable
              key={item.label}
              onPress={() =>
                onDrill({
                  start: range.start,
                  end: range.end,
                  kind: item.kind as TransactionFilter['kind'],
                })
              }
              style={{ flex: 1, alignItems: 'center' }}
            >
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 7 }}>
                {item.label}
              </Text>
              <Money cents={item.value} size={20} color={item.color} />
            </Pressable>
          ))}
        </View>
      </Card>
      <SectionTitle
        title="收支趋势"
        action="查看账单"
        onAction={() => onDrill({ start: range.start, end: range.end })}
      />
      <Card>
        <View
          style={{ flexDirection: 'row', gap: 15, justifyContent: 'flex-end', marginBottom: 15 }}
        >
          {[
            { label: '支出原额', color: colors.expense },
            { label: '收入', color: colors.primary },
          ].map((item) => (
            <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: item.color }} />
              <Text style={{ fontSize: 10, color: colors.muted }}>{item.label}</Text>
            </View>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            height: 150,
            gap: period === 'month' || period === 'day' ? 3 : 9,
            alignItems: 'flex-end',
          }}
        >
          {buckets.map((b, i) => (
            <Pressable
              key={b.start}
              accessibilityLabel={`${b.label}，查看账单`}
              onPress={() => onDrill({ start: b.start, end: b.end })}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  height: 120,
                  gap: 2,
                  width: '85%',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    flex: 1,
                    maxWidth: 20,
                    height: Math.max(2, (b.expense / chartMax) * 120),
                    backgroundColor: colors.expense,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
                <View
                  style={{
                    flex: 1,
                    maxWidth: 20,
                    height: Math.max(2, (b.income / chartMax) * 120),
                    backgroundColor: colors.primary,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
              </View>
              <Text style={{ fontSize: 9, color: colors.muted, marginTop: 9 }}>
                {buckets.length > 16 && i % 5 !== 0 ? '' : b.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Hint>点击柱状图查看对应时段的流水；转账和余额调整不计入收支。</Hint>
      </Card>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 20 : 0 }}>
        <View style={{ flex: 1 }}>
          <SectionTitle title="分类构成" />
          <Card>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              <Choice
                label="支出"
                active={chartKind === 'expense'}
                onPress={() => setChartKind('expense')}
              />
              <Choice
                label="收入"
                active={chartKind === 'income'}
                onPress={() => setChartKind('income')}
              />
            </View>
            {!categories.length ? (
              <EmptyState
                icon="pie-chart-outline"
                title="这里，还没有数据"
                description="这个时段的收支记录会自动汇总到这里。"
              />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="查看分类构成账单"
                  onPress={() => onDrill({ start: range.start, end: range.end, kind: chartKind })}
                  style={{ alignSelf: 'center', width: 164, height: 164, marginBottom: 24 }}
                >
                  <Svg width={164} height={164}>
                    <Circle
                      cx={82}
                      cy={82}
                      r={65}
                      stroke={colors.surfaceAlt}
                      strokeWidth={18}
                      fill="none"
                    />
                    {categories.map((c) => {
                      const dash = (c.amountCents / chartTotal) * 408.4;
                      const offset = circleOffset;
                      circleOffset += dash;
                      return (
                        <Circle
                          key={c.categoryId}
                          cx={82}
                          cy={82}
                          r={65}
                          fill="none"
                          stroke={c.color}
                          strokeWidth={18}
                          strokeDasharray={`${dash} ${408.4 - dash}`}
                          strokeDashoffset={-offset}
                          transform="rotate(-90, 82, 82)"
                        />
                      );
                    })}
                  </Svg>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                      {chartKind === 'expense' ? '支出原额' : '总收入'}
                    </Text>
                    <Money cents={chartTotal} size={23} />
                  </View>
                </Pressable>
                {categories.map((c) => (
                  <Pressable
                    key={c.categoryId}
                    onPress={() =>
                      onDrill({
                        start: range.start,
                        end: range.end,
                        categoryId: c.categoryId,
                        kind: chartKind,
                      })
                    }
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 12,
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <View
                      style={{ backgroundColor: c.color, width: 8, height: 8, borderRadius: 3 }}
                    />
                    <Text style={{ flex: 1, fontSize: 13, color: colors.text }}>{c.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {((c.amountCents / chartTotal) * 100).toFixed(1)}%
                    </Text>
                    <Money cents={c.amountCents} size={15} />
                    <Icon name="chevron-forward" size={12} color={colors.muted} />
                  </Pressable>
                ))}
              </>
            )}
            <Hint>退款单独列示，不混入分类占比。</Hint>
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <SectionTitle title="大额消费排行" />
          <Card style={{ paddingVertical: 8 }}>
            {top.length ? (
              top.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  fullDate
                  onPress={() => onTransaction(t)}
                />
              ))
            ) : (
              <EmptyState
                icon="podium-outline"
                title="暂无消费排行"
                description="记录之后，一眼看清钱花在了哪里。"
              />
            )}
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, marginBottom: 8 }}>
              数字背后的含义
            </Text>
            <Hint>
              支出原额 − 退款 = 净支出{'\n'}收入 − 净支出 = 结余{'\n'}
              退款归入实际到账的时段，历史消费保持原样。
            </Hint>
          </Card>
        </View>
      </View>
    </Screen>
  );
}
