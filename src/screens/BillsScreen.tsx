import React, { useEffect, useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import { filterTransactions, summarize } from '../domain/ledger';
import { parseMoney } from '../domain/money';
import { localDateTime, toInstant } from '../domain/time';
import { Transaction, TransactionFilter, TransactionKind } from '../domain/types';
import { useLedger } from '../store/LedgerProvider';
import {
  Button,
  Card,
  Choice,
  EmptyState,
  Field,
  Icon,
  ModalSheet,
  Money,
  Screen,
} from '../ui/components';
import { TransactionRow } from '../ui/TransactionRow';
import { useTheme } from '../ui/theme';

export function BillsScreen({
  initialFilter,
  onTransaction,
}: {
  initialFilter?: TransactionFilter;
  onTransaction: (t: Transaction) => void;
}) {
  const { state, notify } = useLedger();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<TransactionFilter>(initialFilter || {});
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const [showFilter, setShowFilter] = useState(false);
  const [draft, setDraft] = useState<TransactionFilter>({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  useEffect(() => {
    setFilter(initialFilter || {});
    setLimit(60);
    setQuery('');
  }, [initialFilter]);
  const rows = useMemo(
    () => filterTransactions(state, { ...filter, query }),
    [state, filter, query],
  );
  const totals = useMemo(() => summarize(rows), [rows]);
  const sections = useMemo(() => {
    const groups: { title: string; data: Transaction[] }[] = [];
    for (const row of rows.slice(0, limit)) {
      const date = localDateTime(row.occurredAt).slice(0, 10);
      if (groups[groups.length - 1]?.title !== date) groups.push({ title: date, data: [] });
      groups[groups.length - 1].data.push(row);
    }
    return groups;
  }, [rows, limit]);
  const openFilters = () => {
    setDraft(filter);
    setStartDate(filter.start ? localDateTime(filter.start).slice(0, 10) : '');
    setEndDate(
      filter.end
        ? localDateTime(new Date(Date.parse(filter.end) - 1).toISOString()).slice(0, 10)
        : '',
    );
    setMinimum(filter.minCents === undefined ? '' : String(filter.minCents / 100));
    setMaximum(filter.maxCents === undefined ? '' : String(filter.maxCents / 100));
    setShowFilter(true);
  };
  const apply = () => {
    try {
      const start = startDate ? toInstant(`${startDate}T00:00`) : undefined;
      const end = endDate
        ? new Date(Date.parse(toInstant(`${endDate}T00:00`)) + 86400000).toISOString()
        : undefined;
      if (start && end && start >= end) throw new Error('结束日期不能早于开始日期');
      const minCents = minimum ? parseMoney(minimum) : undefined;
      const maxCents = maximum ? parseMoney(maximum) : undefined;
      if (minCents !== undefined && maxCents !== undefined && minCents > maxCents)
        throw new Error('最高金额不能小于最低金额');
      setFilter({ ...draft, start, end, minCents, maxCents });
      setLimit(60);
      setShowFilter(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : '筛选条件无效', true);
    }
  };
  const activeCount = Object.values(filter).filter((v) => v !== undefined && v !== '').length;
  return (
    <>
      <Screen
        scroll={false}
        eyebrow="每一笔，都是生活"
        title="我的账单"
        subtitle={`${rows.length} 笔记录 · 按消费发生时间排列`}
        action={
          <Button
            label={activeCount ? `筛选 · ${activeCount}` : '筛选'}
            variant="secondary"
            icon="options-outline"
            onPress={openFilters}
          />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field
              label="搜索账单"
              placeholder="搜索备注、分类、账户或标签"
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                setLimit(60);
              }}
            />
          </View>
          {activeCount > 0 && (
            <Button
              label="清除"
              variant="ghost"
              onPress={() => {
                setFilter({});
                setLimit(60);
              }}
            />
          )}
        </View>
        <Card style={{ flexDirection: 'row', padding: 16, gap: 18 }}>
          {[
            { label: '净支出', amount: totals.netExpenseCents, color: colors.expense },
            { label: '收入', amount: totals.incomeCents, color: colors.primary },
            { label: '结余', amount: totals.balanceCents, color: colors.text },
          ].map((item) => (
            <View key={item.label} style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 7 }}>
                {item.label}
              </Text>
              <Money cents={item.amount} size={19} color={item.color} />
            </View>
          ))}
        </Card>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          windowSize={7}
          renderSectionHeader={({ section }) => (
            <View
              style={{ paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Icon name="calendar-clear-outline" size={13} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '600' }}>
                {section.title.replace(/-/g, '.')}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: colors.surface, paddingHorizontal: 15 }}>
              <TransactionRow transaction={item} onPress={() => onTransaction(item)} />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title={state.transactions.length ? '没有找到这笔账' : '账本还是空白的'}
              description={
                state.transactions.length
                  ? '换个关键词，或调整筛选条件试试。'
                  : '点击下方「记一笔」，开始记录你的日常收支。'
              }
            />
          }
          ListFooterComponent={
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              {rows.length > limit ? (
                <Button
                  label={`加载更多 · 还有 ${rows.length - limit} 笔`}
                  variant="secondary"
                  onPress={() => setLimit((v) => v + 60)}
                />
              ) : rows.length > 0 ? (
                <Text style={{ color: colors.muted, fontSize: 11 }}>每一笔，都好好记下了</Text>
              ) : null}
            </View>
          }
        />
      </Screen>
      <ModalSheet visible={showFilter} onClose={() => setShowFilter(false)} title="筛选账单">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 9 }}>类型</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {(
            [undefined, 'expense', 'income', 'transfer', 'refund', 'adjustment'] as (
              TransactionKind | undefined
            )[]
          ).map((k) => (
            <Choice
              key={k || 'all'}
              label={
                k
                  ? {
                      expense: '支出',
                      income: '收入',
                      transfer: '转账',
                      refund: '退款',
                      adjustment: '余额调整',
                    }[k]
                  : '全部'
              }
              active={draft.kind === k}
              onPress={() => setDraft((v) => ({ ...v, kind: k }))}
            />
          ))}
        </View>
        <Field
          label="开始日期"
          value={startDate}
          onChangeText={setStartDate}
          placeholder="YYYY-MM-DD（留空不限）"
        />
        <Field
          label="结束日期（含当天）"
          value={endDate}
          onChangeText={setEndDate}
          placeholder="YYYY-MM-DD（留空不限）"
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field
              label="最低金额"
              value={minimum}
              onChangeText={setMinimum}
              placeholder="不限"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="最高金额"
              value={maximum}
              onChangeText={setMaximum}
              placeholder="不限"
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 9 }}>
          账户（包含历史账户）
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <Choice
            label="全部账户"
            active={!draft.accountId}
            onPress={() => setDraft((v) => ({ ...v, accountId: undefined }))}
          />
          {state.accounts.map((a) => (
            <Choice
              key={a.id}
              label={a.name}
              active={draft.accountId === a.id}
              onPress={() => setDraft((v) => ({ ...v, accountId: a.id }))}
            />
          ))}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 9 }}>
          分类（父分类包含子分类）
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <Choice
            label="全部分类"
            active={!draft.categoryId}
            onPress={() => setDraft((v) => ({ ...v, categoryId: undefined }))}
          />
          {state.categories.map((c) => (
            <Choice
              key={c.id}
              label={
                c.parentId
                  ? `${state.categories.find((p) => p.id === c.parentId)?.name}/${c.name}`
                  : c.name
              }
              active={draft.categoryId === c.id}
              onPress={() => setDraft((v) => ({ ...v, categoryId: c.id }))}
            />
          ))}
        </View>
        <Field
          label="标签精确筛选"
          value={draft.tag || ''}
          onChangeText={(tag) => setDraft((v) => ({ ...v, tag: tag || undefined }))}
          placeholder="例如：旅行"
        />
        <Button label="应用筛选" onPress={apply} />
      </ModalSheet>
    </>
  );
}
