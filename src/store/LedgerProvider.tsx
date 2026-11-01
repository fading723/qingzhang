import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LedgerState } from '../domain/types';
import { loadLedger, persistLedger } from '../data/repository';

type ContextValue = {
  state: LedgerState;
  busy: boolean;
  mutate: (recipe: (current: LedgerState) => LedgerState) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
};
const Context = createContext<ContextValue | null>(null);
export function useLedger() {
  const value = useContext(Context);
  if (!value) throw new Error('账本尚未加载');
  return value;
}
export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LedgerState | null>(null);
  const current = useRef<LedgerState | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [failure, setFailure] = useState('');
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (message: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, error });
    timer.current = setTimeout(() => setToast(null), 4000);
  };
  const load = async () => {
    setFailure('');
    try {
      const loaded = await loadLedger();
      current.current = loaded;
      setState(loaded);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '无法打开本地账本');
    }
  };
  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const mutate: ContextValue['mutate'] = (recipe) => {
    setPending((n) => n + 1);
    const task = queue.current
      .catch(() => {})
      .then(async () => {
        if (!current.current) throw new Error('账本尚未加载');
        const previous = current.current;
        const next = recipe(previous);
        if (next === previous) return;
        await persistLedger(next, previous);
        current.current = next;
        setState(next);
      });
    queue.current = task;
    return task.finally(() => setPending((n) => n - 1));
  };
  if (!state)
    return (
      <View style={styles.loading}>
        <Text style={styles.brand}>青账</Text>
        <Text style={styles.tagline}>让每一笔，都心中有数。</Text>
        {failure ? (
          <>
            <Text style={styles.error}>{failure}</Text>
            <Pressable onPress={load} style={styles.retry}>
              <Text style={{ color: 'white' }}>重新打开账本</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color="#16846B" style={{ marginTop: 32 }} />
        )}
      </View>
    );
  return (
    <Context.Provider value={{ state, busy: pending > 0, mutate, notify }}>
      {children}
      {toast && (
        <View
          pointerEvents="none"
          style={[styles.toast, toast.error && { backgroundColor: '#9C4242' }]}
        >
          <Text accessibilityLiveRegion="polite" style={styles.toastText}>
            {toast.message}
          </Text>
        </View>
      )}
    </Context.Provider>
  );
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#F4F7F5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  brand: { fontSize: 48, color: '#16846B', fontWeight: '800', letterSpacing: 5 },
  tagline: { marginTop: 12, color: '#7B8F87' },
  error: { color: '#C45050', marginTop: 28, textAlign: 'center' },
  retry: { backgroundColor: '#16846B', borderRadius: 14, padding: 16, marginTop: 20 },
  toast: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: '#183C34',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    zIndex: 10000,
    elevation: 30,
  },
  toastText: { color: '#FFFFFF', textAlign: 'center', fontSize: 14, lineHeight: 21 },
});
