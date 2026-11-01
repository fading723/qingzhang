import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { localDateTime, toInstant } from '../domain/time';
import { useTheme } from './theme';
import { Icon } from './components';

export function DateTimeField({
  value,
  onChange,
  label = '消费时间',
}: {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const { colors, isDark } = useTheme();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const formatted = localDateTime(value);
  const change = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setMode(null);
    if (event.type === 'set' && selected) onChange(selected.toISOString());
  };
  return (
    <View style={{ marginBottom: 15, gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted }}>
        {label} · 北京时间
      </Text>
      {Platform.OS === 'web' ? (
        React.createElement('input', {
          type: 'datetime-local',
          'aria-label': label,
          value: formatted,
          onChange: (event: { target: { value: string } }) => {
            const text = event.target.value;
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
              try {
                onChange(toInstant(text));
              } catch {}
            }
          },
          style: {
            colorScheme: isDark ? 'dark' : 'light',
            background: colors.surfaceAlt,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            padding: '13px 14px',
            borderRadius: 12,
            fontFamily: 'inherit',
            fontSize: 15,
            minWidth: 0,
            boxSizing: 'border-box',
            width: '100%',
          },
        })
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessibilityLabel="选择日期"
              onPress={() => setMode('date')}
              style={{
                flex: 1,
                flexDirection: 'row',
                gap: 9,
                backgroundColor: colors.surfaceAlt,
                padding: 14,
                borderRadius: 12,
              }}
            >
              <Icon name="calendar-outline" size={19} color={colors.primary} />
              <Text style={{ color: colors.text }}>{formatted.slice(0, 10)}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="选择时分"
              onPress={() => setMode('time')}
              style={{
                flexDirection: 'row',
                gap: 9,
                backgroundColor: colors.surfaceAlt,
                padding: 14,
                borderRadius: 12,
              }}
            >
              <Icon name="time-outline" size={19} color={colors.primary} />
              <Text style={{ color: colors.text }}>{formatted.slice(11, 16)}</Text>
            </Pressable>
          </View>
          {mode && (
            <DateTimePicker
              value={new Date(value)}
              mode={mode}
              is24Hour
              timeZoneName="Asia/Shanghai"
              locale="zh-CN"
              themeVariant={isDark ? 'dark' : 'light'}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={change}
            />
          )}
          {mode && Platform.OS === 'ios' && (
            <Pressable onPress={() => setMode(null)}>
              <Text style={{ color: colors.primary, textAlign: 'right', padding: 9 }}>
                完成选择
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}
