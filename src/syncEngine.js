import { db } from './db';

let syncInProgress = false;

export async function forceFullCloudSync(targetYear) {
  // Prevent overlapping background threads from competing
  if (syncInProgress) {
    console.warn("Sync already active. Deferring network replication task loop.");
    return;
  }
  if (!navigator.onLine) return;

  const token = localStorage.getItem('auth_token');
  const webAppUrl = localStorage.getItem('apps_script_url');
  if (!token || !webAppUrl) return;

  syncInProgress = true;

  try {
    // 1. Gather snapshots of queues safely before initiating transmission
    const queue = await db.syncQueue.toArray();
    const masterRecurrences = await db.recurrences.toArray();

    // 2. Post out data state changes to Google Apps Script
    const persistResponse = await fetch(`${webAppUrl}?action=persistState`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ auth: token, queue, masterRecurrences })
    });
    
    const persistResult = await persistResponse.json();
    if (persistResult.error) throw new Error(persistResult.error);

    // 3. Clear only the specific queue records processed successfully
    const processedQueueIds = queue.map(q => q.queueId);
    await db.syncQueue.where('queueId').anyOf(processedQueueIds).delete();

    // 4. Download structural ledger reality tables
    const response = await fetch(`${webAppUrl}?action=fetchState`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ auth: token, year: targetYear })
    });
    
    const cloudState = await response.json();
    if (cloudState.error) throw new Error(cloudState.error);

    // 5. Apply clean master swap write updates to the client cache
    await db.transaction('rw', [db.lineItems, db.recurrences], async () => {
      await db.lineItems.clear();
      if (cloudState.lineItems && cloudState.lineItems.length > 0) {
        await db.lineItems.bulkPut(cloudState.lineItems);
      }

      await db.recurrences.clear();
      if (cloudState.recurrenceDefinitions && cloudState.recurrenceDefinitions.length > 0) {
        await db.recurrences.bulkPut(cloudState.recurrenceDefinitions);
      }
    });

    // 6. Notify active view components
    window.dispatchEvent(new CustomEvent('sync-completed'));
  } catch (error) {
    console.error("Critical client synchronization engine checkpoint failed:", error);
  } finally {
    syncInProgress = false;
  }
}

window.addEventListener('online', () => {
  const currentYear = new Date().toISOString().substring(0, 4);
  forceFullCloudSync(currentYear);
});