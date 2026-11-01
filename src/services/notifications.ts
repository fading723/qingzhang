import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { nextOccurrences } from '../domain/recurring';
import type { LedgerState } from '../domain/types';

export interface ReminderResult {
  granted: boolean;
  scheduled: number;
}
let notificationQueue: Promise<ReminderResult> = Promise.resolve({ granted: false, scheduled: 0 });
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function schedule(state: LedgerState, requestPermission: boolean): Promise<ReminderResult> {
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('qingzhang-bills', {
      name: '账单提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission && permission.canAskAgain)
    permission = await Notifications.requestPermissionsAsync();
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const ours = existing.filter((item) => item.identifier.startsWith('qingzhang:'));
  const granted =
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const upcoming = granted ? nextOccurrences(state, new Date().toISOString(), 30) : [];
  const targetIds = new Set(upcoming.map((item) => `qingzhang:${item.id}`));
  for (const item of ours)
    if (!targetIds.has(item.identifier))
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
  if (!granted) return { granted: false, scheduled: 0 };
  for (const item of upcoming) {
    // Replace old scheduled content too, so existing reminders lose private rule names.
    const identifier = `qingzhang:${item.id}`;
    if (ours.some((scheduled) => scheduled.identifier === identifier))
      await Notifications.cancelScheduledNotificationAsync(identifier);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: '有一笔账单待确认',
        body: '请打开青账查看并确认周期账单。',
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(item.scheduledAt),
        channelId: 'qingzhang-bills',
      },
    });
  }
  return { granted: true, scheduled: upcoming.length };
}

export function scheduleReminders(state: LedgerState): Promise<ReminderResult> {
  const work = notificationQueue
    .catch(() => ({ granted: false, scheduled: 0 }))
    .then(() => schedule(state, true));
  notificationQueue = work;
  return work;
}

/** Refresh on rule edits, restore, and foregrounding; never prompts for permission. */
export function syncReminders(state: LedgerState): Promise<ReminderResult> {
  const work = notificationQueue
    .catch(() => ({ granted: false, scheduled: 0 }))
    .then(() => schedule(state, false));
  notificationQueue = work;
  return work;
}
