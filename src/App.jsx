import React, { useState, useEffect } from 'react';
import { db } from './db';
import { queueMutation, queueRecurrenceChange, triggerSync } from './syncEngine';

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('auth_token'));
  const [tokenInput, setTokenInput] = useState('');
  const [urlInput, setUrlInput] = useState('');

  const [activeTab, setActiveTab] = useState('ledger'); 
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  
  const [lineItems, setLineItems] = useState([]);
  const [recurrences, setRecurrences] = useState([]);
  const [monthSummary, setMonthSummary] = useState({ income: { actual: 0, planned: 0 }, expense: { actual: 0, planned: 0 } });

  const [isAdding, setIsAdding] = useState(false);
  const [isAddingRecurrence, setIsAddingRecurrence] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form Field Buffers
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('EXPENSE');
  const [status, setStatus] = useState('PLANNED');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [payMode, setPayMode] = useState(PAYMENT_MODES[0]);
  const [intervalMonths, setIntervalMonths] = useState('1');

  // Inline Editing Form Buffers
  const [editPlannedAmount, setEditPlannedAmount] = useState('');
  const [editActualAmount, setEditActualAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPayMode, setEditPayMode] = useState('');
  const [editStatus, setEditStatus] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      loadLocalState();
      triggerSync();
      const handleSync = () => loadLocalState();
      window.addEventListener('sync-completed', handleSync);
      return () => window.removeEventListener('sync-completed', handleSync);
    }
  }, [isAuthenticated, selectedMonth]);

  const loadLocalState = async () => {
    const allItems = await db.lineItems.toArray();
    const filtered = allItems.filter(item => item.date.substring(0, 7) === selectedMonth);
    setLineItems(filtered.sort((a, b) => b.date.localeCompare(a.date)));

    let metrics = { income: { actual: 0, planned: 0 }, expense: { actual: 0, planned: 0 } };
    filtered.forEach(item => {
      const cat = item.type.toLowerCase();
      metrics[cat].actual += Number(item.actual_amount) || 0;
      metrics[cat].planned += Number(item.planned_amount) || 0;
    });
    setMonthSummary(metrics);

    const recs = await db.recurrences.toArray();
    setRecurrences(recs);
  };

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    
    const newEntry = {
      id: crypto.randomUUID(), 
      type, 
      date, 
      planned_amount: parsedAmount,
      actual_amount: status === 'ACTUAL' ? parsedAmount : 0,
      description, 
      status, 
      payment_mode: payMode, 
      created_at: new Date().toISOString()
    };
    await queueMutation('INSERT', newEntry);
    setIsAdding(false);
    clearFormFields();
    loadLocalState();
  };

  const handleSaveRecurrence = async (e) => {
    e.preventDefault();
    const newRec = {
      recurrence_id: crypto.randomUUID(), description, amount: parseFloat(amount),
      type, interval_months: parseInt(intervalMonths), start_month: selectedMonth, version: 1, is_active: true
    };
    await queueRecurrenceChange(newRec);
    setIsAddingRecurrence(false);
    clearFormFields();
    loadLocalState();
  };

  const startInlineEdit = (item) => {
    setEditingId(item.id);
    setEditPlannedAmount(item.planned_amount);
    setEditActualAmount(item.actual_amount);
    setEditDesc(item.description);
    setEditPayMode(item.payment_mode || PAYMENT_MODES[0]);
    setEditStatus(item.status);
  };

  const saveInlineEdit = async (item) => {
    const updated = {
      ...item, 
      planned_amount: parseFloat(editPlannedAmount), 
      actual_amount: parseFloat(editActualAmount), 
      description: editDesc, 
      payment_mode: editPayMode, 
      status: editStatus
    };
    await queueMutation('UPDATE', updated);
    setEditingId(null);
    loadLocalState();
  };

  const toggleCheckmarkStatus = async (item) => {
    const isSettling = item.status === 'PLANNED';
    const nextStatus = isSettling ? 'ACTUAL' : 'PLANNED';
    
    const updated = { 
      ...item, 
      status: nextStatus,
      actual_amount: isSettling ? item.planned_amount : 0 
    };
    await queueMutation('UPDATE', updated);
    loadLocalState();
  };

  const handleDeleteEntry = async (item) => {
    if (window.confirm(`Are you sure you want to delete "${item.description}"?`)) {
      await db.lineItems.delete(item.id);
      await queueMutation('DELETE', item);
      loadLocalState();
    }
  };

  const modifyRecurrenceAmount = async (rec, nextAmount) => {
    const nextVersion = { ...rec, amount: parseFloat(nextAmount), version: rec.version + 1 };
    await queueRecurrenceChange(nextVersion);
    loadLocalState();
  };

  const clearFormFields = () => {
    setAmount(''); setDescription(''); setType('EXPENSE'); setStatus('PLANNED');
    setDate(new Date().toISOString().substring(0, 10)); setPayMode(PAYMENT_MODES[0]); setIntervalMonths('1');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <form onSubmit={(e) => { e.preventDefault(); if(tokenInput && urlInput) { localStorage.setItem('auth_token', tokenInput); localStorage.setItem('apps_script_url', urlInput); setIsAuthenticated(true); } }} className="bg-white p-6 rounded-xl shadow-md w-full max-w-md">
          <h2 className="text-xl font-bold mb-4 text-gray-800">Secure Cloud Access Configuration</h2>
          <input type="password" placeholder="Passphrase Token" value={tokenInput} onChange={e => setTokenInput(e.target.value)} className="w-full border p-3 rounded mb-3" required />
          <input type="url" placeholder="Google Deployment Exec URL" value={urlInput} onChange={e => setUrlInput(e.target.value)} className="w-full border p-3 rounded mb-4" required />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded font-bold">Connect Ledger Ecosystem</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 pb-24">
      {/* Dynamic Selector Header Panel with Logout Context UI Utilities */}
      <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40 max-w-lg mx-auto rounded-b-xl flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide opacity-90">Window:</span>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-blue-700 text-white font-bold p-1 rounded border border-blue-500 text-sm focus:outline-none" />
          </div>
          <button 
            onClick={() => { localStorage.clear(); setIsAuthenticated(false); }} 
            className="text-xs bg-blue-700 hover:bg-red-600 border border-blue-500 px-2 py-1 rounded font-bold transition-colors"
            title="Clear System Session Keys"
          >
            Logout 🔌
          </button>
        </div>
        <div className="flex justify-center gap-4 border-t border-blue-500/50 pt-2">
          <button onClick={() => setActiveTab('ledger')} className={`flex-1 py-1 rounded text-xs font-bold text-center transition-all ${activeTab === 'ledger' ? 'bg-white text-blue-600 shadow-sm' : 'bg-blue-700 text-white'}`}>Ledger Cockpit</button>
          <button onClick={() => setActiveTab('recurrences')} className={`flex-1 py-1 rounded text-xs font-bold text-center transition-all ${activeTab === 'recurrences' ? 'bg-white text-blue-600 shadow-sm' : 'bg-blue-700 text-white'}`}>Recurring Rules</button>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4">
        {activeTab === 'ledger' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl shadow-sm">
                <span className="text-xs font-bold text-emerald-700 block mb-1">INCOME TRACKING</span>
                <div className="text-lg font-black text-emerald-900">Act: ${monthSummary.income.actual.toFixed(2)}</div>
                <div className="text-xs text-emerald-600 font-medium">Pld: ${monthSummary.income.planned.toFixed(2)}</div>
              </div>
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl shadow-sm">
                <span className="text-xs font-bold text-rose-700 block mb-1">EXPENSE VARIANCE</span>
                <div className="text-lg font-black text-rose-900">Act: ${monthSummary.expense.actual.toFixed(2)}</div>
                <div className="text-xs text-rose-600 font-medium">Pld: ${monthSummary.expense.planned.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider">Transaction Registry Table</h3>
              <button onClick={() => setIsAdding(!isAdding)} className="bg-blue-600 text-white text-xs px-3 py-2 rounded-lg font-bold shadow-sm">{isAdding ? "Close Panel" : "+ Add Transaction"}</button>
            </div>

            {isAdding && (
              <form onSubmit={handleSaveEntry} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                <input type="text" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                  <select value={payMode} onChange={e => setPayMode(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={type} onChange={e => setType(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="EXPENSE">Expense</option>
                    <option value="INCOME">Income</option>
                  </select>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="PLANNED">Planned</option>
                    <option value="ACTUAL">Actual</option>
                  </select>
                </div>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                <button type="submit" className="w-full bg-emerald-600 text-white p-2 text-sm font-bold rounded-lg shadow-sm">Save Transaction Object</button>
              </form>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {lineItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400 font-medium">No records found.</div>
              ) : (
                lineItems.map(item => (
                  <div key={item.id} className="p-3 transition-colors hover:bg-gray-50 flex flex-col gap-2">
                    {editingId === item.id ? (
                      <div className="space-y-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" placeholder="Description" />
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[10px] text-gray-400 font-bold">PLANNED AMOUNT</label>
                            <input type="number" step="0.01" value={editPlannedAmount} onChange={e => setEditPlannedAmount(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 font-bold">ACTUAL AMOUNT</label>
                            <input type="number" step="0.01" value={editActualAmount} onChange={e => setEditActualAmount(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <select value={editPayMode} onChange={e => setEditPayMode(e.target.value)} className="border bg-white p-1 text-xs rounded">
                            {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="border bg-white p-1 text-xs rounded">
                            <option value="PLANNED">Planned</option>
                            <option value="ACTUAL">Actual</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button onClick={() => setEditingId(null)} className="text-gray-500 text-xs px-2 py-1 bg-white border rounded">Cancel</button>
                          <button onClick={() => saveInlineEdit(item)} className="bg-blue-600 text-white text-xs px-2 py-1 rounded font-bold">Apply Changes</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
                            {item.description}
                            {item.recurrence_id && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold">↻ v{item.recurrence_version}</span>}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 font-medium">
                            {item.date} • <span className="text-gray-500 font-bold">{item.payment_mode || "Unspecified"}</span> • <span className={item.type === 'INCOME' ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{item.type}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className={`text-sm font-black block ${item.type === 'INCOME' ? 'text-emerald-600' : 'text-gray-800'}`}>
                              {item.type === 'EXPENSE' ? '-' : '+'}${Number(item.actual_amount || 0).toFixed(2)}
                            </span>
                            <span className="text-[10px] text-gray-400 font-semibold block">Pld: ${Number(item.planned_amount || 0).toFixed(2)}</span>
                          </div>
                          <button onClick={() => startInlineEdit(item)} className="text-gray-400 hover:text-blue-600 text-xs p-1">✏️</button>
                          <button onClick={() => handleDeleteEntry(item)} className="text-gray-400 hover:text-rose-600 text-xs p-1" title="Delete Row">🗑️</button>
                          <button onClick={() => toggleCheckmarkStatus(item)} className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold shadow-sm transition-all ${item.status === 'ACTUAL' ? 'bg-emerald-500 border-emerald-600 text-white' : 'border-amber-500 text-amber-600 bg-amber-50'}`}>
                            {item.status === 'ACTUAL' ? '✓' : '⏳'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider">Global Recurrence Rules</h3>
              <button onClick={() => setIsAddingRecurrence(!isAddingRecurrence)} className="bg-purple-600 text-white text-xs px-3 py-2 rounded-lg font-bold shadow-sm">{isAddingRecurrence ? "Close Form" : "+ Construct Rule"}</button>
            </div>

            {isAddingRecurrence && (
              <form onSubmit={handleSaveRecurrence} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                <input type="text" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                  <select value={type} onChange={e => setType(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="EXPENSE">Expense Matrix</option>
                    <option value="INCOME">Income Source</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 block mb-1">Execution Interval (Months)</label>
                  <select value={intervalMonths} onChange={e => setIntervalMonths(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="1">Every Month</option>
                    <option value="2">Every 2 Months</option>
                    <option value="3">Quarterly</option>
                    <option value="6">Semi-Annually</option>
                    <option value="12">Annually</option>
                  </select>
                </div>
                <button type="submit" className="w-full bg-purple-600 text-white p-2 text-sm font-bold rounded-lg shadow-sm">Initialize Rule Matrix Instance</button>
              </form>
            )}

            <div className="bg-white border rounded-xl shadow-sm divide-y divide-gray-100 overflow-hidden">
              {recurrences.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400 font-medium">No system metrics active inside configs.</div>
              ) : (
                recurrences.map(rec => (
                  <div key={rec.recurrence_id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                    <div>
                      <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        {rec.description}
                        <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black">INTERVAL: {rec.interval_months}M</span>
                      </div>
                      <div className="text-xs text-gray-400 font-medium mt-0.5">Origin Window: {rec.start_month} • Track: v{rec.version}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" step="0.01" value={rec.amount} 
                        onChange={e => modifyRecurrenceAmount(rec, e.target.value)}
                        className="w-20 text-right border p-1 text-xs font-bold rounded bg-gray-50 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around p-2 shadow-lg max-w-lg mx-auto rounded-t-xl z-50">
        <button onClick={() => setActiveTab('ledger')} className={`flex flex-col items-center p-2 text-xs font-semibold ${activeTab === 'ledger' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">1. 📃</span>Ledger Cockpit
        </button>
        <button onClick={() => setActiveTab('recurrences')} className={`flex flex-col items-center p-2 text-xs font-semibold ${activeTab === 'recurrences' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">2. ⚙️</span>Recurring Rules
        </button>
      </nav>
    </div>
  );
}