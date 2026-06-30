import React, { useState, useEffect, useCallback } from 'react';
import { db } from './db';
import { forceFullCloudSync } from './syncEngine';

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
  const [editingRecId, setEditingRecId] = useState(null);

  // Transaction Form Field Buffers
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('EXPENSE');
  const [status, setStatus] = useState('PLANNED');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [payMode, setPayMode] = useState(PAYMENT_MODES[0]);

  // Recurrence Form Field Buffers
  const [recDesc, setRecDesc] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recType, setRecType] = useState('EXPENSE');
  const [intervalMonths, setIntervalMonths] = useState('1');
  const [maxOccurrences, setMaxOccurrences] = useState('');

  // Inline Editing Buffer Nodes (Transactions)
  const [editPlannedAmount, setEditPlannedAmount] = useState('');
  const [editActualAmount, setEditActualAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPayMode, setEditPayMode] = useState('');
  const [editStatus, setEditStatus] = useState('');

  // Inline Editing Buffer Nodes (Recurrence Rules Console)
  const [editRecRuleDesc, setEditRecRuleDesc] = useState('');
  const [editRecRuleAmount, setEditRecRuleAmount] = useState('');
  const [editRecRuleType, setEditRecRuleType] = useState('EXPENSE');
  const [editRecRuleInterval, setEditRecRuleInterval] = useState('1');
  const [editRecRuleStartMonth, setEditRecRuleStartMonth] = useState('');
  const [editRecRuleMaxOcc, setEditRecRuleMaxOcc] = useState('');

  const activeYear = selectedMonth.split("-")[0];

  // Core Calculator Utilities Isolated safely
  const calculateFinancialYear = (dateStr) => {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return m >= 4 ? `${y}-${y+1}` : `${y-1}-${y}`;
  };

  const getFinancialYearMonths = (yearStr) => {
    const start = Number(yearStr);
    return [
      `${start}-04`,`${start}-05`,`${start}-06`,`${start}-07`,`${start}-08`,`${start}-09`,
      `${start}-10`,`${start}-11`,`${start}-12`,`${start+1}-01`,`${start+1}-02`,`${start+1}-03`
    ];
  };

  const checkRuleMatch = (rec, targetMonth) => {
    if (!rec.is_active || targetMonth < rec.start_month) return false;
    const [sY, sM] = rec.start_month.split("-").map(Number);
    const [tY, tM] = targetMonth.split("-").map(Number);
    const diff = (tY - sY) * 12 + (tM - sM);
    if (diff % rec.interval_months !== 0) return false;
    if (rec.max_occurrences && (diff / rec.interval_months) >= rec.max_occurrences) return false;
    return true;
  };

  const calculateAndRenderLocalUI = useCallback(async () => {
    const allItems = await db.lineItems.toArray();
    const currentCachedRecs = await db.recurrences.toArray();
    const targetFYMonths = getFinancialYearMonths(activeYear);
    const missingPlannings = [];

    // Evaluate rule projections sequentially
    for (const mStr of targetFYMonths) {
      const monthMatches = allItems.filter(i => i.date.substring(0, 7) === mStr);
      const mappedIds = monthMatches.map(i => i.recurrence_id);

      for (const rec of currentCachedRecs) {
        if (checkRuleMatch(rec, mStr) && !mappedIds.includes(rec.recurrence_id)) {
          const generatedRow = {
            id: crypto.randomUUID(), type: rec.type, date: `${mStr}-01`, planned_amount: rec.amount, actual_amount: 0,
            description: rec.description, payment_mode: "UPI", status: "PLANNED",
            financial_year: calculateFinancialYear(`${mStr}-01`), created_at: new Date().toISOString(),
            recurrence_id: rec.recurrence_id, recurrence_version: rec.version
          };
          missingPlannings.push(generatedRow);
        }
      }
    }

    if (missingPlannings.length > 0) {
      await db.lineItems.bulkPut(missingPlannings);
      for (const row of missingPlannings) {
        await db.syncQueue.add({ command: 'INSERT_ROW', year: row.date.split("-")[0], month: row.date.substring(0,7), data: row });
      }
      return calculateAndRenderLocalUI(); // Loop resolution
    }

    const filtered = allItems.filter(item => item.date.substring(0, 7) === selectedMonth);
    setLineItems(filtered.sort((a, b) => b.date.localeCompare(a.date)));

    let metrics = { income: { actual: 0, planned: 0 }, expense: { actual: 0, planned: 0 } };
    filtered.forEach(item => {
      const cat = item.type.toLowerCase();
      metrics[cat].actual += Number(item.actual_amount) || 0;
      metrics[cat].planned += Number(item.planned_amount) || 0;
    });
    setMonthSummary(metrics);
    setRecurrences(currentCachedRecs);
  }, [selectedMonth, activeYear]);

  useEffect(() => {
    if (isAuthenticated) {
      calculateAndRenderLocalUI();
      forceFullCloudSync(activeYear);
      const handleSync = () => calculateAndRenderLocalUI();
      window.addEventListener('sync-completed', handleSync);
      return () => window.removeEventListener('sync-completed', handleSync);
    }
  }, [isAuthenticated, selectedMonth, activeYear, calculateAndRenderLocalUI]);

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || !description.trim()) return alert("Provide absolute field validation requirements.");
    
    const row = {
      id: crypto.randomUUID(), type, date, planned_amount: val, actual_amount: status === 'ACTUAL' ? val : 0,
      description: description.trim(), status, payment_mode: payMode, financial_year: calculateFinancialYear(date), created_at: new Date().toISOString()
    };
    
    await db.lineItems.put(row);
    await db.syncQueue.add({ command: 'INSERT_ROW', year: date.split("-")[0], month: date.substring(0,7), data: row });
    setIsAdding(false); clearFormFields(); await calculateAndRenderLocalUI(); forceFullCloudSync(activeYear);
  };

  const handleSaveRecurrence = async (e) => {
    e.preventDefault();
    const val = parseFloat(recAmount);
    if (isNaN(val) || !recDesc.trim()) return alert("Complete rules schema validation checks.");

    const newRec = {
      recurrence_id: crypto.randomUUID(), description: recDesc.trim(), amount: val,
      type: recType, interval_months: parseInt(intervalMonths), start_month: selectedMonth, 
      version: 1, is_active: true, max_occurrences: maxOccurrences ? parseInt(maxOccurrences) : null
    };

    await db.recurrences.put(newRec);
    await calculateAndRenderLocalUI(); 
    forceFullCloudSync(activeYear);
    setIsAddingRecurrence(false); clearFormFields();
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
    const updated = { ...item, planned_amount: parseFloat(editPlannedAmount), actual_amount: parseFloat(editActualAmount), description: editDesc.trim(), payment_mode: editPayMode, status: editStatus };
    await db.lineItems.put(updated);
    await db.syncQueue.add({ command: 'UPDATE_ROW', year: item.date.split("-")[0], month: item.date.substring(0,7), data: updated });
    setEditingId(null); await calculateAndRenderLocalUI(); forceFullCloudSync(activeYear);
  };

  const startRecInlineEdit = (rec) => {
    setEditingRecId(rec.recurrence_id);
    setEditRecRuleDesc(rec.description);
    setEditRecRuleAmount(rec.amount);
    setEditRecRuleType(rec.type);
    setEditRecRuleInterval(rec.interval_months.toString());
    setEditRecRuleStartMonth(rec.start_month);
    setEditRecRuleMaxOcc(rec.max_occurrences ? rec.max_occurrences.toString() : '');
  };

  const saveRecInlineEdit = async (rec) => {
    const nextVer = rec.version + 1;
    const updatedRec = { ...rec, description: editRecRuleDesc.trim(), amount: parseFloat(editRecRuleAmount), type: editRecRuleType, interval_months: parseInt(editRecRuleInterval), start_month: editRecRuleStartMonth, max_occurrences: editRecRuleMaxOcc ? parseInt(editRecRuleMaxOcc) : null, version: nextVer };
    
    await db.recurrences.put(updatedRec);

    // Cascading Rewrite Logic Engine
    const allItems = await db.lineItems.toArray();
    const currentMonthStr = new Date().toISOString().substring(0, 7);
    const futurePlannedMatches = allItems.filter(i => i.recurrence_id === rec.recurrence_id && i.status === 'PLANNED' && i.date.substring(0, 7) >= currentMonthStr);
    
    for (const match of futurePlannedMatches) {
      await db.lineItems.delete(match.id);
    }

    const yearsToClean = [...new Set(futurePlannedMatches.map(m => m.date.split("-")[0]))];
    for (const y of yearsToClean) {
      const distinctMonths = [...new Set(futurePlannedMatches.filter(m => m.date.split("-")[0] === y).map(m => m.date.substring(0,7)))];
      for (const m of distinctMonths) {
        await db.syncQueue.add({ command: 'CLEAR_PLANNED_RECURRENCES', year: y, month: m, recurrence_id: rec.recurrence_id });
      }
    }

    setEditingRecId(null); await calculateAndRenderLocalUI(); forceFullCloudSync(activeYear);
  };

  const toggleCheckmarkStatus = async (item) => {
    const isSettling = item.status === 'PLANNED';
    const updated = { ...item, status: isSettling ? 'ACTUAL' : 'PLANNED', actual_amount: isSettling ? item.planned_amount : 0 };
    await db.lineItems.put(updated);
    await db.syncQueue.add({ command: 'UPDATE_ROW', year: item.date.split("-")[0], month: item.date.substring(0,7), data: updated });
    await calculateAndRenderLocalUI(); forceFullCloudSync(activeYear);
  };

  const handleDeleteEntry = async (item) => {
    if (window.confirm(`Delete row permanent verification choice?`)) {
      await db.lineItems.delete(item.id);
      await db.syncQueue.add({ command: 'DELETE_ROW', year: item.date.split("-")[0], month: item.date.substring(0,7), data: item });
      await calculateAndRenderLocalUI(); forceFullCloudSync(activeYear);
    }
  };

  const clearFormFields = () => {
    setAmount(''); setDescription(''); setType('EXPENSE'); setStatus('PLANNED'); setPayMode(PAYMENT_MODES[0]);
    setRecDesc(''); setRecAmount(''); setRecType('EXPENSE'); setIntervalMonths('1'); setMaxOccurrences('');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <form onSubmit={(e) => { e.preventDefault(); if(tokenInput.trim() && urlInput.trim()) { localStorage.setItem('auth_token', tokenInput.trim()); localStorage.setItem('apps_script_url', urlInput.trim()); setIsAuthenticated(true); } }} className="bg-white p-6 rounded-xl shadow-md w-full max-w-md space-y-3">
          <h2 className="text-xl font-bold text-gray-800">Secure Thick Client Gateway</h2>
          <input type="password" placeholder="Passphrase Token" value={tokenInput} onChange={e => setTokenInput(e.target.value)} className="w-full border p-3 text-sm rounded" required />
          <input type="url" placeholder="Google Deployment URL" value={urlInput} onChange={e => setUrlInput(e.target.value)} className="w-full border p-3 text-sm rounded" required />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded font-bold">Connect Ledger</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 pb-24">
      <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40 max-w-lg mx-auto rounded-b-xl flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide opacity-90">Active View:</span>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-blue-700 text-white font-bold p-1 rounded border border-blue-500 text-sm focus:outline-none" />
          </div>
          <button onClick={() => { localStorage.clear(); setIsAuthenticated(false); }} className="text-xs bg-blue-700 hover:bg-red-600 border border-blue-500 px-2 py-1 rounded font-bold transition-all">Logout 🔌</button>
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
                  <div key={item.id} className="p-3 flex flex-col gap-2">
                    {editingId === item.id ? (
                      <div className="space-y-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input type="number" step="0.01" value={editPlannedAmount} onChange={e => setEditPlannedAmount(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                          <input type="number" step="0.01" value={editActualAmount} onChange={e => setEditActualAmount(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
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
                          <div className="text-xs text-gray-400 mt-0.5">{item.date} • <span className="text-gray-500 font-bold">{item.payment_mode || "Unspecified"}</span></div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className={`text-sm font-black block ${item.type === 'INCOME' ? 'text-emerald-600' : 'text-gray-800'}`}>
                              ${Number(item.actual_amount || 0).toFixed(2)}
                            </span>
                            <span className="text-[10px] text-gray-400 font-semibold block">Pld: ${Number(item.planned_amount || 0).toFixed(2)}</span>
                          </div>
                          <button onClick={() => startInlineEdit(item)} className="text-gray-400 hover:text-blue-600 text-xs p-1">✏️</button>
                          <button onClick={() => handleDeleteEntry(item)} className="text-gray-400 hover:text-rose-600 text-xs p-1">🗑️</button>
                          <button onClick={() => toggleCheckmarkStatus(item)} className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold ${item.status === 'ACTUAL' ? 'bg-emerald-500 border-emerald-600 text-white' : 'border-amber-500 text-amber-600 bg-amber-50'}`}>{item.status === 'ACTUAL' ? '✓' : '⏳'}</button>
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
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider">Global Recurrence Rules Matrix</h3>
              <button onClick={() => setIsAddingRecurrence(!isAddingRecurrence)} className="bg-purple-600 text-white text-xs px-3 py-2 rounded-lg font-bold shadow-sm">{isAddingRecurrence ? "Close Form" : "+ Construct Rule"}</button>
            </div>

            {isAddingRecurrence && (
              <form onSubmit={handleSaveRecurrence} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                <input type="text" placeholder="Description" value={recDesc} onChange={e => setRecDesc(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" placeholder="Amount" value={recAmount} onChange={e => setRecAmount(e.target.value)} className="w-full border p-2 text-sm rounded" required />
                  <select value={recType} onChange={e => setRecType(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="EXPENSE">Expense Matrix</option>
                    <option value="INCOME">Income Source</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={intervalMonths} onChange={e => setIntervalMonths(e.target.value)} className="w-full border p-2 text-sm rounded bg-white">
                    <option value="1">Every Month</option>
                    <option value="2">Every 2 Months</option>
                    <option value="3">Quarterly</option>
                    <option value="6">Semi-Annually</option>
                    <option value="12">Annually</option>
                  </select>
                  <input type="number" placeholder="Max Count" value={maxOccurrences} onChange={e => setMaxOccurrences(e.target.value)} className="w-full border p-2 text-sm rounded" />
                </div>
                <button type="submit" className="w-full bg-purple-600 text-white p-2 text-sm font-bold rounded-lg shadow-sm">Initialize Rule Matrix Instance</button>
              </form>
            )}

            <div className="bg-white border rounded-xl shadow-sm divide-y divide-gray-100 overflow-hidden">
              {recurrences.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400 font-medium">No rules configured.</div>
              ) : (
                recurrences.map(rec => (
                  <div key={rec.recurrence_id} className="p-3 flex flex-col gap-2">
                    {editingRecId === rec.recurrence_id ? (
                      <div className="space-y-2 bg-purple-50/50 p-2 rounded-lg border border-purple-200">
                        <input type="text" value={editRecRuleDesc} onChange={e => setEditRecRuleDesc(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input type="number" step="0.01" value={editRecRuleAmount} onChange={e => setEditRecRuleAmount(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                          <input type="month" value={editRecRuleStartMonth} onChange={e => setEditRecRuleStartMonth(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <select value={editRecRuleType} onChange={e => setEditRecRuleType(e.target.value)} className="w-full border bg-white p-1 text-xs rounded"><option value="EXPENSE">Expense</option><option value="INCOME">Income</option></select>
                          <select value={editRecRuleInterval} onChange={e => setEditRecRuleInterval(e.target.value)} className="w-full border bg-white p-1 text-xs rounded"><option value="1">1 Month</option><option value="2">2 Months</option><option value="3">3 Months</option><option value="6">6 Months</option><option value="12">12 Months</option></select>
                          <input type="number" value={editRecRuleMaxOcc} onChange={e => setEditRecRuleMaxOcc(e.target.value)} className="w-full border bg-white p-1 text-xs rounded" placeholder="Infinite" />
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button onClick={() => setEditingRecId(null)} className="text-gray-500 text-xs px-2 py-1 bg-white border rounded">Cancel</button>
                          <button onClick={() => saveRecInlineEdit(rec)} className="bg-purple-700 text-white text-xs px-2 py-1 rounded font-bold">Apply Rule Rewrite</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-sm font-bold text-gray-800 flex items-center gap-2">{rec.description} <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black">{rec.interval_months}M</span></div>
                          <div className="text-xs text-gray-400 mt-0.5">Starts: {rec.start_month} • Cap: {rec.max_occurrences || "Infinite"} • Track: v{rec.version}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-black ${rec.type === 'INCOME' ? 'text-emerald-600' : 'text-gray-700'}`}>${Number(rec.amount).toFixed(2)}</span>
                          <button onClick={() => { startRecInlineEdit(rec); }} className="text-gray-400 hover:text-purple-700 text-xs p-1">✏️</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around p-2 shadow-lg max-w-lg mx-auto rounded-t-xl z-50">
        <button onClick={() => setActiveTab('ledger')} className={`flex flex-col items-center p-2 text-xs font-semibold ${activeTab === 'ledger' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">📃</span>Ledger Cockpit
        </button>
        <button onClick={() => setActiveTab('recurrences')} className={`flex flex-col items-center p-2 text-xs font-semibold ${activeTab === 'recurrences' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">⚙️</span>Recurring Rules
        </button>
      </nav>
    </div>
  );
}