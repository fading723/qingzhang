import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LedgerProvider, useLedger } from './src/store/LedgerProvider';
import { useTheme } from './src/ui/theme';
import { Icon } from './src/ui/components';
import { HomeScreen } from './src/screens/HomeScreen';
import { BillsScreen } from './src/screens/BillsScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ManageScreen, ManageSection } from './src/screens/ManageScreen';
import { EntrySheet, EntryRequest } from './src/screens/EntrySheet';
import { DetailSheet } from './src/screens/DetailSheet';
import { Transaction, TransactionFilter } from './src/domain/types';
import { syncReminders } from './src/services/notifications';

type Tab = 'home' | 'bills' | 'reports' | 'profile';
const tabs: { id: Tab; label: string; icon: string; activeIcon: string }[] = [
  { id: 'home', label: '首页', icon: 'home-outline', activeIcon: 'home' },
  { id: 'bills', label: '账单', icon: 'receipt-outline', activeIcon: 'receipt' },
  { id: 'reports', label: '统计', icon: 'pie-chart-outline', activeIcon: 'pie-chart' },
  { id: 'profile', label: '我的', icon: 'person-outline', activeIcon: 'person' },
];
function Shell() {
  const { state } = useLedger();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useWindowDimensions().width >= 1024;
  const [tab, setTab] = useState<Tab>('home');
  const [section, setSection] = useState<ManageSection | null>(null);
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [filter, setFilter] = useState<TransactionFilter | undefined>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [, setClock] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (section) {
        setSection(null);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [section, tab]);
  useEffect(() => {
    void syncReminders(state).catch(() => {});
  }, [state.recurringRules, state.occurrences]);
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 60000);
    const listener = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        setClock((n) => n + 1);
        void syncReminders(stateRef.current).catch(() => {});
      }
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  const navigate = (next: Tab) => {
    setSection(null);
    setTab(next);
    if (next === 'bills') setFilter(undefined);
  };
  const drill = (next: TransactionFilter) => {
    setFilter(next);
    setSection(null);
    setTab('bills');
  };
  const navItem = (item: (typeof tabs)[number]) => (
    <Pressable
      key={item.id}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === item.id && !section }}
      accessibilityLabel={item.label}
      onPress={() => navigate(item.id)}
      style={({ pressed }) => [
        desktop ? styles.sideItem : styles.tabItem,
        {
          backgroundColor:
            desktop && tab === item.id && !section ? colors.primarySoft : 'transparent',
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <Icon
        name={tab === item.id && !section ? item.activeIcon : item.icon}
        color={tab === item.id && !section ? colors.primary : colors.muted}
        size={desktop ? 21 : 22}
      />
      <Text
        style={{
          color: tab === item.id && !section ? colors.primary : colors.muted,
          fontSize: desktop ? 14 : 10,
          fontWeight: tab === item.id ? '700' : '500',
        }}
      >
        {item.label}
      </Text>
      {desktop && tab === item.id && !section && (
        <View
          style={{
            height: 6,
            width: 6,
            borderRadius: 3,
            backgroundColor: colors.primary,
            marginLeft: 'auto',
          }}
        />
      )}
    </Pressable>
  );
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        flexDirection: desktop ? 'row' : 'column',
      }}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {desktop && (
        <View
          style={[
            styles.sidebar,
            { backgroundColor: colors.surface, borderRightColor: colors.border },
          ]}
        >
          <View style={styles.brand}>
            <View style={[styles.brandIcon, { backgroundColor: colors.primary }]}>
              <Icon name="leaf" color={isDark ? '#173F35' : '#FFFFFF'} size={26} />
            </View>
            <View>
              <Text
                style={{ fontSize: 25, fontWeight: '800', letterSpacing: 3, color: colors.text }}
              >
                青账
              </Text>
              <Text style={{ fontSize: 9, letterSpacing: 2, color: colors.muted, marginTop: 5 }}>
                QINGZHANG
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: colors.muted,
              fontSize: 10,
              letterSpacing: 2,
              marginBottom: 18,
              marginTop: 42,
              paddingLeft: 14,
            }}
          >
            我的账本
          </Text>
          {tabs.map(navItem)}
          <Pressable
            onPress={() => setEntry({})}
            accessibilityLabel="记一笔"
            style={[styles.sideAdd, { backgroundColor: colors.primary }]}
          >
            <Icon name="add" color={isDark ? '#173F35' : 'white'} size={22} />
            <Text style={{ color: isDark ? '#173F35' : 'white', fontWeight: '700', fontSize: 14 }}>
              记一笔
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={[styles.sideFoot, { backgroundColor: colors.bg }]}>
            <Icon name="shield-checkmark-outline" color={colors.primary} size={20} />
            <Text style={{ color: colors.text, fontWeight: '600', fontSize: 12, marginTop: 10 }}>
              安心记录，自在生活
            </Text>
            <Text style={{ color: colors.muted, fontSize: 10, lineHeight: 18, marginTop: 5 }}>
              数据保存在本机{'\n'}每一笔，都由你掌握
            </Text>
          </View>
          <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 9, marginTop: 20 }}>
            青账 1.0 · 简单生活，认真记录
          </Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        {section ? (
          <ManageScreen key={section} section={section} onBack={() => setSection(null)} />
        ) : tab === 'home' ? (
          <HomeScreen
            onAdd={() => setEntry({})}
            onTransaction={setDetail}
            onBills={() => navigate('bills')}
            onManage={setSection}
          />
        ) : tab === 'bills' ? (
          <BillsScreen initialFilter={filter} onTransaction={setDetail} />
        ) : tab === 'reports' ? (
          <ReportsScreen onDrill={drill} onTransaction={setDetail} />
        ) : (
          <ProfileScreen onManage={setSection} />
        )}
      </View>
      {!desktop && (
        <View
          style={[
            styles.bottomNav,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 9),
            },
          ]}
        >
          {tabs.slice(0, 2).map(navItem)}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="记一笔"
              onPress={() => setEntry({})}
              style={[
                styles.addButton,
                { backgroundColor: colors.primary, shadowColor: colors.primary },
              ]}
            >
              <Icon name="add" color={isDark ? '#173F35' : 'white'} size={29} />
            </Pressable>
            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700', marginTop: 3 }}>
              记一笔
            </Text>
          </View>
          {tabs.slice(2).map(navItem)}
        </View>
      )}
      <EntrySheet request={entry} onClose={() => setEntry(null)} />
      <DetailSheet transaction={detail} onClose={() => setDetail(null)} onEdit={setEntry} />
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <LedgerProvider>
        <Shell />
      </LedgerProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  sidebar: {
    width: 224,
    paddingHorizontal: 22,
    paddingTop: 38,
    paddingBottom: 28,
    borderRightWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 8 },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 15,
    borderRadius: 13,
    marginBottom: 6,
  },
  sideAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 14,
    borderRadius: 13,
    marginTop: 30,
  },
  sideFoot: { borderRadius: 17, padding: 17 },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  tabItem: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 5 },
  addButton: {
    height: 48,
    width: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -19,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.23,
    shadowRadius: 8,
    elevation: 4,
  },
});
