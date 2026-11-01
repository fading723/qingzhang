import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLedger } from '../store/LedgerProvider';
import { localDateTime } from '../domain/time';
import { Card, Icon, Screen } from '../ui/components';
import { useTheme } from '../ui/theme';
import { ManageSection } from './ManageScreen';

export function ProfileScreen({ onManage }: { onManage: (section: ManageSection) => void }) {
  const { state } = useLedger();
  const { colors } = useTheme();
  const options: { key: ManageSection; label: string; description: string; icon: string }[] = [
    {
      key: 'accounts',
      label: '我的账户',
      description: '现金、银行卡、微信、支付宝与信用卡',
      icon: 'wallet-outline',
    },
    {
      key: 'categories',
      label: '收支分类',
      description: '把每一笔钱，放在合适的位置',
      icon: 'grid-outline',
    },
    {
      key: 'budgets',
      label: '预算计划',
      description: '安排月总预算与分类额度',
      icon: 'pie-chart-outline',
    },
    {
      key: 'recurring',
      label: '周期账单',
      description: '房租、订阅、工资，到期记得确认',
      icon: 'repeat-outline',
    },
    {
      key: 'data',
      label: '备份与迁移',
      description: '保存完整账本，导入与导出流水',
      icon: 'cloud-download-outline',
    },
    {
      key: 'settings',
      label: '外观与关于',
      description: '浅色、深色，跟随你的习惯',
      icon: 'color-palette-outline',
    },
  ];
  return (
    <Screen eyebrow="你的账本，由你掌握" title="我的" subtitle="简单记录，认真生活。">
      <Card tint>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 17 }}>
          <View
            style={{
              height: 62,
              width: 62,
              borderRadius: 22,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="leaf-outline" size={34} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>青账</Text>
            <Text style={{ fontSize: 12, color: colors.primary, marginTop: 8 }}>
              个人账本 · 本机保存 · 无需登录
            </Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            marginTop: 22,
            paddingTop: 20,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {[
            { label: '已记录', value: `${state.transactions.length} 笔` },
            { label: '资金账户', value: `${state.accounts.filter((a) => !a.archived).length} 个` },
            { label: '记账币种', value: '人民币' },
          ].map((i) => (
            <View key={i.label} style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{i.label}</Text>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 6 }}>
                {i.value}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <Card style={{ paddingVertical: 5 }}>
        {options.map((item, index) => (
          <Pressable
            accessibilityRole="button"
            key={item.key}
            onPress={() => onManage(item.key)}
            style={({ pressed }) => ({
              paddingVertical: 19,
              flexDirection: 'row',
              gap: 14,
              alignItems: 'center',
              borderBottomWidth: index === options.length - 1 ? 0 : 1,
              borderBottomColor: colors.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 39,
                height: 39,
                backgroundColor: colors.surfaceAlt,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={item.icon} size={21} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                {item.label}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 17 }}>
                {item.description}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </Card>
      <View style={{ alignItems: 'center', gap: 8, padding: 18 }}>
        <Icon name="shield-checkmark-outline" color={colors.muted} size={18} />
        <Text style={{ fontSize: 11, color: colors.muted }}>
          没有广告，没有上传，只有你的生活。
        </Text>
        <Text style={{ fontSize: 10, color: colors.muted, marginTop: 3 }}>
          {state.settings.lastBackupAt
            ? `上次备份 ${localDateTime(state.settings.lastBackupAt).replace('T', ' ')}`
            : '还没有备份过账本，记得定期保存一份。'}
        </Text>
      </View>
    </Screen>
  );
}
