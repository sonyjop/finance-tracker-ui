import Dexie from 'dexie';

export const db = new Dexie('FinanceTrackerDB');
db.version(2).stores({
  lineItems: 'id, date, type, status, recurrence_id',
  recurrences: 'recurrence_id, start_month',
  syncQueue: '++queueId, type, timestamp',
  metadata: 'key'
});