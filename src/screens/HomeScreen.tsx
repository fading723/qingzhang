import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { balances, budgetProgress, filterTransactions, summarize } from '../domain/ledger';
import { completeOccurrence, dueOccurrences } from '../domain/recurring';
import { formatMoney } from '../domain/money';
import { localDateTime, monthKey, periodRange } from '../domain/time';
import { DueOccurrence, Transaction } from '../domain/types';
import { useLedger } from '../store/LedgerProvider';
import { useTheme } from '../ui/theme';
import {
  Button,
  Card,
  EmptyState,
  Hint,
  Icon,
  Money,
  Screen,
  SectionTitle,
} from '../ui/components';
import { TransactionRow } from '../ui/TransactionRow';
import type { ManageSection } from './ManageScreen';

export function HomeScreen({
  onAdd,
  onTransaction,
  onBills,
  onManage,
}: {
  onAdd: () => void;
  onTransaction: (t: Transaction) => void;
  onBills: () => void;
  onManage: (section: ManageSection) => void;
}) {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1120;
  const now = new Date().toISOString();
  const currentMonth = periodRange('month', now);
  const monthly = useMemo(
    () =>
      summarize(filterTransactions(state, { start: currentMonth.start, end: currentMonth.end })),
    [state, currentMonth.start],
  );
  const dailyRange = periodRange('day', now);
  const daily = summarize(
    filterTransactions(state, { start: dailyRange.start, end: dailyRange.end }),
  );
  const accountBalances = balances(state);
  const netWorth = Object.values(accountBalances).reduce((a, b) => a + b, 0);
  const recent = filterTransactions(state).slice(0, 5);
  const budget = state.budgets.find((b) => b.month === monthKey(now) && !b.categoryId);
  const progress = budget ? budgetProgress(state, budget) : null;
  const due = useMemo(() => dueOccurrences(state, now), [state, now.slice(0, 16)]);
  const [posting, setPosting] = useState<string | null>(null);
  const resolve = async (item: DueOccurrence, action: 'post' | 'skip') => {
    if (posting) return;
    setPosting(item.id);
    try {
      await mutate((s) => completeOccurrence(s, item, action));
      notify(action === 'post' ? '账单已确认并记账' : '本期已跳过');
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败', true);
    } finally {
      setPosting(null);
    }
  };
  const today = localDateTime(now).slice(0, 10);
  const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
  const lastSeven = Array.from({ length: 7 }, (_, i) => {
    const iso = new Date(Date.now() - (6 - i) * 86400000).toISOString();
    const range = periodRange('day', iso);
    return {
      day: localDateTime(iso).slice(5, 10),
      ...summarize(filterTransactions(state, { start: range.start, end: range.end })),
    };
  });
  const maxBar = Math.max(1, ...lastSeven.map((d) => d.expenseCents));
  return (
    <Screen
      eyebrow="我的日常 · MY EVERYDAY"
      title="生活有数，心里有底"
      subtitle={`${today.replace(/-/g, '.')}  星期${'日一二三四五六'[weekDay]} · 今天也好好生活`}
      action={
        <Pressable
          accessibilityLabel="打开账户管理"
          onPress={() => onManage('accounts')}
          style={[styles.avatar, { backgroundColor: colors.primarySoft }]}
        >
          <Icon name="leaf-outline" color={colors.primary} size={25} />
        </Pressable>
      }
    >
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 22 : 0 }}>
        <View style={{ flex: wide ? 1.7 : undefined }}>
          <LinearGradient
            colors={['#215C4A', '#153F34']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View pointerEvents="none" style={styles.orbitOne} />
            <View pointerEvents="none" style={styles.orbitTwo} />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#BBD6C8', fontSize: 13 }}>本月净支出</Text>
              <View style={styles.monthBadge}>
                <Icon name="calendar-outline" color="#D0E8DB" size={13} />
                <Text style={{ color: '#D0E8DB', fontSize: 11 }}>
                  {monthKey(now).replace('-', ' / ')}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 22 }}>
              <Text style={{ fontSize: 24, color: '#C6DECF' }}>¥</Text>
              <Money cents={monthly.netExpenseCents} size={44} color="#FFFFFF" />
            </View>
            <Text style={{ color: '#9CBDAC', fontSize: 11, marginTop: 9 }}>
              每一笔认真记录，都是对生活的掌握
            </Text>
            <View style={styles.heroDivider} />
            <View style={{ flexDirection: 'row', gap: 30 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>↗ 本月收入</Text>
                <Money cents={monthly.incomeCents} size={22} color="#E7F3EB" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>◎ 本月结余</Text>
                <Money cents={monthly.balanceCents} size={22} color="#E7F3EB" />
              </View>
            </View>
          </LinearGradient>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 10 }}>
            {[
              {
                label: '今日支出',
                value: daily.netExpenseCents,
                icon: 'arrow-up-outline',
                color: colors.expense,
              },
              {
                label: '今日收入',
                value: daily.incomeCents,
                icon: 'arrow-down-outline',
                color: colors.primary,
              },
              {
                label: '今日笔数',
                value: daily.count,
                icon: 'receipt-outline',
                color: colors.muted,
              },
            ].map((item, i) => (
              <View
                key={item.label}
                style={[
                  styles.miniStat,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Icon name={item.icon} color={item.color} size={17} />
                <Text style={{ fontSize: 11, color: colors.muted, marginVertical: 8 }}>
                  {item.label}
                </Text>
                {i === 2 ? (
                  <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
                    {item.value}
                    <Text style={{ fontSize: 11, fontWeight: '400', color: colors.muted }}>
                      {' '}
                      笔
                    </Text>
                  </Text>
                ) : (
                  <Money cents={item.value} size={18} />
                )}
              </View>
            ))}
          </View>
          <SectionTitle title="最近账单" action="全部账单" onAction={onBills} />
          <Card style={{ paddingVertical: 5 }}>
            {recent.length ? (
              recent.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  fullDate
                  onPress={() => onTransaction(t)}
                />
              ))
            ) : (
              <EmptyState
                title="从第一笔开始"
                description="一杯咖啡、一程地铁，记录生活里的小事，让收支慢慢清晰起来。"
                action={<Button label="记下第一笔" icon="add" onPress={onAdd} />}
              />
            )}
          </Card>
          <View style={[styles.tip, { backgroundColor: colors.primarySoft }]}>
            <Icon name="shield-checkmark-outline" size={19} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.primary, fontSize: 11, lineHeight: 19 }}>
              你的账本，只属于你。无需登录，离线也能安心记录。
            </Text>
          </View>
        </View>
        <View style={{ flex: wide ? 1 : undefined }}>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>本月预算</Text>
              <Pressable
                accessibilityLabel="管理预算"
                onPress={() => onManage('budgets')}
                hitSlop={10}
              >
                <Icon name="ellipsis-horizontal" color={colors.muted} size={20} />
              </Pressable>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 18,
                marginTop: 22,
                marginBottom: 10,
              }}
            >
              <View style={{ height: 88, width: 88 }}>
                <Svg width={88} height={88}>
                  <Circle
                    cx={44}
                    cy={44}
                    r={36}
                    stroke={colors.surfaceAlt}
                    strokeWidth={7}
                    fill="none"
                  />
                  <Circle
                    cx={44}
                    cy={44}
                    r={36}
                    stroke={progress && progress.ratio >= 1 ? colors.expense : colors.primary}
                    strokeWidth={7}
                    fill="none"
                    strokeDasharray={`${Math.min(1, Math.max(0, progress?.ratio || 0)) * 226.2} 226.2`}
                    transform="rotate(-90, 44, 44)"
                    strokeLinecap="round"
                  />
                </Svg>
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <Text style={{ fontSize: 21, fontWeight: '700', color: colors.text }}>
                    {progress ? `${Math.round(Math.max(0, progress.ratio) * 100)}%` : '—'}
                  </Text>
                  <Text style={{ fontSize: 9, color: colors.muted, marginTop: 3 }}>预算已用</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {progress
                    ? progress.remainingCents >= 0
                      ? '还可以花'
                      : '已超支'
                    : '给花钱一点计划'}
                </Text>
                {progress ? (
                  <Money
                    cents={Math.abs(progress.remainingCents)}
                    size={26}
                    color={progress.remainingCents < 0 ? colors.expense : colors.text}
                  />
                ) : (
                  <Text
                    style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 7 }}
                  >
                    从容安排每一月
                  </Text>
                )}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 7 }}>
                  {budget ? `总预算 ¥${formatMoney(budget.limitCents)}` : '设置总预算与分类额度'}
                </Text>
              </View>
            </View>
            {progress && progress.ratio >= 0.8 ? (
              <Hint>
                {progress.ratio >= 1
                  ? '本月预算已用完，调整计划或放慢一点。'
                  : '已使用超过 80%，留意接下来的支出。'}
              </Hint>
            ) : !budget ? (
              <Button label="设置月预算" variant="secondary" onPress={() => onManage('budgets')} />
            ) : null}
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                近 7 日支出
              </Text>
              <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
                <View
                  style={{ width: 6, height: 6, backgroundColor: colors.primary, borderRadius: 3 }}
                />
                <Text style={{ fontSize: 10, color: colors.muted }}>支出原额</Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                height: 127,
                gap: 12,
                marginTop: 22,
                alignItems: 'flex-end',
              }}
            >
              {lastSeven.map((day, i) => (
                <View
                  key={day.day}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end',
                    gap: 9,
                  }}
                >
                  <View
                    style={{
                      width: '75%',
                      maxWidth: 24,
                      height: Math.max(3, (day.expenseCents / maxBar) * 95),
                      borderTopLeftRadius: 5,
                      borderTopRightRadius: 5,
                      backgroundColor: i === 6 ? colors.primary : colors.primarySoft,
                    }}
                  />
                  <Text style={{ fontSize: 9, color: colors.muted }}>{day.day.slice(3)}</Text>
                </View>
              ))}
            </View>
            {!state.transactions.length && <Hint>开始记录后，在这里看见消费的节奏。</Hint>}
          </Card>
          <Card>
            <Pressable
              accessibilityRole="button"
              onPress={() => onManage('accounts')}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
                  净资产 · 含信用卡负债
                </Text>
                <Money cents={netWorth} size={27} />
              </View>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: colors.primarySoft, width: 42, height: 42 },
                ]}
              >
                <Icon name="wallet-outline" color={colors.primary} size={22} />
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 17, flexWrap: 'wrap' }}>
              {state.accounts
                .filter((a) => !a.archived)
                .slice(0, 4)
                .map((a) => (
                  <View
                    key={a.id}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      paddingVertical: 5,
                      paddingHorizontal: 9,
                      borderRadius: 7,
                    }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 10 }}>{a.name}</Text>
                  </View>
                ))}
            </View>
          </Card>
        </View>
      </View>
      {due.length > 0 && (
        <>
          <SectionTitle
            title={`待确认账单 · ${due.length}`}
            action="管理周期账单"
            onAction={() => onManage('recurring')}
          />
          {due.slice(0, 5).map((item) => (
            <Card key={item.id}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Icon name="repeat-outline" color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{item.rule.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 5 }}>
                    {localDateTime(item.scheduledAt).replace('T', ' ')}
                  </Text>
                </View>
                <Money cents={item.rule.amountCents} size={19} />
              </View>
              <View
                style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 15 }}
              >
                <Button
                  label="跳过本期"
                  variant="ghost"
                  onPress={() => void resolve(item, 'skip')}
                  disabled={!!posting}
                />
                <Button
                  label="确认记账"
                  onPress={() => void resolve(item, 'post')}
                  loading={posting === item.id}
                  disabled={!!posting}
                />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  avatar: {
    height: 48,
    width: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { padding: 25, borderRadius: 24, overflow: 'hidden' },
  orbitOne: {
    position: 'absolute',
    right: -50,
    top: -80,
    width: 270,
    height: 270,
    borderRadius: 160,
    borderWidth: 1,
    borderColor: '#9AC4AB25',
  },
  orbitTwo: {
    position: 'absolute',
    right: -25,
    top: -55,
    width: 220,
    height: 220,
    borderRadius: 140,
    borderWidth: 30,
    borderColor: '#9AC4AB09',
  },
  monthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF0C',
    borderWidth: 1,
    borderColor: '#FFFFFF15',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  heroDivider: { height: 1, backgroundColor: '#FFFFFF20', marginTop: 23, marginBottom: 20 },
  heroLabel: { fontSize: 11, color: '#AECCBC', marginBottom: 8 },
  miniStat: { flex: 1, borderWidth: 1, borderRadius: 19, padding: 15 },
  tip: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
});
