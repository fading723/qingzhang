import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Category } from '../../domain/types';
import { saveCategory } from '../../domain/ledger';
import { makeId } from '../../domain/money';
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
  SectionTitle,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { Choices, ItemRow, Label, useTask } from './common';

const icons = [
  'restaurant-outline',
  'cafe-outline',
  'bus-outline',
  'car-outline',
  'bag-handle-outline',
  'home-outline',
  'medkit-outline',
  'book-outline',
  'game-controller-outline',
  'gift-outline',
  'briefcase-outline',
  'heart-outline',
  'fitness-outline',
  'airplane-outline',
  'paw-outline',
  'shirt-outline',
  'musical-notes-outline',
  'wallet-outline',
];
const swatches = [
  '#ED9B59',
  '#528FC6',
  '#CC7AB1',
  '#8C90D7',
  '#DD7887',
  '#16846B',
  '#C59E47',
  '#8B9CA4',
];
export function Categories() {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { run, working } = useTask();
  const [kind, setKind] = useState<Category['kind']>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [icon, setIcon] = useState(icons[0]);
  const [color, setColor] = useState(swatches[0]);
  const [order, setOrder] = useState('0');
  const [archive, setArchive] = useState<Category | null>(null);
  const begin = (category?: Category) => {
    setEditing(category || null);
    setName(category?.name || '');
    setParent(category?.parentId || null);
    setIcon(category?.icon || icons[0]);
    setColor(category?.color || swatches[0]);
    setOrder(String(category?.sortOrder ?? state.categories.filter((c) => c.kind === kind).length));
    setOpen(true);
  };
  const parents = state.categories.filter(
    (c) => c.kind === kind && !c.parentId && !c.archived && c.id !== editing?.id,
  );
  const hasChildren = !!editing && state.categories.some((c) => c.parentId === editing.id);
  const categories = state.categories
    .filter((c) => c.kind === kind && c.archived === showArchived)
    .sort((a, b) => {
      const groupA = a.parentId
        ? (state.categories.find((p) => p.id === a.parentId)?.sortOrder ?? 0)
        : a.sortOrder;
      const groupB = b.parentId
        ? (state.categories.find((p) => p.id === b.parentId)?.sortOrder ?? 0)
        : b.sortOrder;
      return (
        groupA - groupB || Number(!!a.parentId) - Number(!!b.parentId) || a.sortOrder - b.sortOrder
      );
    });
  return (
    <>
      <Choices>
        <Choice label="支出分类" active={kind === 'expense'} onPress={() => setKind('expense')} />
        <Choice label="收入分类" active={kind === 'income'} onPress={() => setKind('income')} />
        <Choice
          label={showArchived ? '查看使用中' : '查看已停用'}
          active={showArchived}
          onPress={() => setShowArchived(!showArchived)}
        />
      </Choices>
      <SectionTitle
        title={showArchived ? '已停用分类' : '分类一目了然'}
        action="新增分类"
        onAction={() => begin()}
      />
      <Card>
        {categories.map((category) => (
          <View key={category.id} style={{ marginLeft: category.parentId ? 20 : 0 }}>
            <ItemRow
              icon={category.icon}
              color={category.color}
              title={category.name}
              subtitle={
                category.parentId
                  ? `${state.categories.find((c) => c.id === category.parentId)?.name || ''} · 二级分类`
                  : '一级分类'
              }
              onPress={() => begin(category)}
            />
          </View>
        ))}
        {!categories.length && (
          <EmptyState
            icon="grid-outline"
            title="这里还没有分类"
            description="创建适合自己生活方式的分类，支出会更清楚。"
          />
        )}
      </Card>
      <Hint>分类支持两级。停用后不再出现在记账选项中，历史统计仍会保留。</Hint>
      <ModalSheet
        visible={open}
        onClose={() => !working && setOpen(false)}
        title={editing ? '编辑分类' : `新增${kind === 'expense' ? '支出' : '收入'}分类`}
      >
        <Field
          label="分类名称"
          value={name}
          onChangeText={setName}
          placeholder="例如：早餐"
          maxLength={30}
        />
        <Label>所属分类</Label>
        <Choices>
          <Choice label="一级分类" active={!parent} onPress={() => setParent(null)} />
          {!hasChildren &&
            parents.map((p) => (
              <Choice
                key={p.id}
                label={p.name}
                active={parent === p.id}
                onPress={() => setParent(p.id)}
              />
            ))}
        </Choices>
        {hasChildren && <Hint>这个分类包含子分类，因此需要保留为一级分类。</Hint>}
        <Label>选择图标</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {icons.map((value) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`分类图标 ${value}`}
              key={value}
              onPress={() => setIcon(value)}
              style={{
                padding: 12,
                borderRadius: 14,
                backgroundColor: icon === value ? colors.primarySoft : colors.surface,
                borderWidth: 1,
                borderColor: icon === value ? colors.primary : colors.border,
              }}
            >
              <Icon name={value} color={color} />
            </Pressable>
          ))}
        </View>
        <Label>颜色</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          {swatches.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`颜色 ${value}`}
              onPress={() => setColor(value)}
              style={{
                backgroundColor: value,
                width: 34,
                height: 34,
                borderRadius: 17,
                borderWidth: color === value ? 3 : 0,
                borderColor: colors.text,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              {color === value && <Icon name="checkmark" size={19} color="#FFFFFF" />}
            </Pressable>
          ))}
        </View>
        <Field
          label="排序（数字越小越靠前）"
          value={order}
          onChangeText={setOrder}
          keyboardType="number-pad"
        />
        <Button
          label="保存分类"
          loading={working}
          onPress={() =>
            run(async () => {
              if (!/^\d+$/.test(order)) throw new Error('排序请输入非负整数');
              await mutate((s) =>
                saveCategory(s, {
                  id: editing?.id || makeId(),
                  name: name.trim(),
                  kind: editing?.kind || kind,
                  parentId: parent,
                  icon,
                  color,
                  sortOrder: Number(order),
                  archived: editing?.archived || false,
                }),
              );
              setOpen(false);
              notify('分类已保存');
            })
          }
        />
        {editing && (
          <View style={{ marginTop: 10 }}>
            <Button
              label={editing.archived ? '重新启用分类' : '停用分类'}
              variant="ghost"
              disabled={working}
              onPress={() => {
                setOpen(false);
                setArchive(editing);
              }}
            />
          </View>
        )}
      </ModalSheet>
      <Confirm
        visible={!!archive}
        title={archive?.archived ? '重新启用分类' : '停用分类'}
        message={
          archive?.archived
            ? '启用后可再次选择此分类记账。子分类需要先启用其所属的一级分类。'
            : '历史流水不会被删除。子分类会一起停用，使用这些分类的周期账单也会暂停。'
        }
        onCancel={() => !working && setArchive(null)}
        busy={working}
        onConfirm={() =>
          run(async () => {
            if (!archive) return;
            await mutate((s) => saveCategory(s, { ...archive, archived: !archive.archived }));
            setArchive(null);
            notify('分类状态已更新');
          })
        }
      />
    </>
  );
}
