import React from 'react';
import { Text, View } from 'react-native';
import { useLedger } from '../../store/LedgerProvider';
import { Card, Choice, Hint, Icon, SectionTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { Choices, ItemRow, useTask } from './common';

export function Settings() {
  const { state, mutate } = useLedger();
  const { colors } = useTheme();
  const { run } = useTask();
  return (
    <>
      <SectionTitle title="外观" />
      <Card>
        <Hint>选择你喜欢的明暗，让每次记账都舒适。</Hint>
        <Choices>
          {(
            [
              { value: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
              { value: 'light', label: '浅色', icon: 'sunny-outline' },
              { value: 'dark', label: '深色', icon: 'moon-outline' },
            ] as const
          ).map((option) => (
            <Choice
              key={option.value}
              label={option.label}
              icon={option.icon}
              active={state.settings.theme === option.value}
              onPress={() =>
                run(async () => {
                  await mutate((s) => ({ ...s, settings: { ...s.settings, theme: option.value } }));
                })
              }
            />
          ))}
        </Choices>
      </Card>
      <SectionTitle title="账本习惯" />
      <Card>
        <ItemRow icon="cash-outline" title="人民币 · CNY" subtitle="金额精确到分" />
        <ItemRow
          icon="time-outline"
          title="北京时间"
          subtitle="消费时间记录到分钟，旅行时历史归属不变"
        />
        <ItemRow
          icon="calendar-outline"
          title="周一开始新的一周"
          subtitle="月报与年报按自然月、自然年汇总"
        />
      </Card>
      <SectionTitle title="隐私与数据" />
      <Card tint>
        <ItemRow
          icon="lock-closed-outline"
          title="无账号，也能安心记账"
          subtitle="无需注册，不上传账本，不包含广告和行为统计。"
        />
        <Hint>
          数据保存在当前设备，卸载应用可能失去账本。建议定期在“数据与备份”中导出完整备份，换手机时再导入。
        </Hint>
      </Card>
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 9 }}>
        <Icon name="leaf" size={29} color={colors.primary} />
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 23, letterSpacing: 4 }}>
          青账
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>让每一笔，都心中有数。</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>
          版本 1.0.0 · 本机账本
        </Text>
      </View>
    </>
  );
}
