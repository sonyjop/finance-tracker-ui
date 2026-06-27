import { db } from './db';

export async function queueMutation(type, itemData) {
  if (type === 'INSERT') await db.lineItems.put(itemData);
  else if (type === 'UPDATE') await db.lineItems.update(itemData.id, itemData);
  
  await db.syncQueue.add({ type, data: itemData, timestamp: Date.now() });
  triggerSync();
}

export async function queueRecurrenceChange(recData) {
  await db.recurrences.put(recData);
  await db.syncQueue.add({ type: 'RECURRENCE_CHANGE', data: recData, timestamp: Date.now() });
  triggerSync();
}

export async function triggerSync() {
  if (!navigator.onLine) return;

  const queue = await db.syncQueue.toArray();
  const token = localStorage.getItem('auth_token');
  const webAppUrl = localStorage.getItem('apps_script_url');
  if (!token || !webAppUrl) return;

  const currentMonth = new Date().toISOString().substring(0, 7);
  const recurrenceDefinitions = await db.recurrences.toArray();

  const payload = {
    auth: token,
    currentMonth,
    queue,
    recurrenceDefinitions
  };

  try {
    const response = await fetch(`${webAppUrl}?action=syncData`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (result.success) {
      await db.syncQueue.clear();
      await db.lineItems.clear();
      await db.lineItems.bulkPut(result.lineItems);
      
      await db.recurrences.clear();
      await db.recurrences.bulkPut(result.recurrenceDefinitions);
      
      window.dispatchEvent(new CustomEvent('sync-completed'));
    }
  } catch (error) {
    console.error("Sync Failure:", error);
  }
}
window.addEventListener('online', triggerSync);