import React from 'react';
import { Button, Screen } from '../ui/components';
import { Accounts } from './manage/Accounts';
import { Categories } from './manage/Categories';
import { Budgets } from './manage/Budgets';
import { Recurring } from './manage/Recurring';
import { DataManagement } from './manage/DataManagement';
import { Settings } from './manage/Settings';
export type ManageSection =
  'accounts' | 'categories' | 'budgets' | 'recurring' | 'data' | 'settings';
const headers: Record<ManageSection, { title: string; subtitle: string }> = {
  accounts: { title: '账户管理', subtitle: '每一处余额，都清清楚楚。' },
  categories: { title: '分类管理', subtitle: '按自己的生活方式，整理每一笔。' },
  budgets: { title: '预算计划', subtitle: '为喜欢的生活，留一点余地。' },
  recurring: { title: '周期账单', subtitle: '定期提醒，不再遗漏。' },
  data: { title: '数据与备份', subtitle: '账本留在本机，迁移由你决定。' },
  settings: { title: '偏好设置', subtitle: '让青账更适合你。' },
};
export function ManageScreen({ section, onBack }: { section: ManageSection; onBack: () => void }) {
  return (
    <Screen
      key={section}
      title={headers[section].title}
      subtitle={headers[section].subtitle}
      eyebrow="QINGZHANG / 青账"
      action={<Button label="返回" icon="arrow-back" variant="ghost" onPress={onBack} />}
    >
      {section === 'accounts' ? (
        <Accounts />
      ) : section === 'categories' ? (
        <Categories />
      ) : section === 'budgets' ? (
        <Budgets />
      ) : section === 'recurring' ? (
        <Recurring />
      ) : section === 'data' ? (
        <DataManagement />
      ) : (
        <Settings />
      )}
    </Screen>
  );
}
