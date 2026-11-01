import type { LedgerState } from '../domain/types';
export interface ReminderResult {
  granted: boolean;
  scheduled: number;
}
// Web is a local visual preview; reliable device scheduling is provided by the native App.
export async function scheduleReminders(_state: LedgerState): Promise<ReminderResult> {
  return { granted: false, scheduled: 0 };
}
export async function syncReminders(_state: LedgerState): Promise<ReminderResult> {
  return { granted: false, scheduled: 0 };
}
