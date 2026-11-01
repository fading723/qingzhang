import type { Category, LedgerState } from './types';

const expense: Array<[string, string, string, string]> = [
  ['food', '餐饮', 'restaurant-outline', '#ED9B59'],
  ['transport', '交通', 'bus-outline', '#528FC6'],
  ['shopping', '购物', 'bag-handle-outline', '#CC7AB1'],
  ['housing', '居住', 'home-outline', '#8C90D7'],
  ['health', '医疗', 'medkit-outline', '#DD7887'],
  ['learning', '学习', 'book-outline', '#668FC6'],
  ['entertainment', '娱乐', 'game-controller-outline', '#A485D0'],
  ['social', '人情', 'gift-outline', '#D09362'],
  ['other-expense', '其他支出', 'ellipsis-horizontal-circle-outline', '#8B9CA4'],
];
const income: Array<[string, string, string, string]> = [
  ['salary', '工资', 'briefcase-outline', '#228A75'],
  ['bonus', '奖金', 'trophy-outline', '#C59E47'],
  ['part-time', '兼职', 'laptop-outline', '#5C9BAA'],
  ['investment', '理财收益', 'trending-up-outline', '#648EAB'],
  ['other-income', '其他收入', 'add-circle-outline', '#8B9CA4'],
];
export function initialState(): LedgerState {
  const categories: Category[] = [
    ...expense.map((item, index): Category => ({
      id: `cat-${item[0]}`,
      name: item[1],
      icon: item[2],
      color: item[3],
      kind: 'expense',
      parentId: null,
      sortOrder: index,
      archived: false,
    })),
    ...income.map((item, index): Category => ({
      id: `cat-${item[0]}`,
      name: item[1],
      icon: item[2],
      color: item[3],
      kind: 'income',
      parentId: null,
      sortOrder: index,
      archived: false,
    })),
  ];
  return {
    version: 1,
    accounts: [
      {
        id: 'account-cash',
        name: '现金',
        type: 'cash',
        openingBalanceCents: 0,
        archived: false,
        createdAt: new Date().toISOString(),
      },
    ],
    categories,
    transactions: [],
    budgets: [],
    recurringRules: [],
    occurrences: [],
    settings: { theme: 'system', currency: 'CNY', timeZone: 'Asia/Shanghai', lastBackupAt: null },
  };
}
