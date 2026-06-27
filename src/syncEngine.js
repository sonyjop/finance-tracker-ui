import { db } from './db';

export async function queueMutation(type, itemData) {
  // 1. Optimistic UI updates written immediately to IndexedDB
  if (type === 'INSERT') {
    await db.lineItems.put(itemData);
  } else if (type === 'UPDATE') {
    await db.lineItems.update(itemData.id, itemData);
  }

  // 2. Schedule inside the synchronization queue
  await db.syncQueue.add({
    type: type,
    data: itemData,
    timestamp: Date.now()
  });

  // 3. Dispatch an async task runner
  triggerSync();
}

export async function triggerSync() {
  if (!navigator.onLine) return;

  const queue = await db.syncQueue.toArray();
  const token = localStorage.getItem('auth_token');
  const webAppUrl = localStorage.getItem('apps_script_url');
  
  if (!token || !webAppUrl) return;

  const currentMonth = new Date().toISOString().substring(0, 7);

  const payload = {
    auth: token,
    currentMonth: currentMonth,
    queue: queue
  };

  try {
    const response = await fetch(`${webAppUrl}?action=syncData`, {
      method: 'POST',
      mode: 'cors',
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (result.success) {
      await db.syncQueue.clear();
      
      // Overwrite local memory caches with the cloud state
      await db.lineItems.clear();
      await db.lineItems.bulkPut(result.lineItems);
      await db.metadata.put({ key: 'annualSummary', value: result.annualSummary });
      
      window.dispatchEvent(new CustomEvent('sync-completed'));
    }
  } catch (error) {
    console.error("Sync Engine error:", error);
  }
}

// Automatically bind system reconciliation tasks when connectivity drops out and resumes
window.addEventListener('online', triggerSync);