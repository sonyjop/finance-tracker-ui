import React, { useState, useEffect } from 'react';
import { db } from './db';
import { queueMutation, triggerSync } from './syncEngine';

export default function App() {
  // Auth state management
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('auth_token'));
  const [tokenInput, setTokenInput] = useState('');
  const [urlInput, setUrlInput] = useState('');

  // UI state management
  const [view, setView] = useState('summary'); // 'summary' | 'entry' | 'list'
  const [lineItems, setLineItems] = useState([]);
  const [summary, setSummary] = useState({ income: { actual: 0, planned: 0 }, expense: { actual: 0, planned: 0 } });

  // Form input field elements
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('EXPENSE');
  const [status, setStatus] = useState('PLANNED');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));

  useEffect(() => {
    if (isAuthenticated) {
      loadCachedData();
      triggerSync(); // Perform a background update immediately on startup

      const handleSyncDone = () => loadCachedData();
      window.addEventListener('sync-completed', handleSyncDone);
      return () => window.removeEventListener('sync-completed', handleSyncDone);
    }
  }, [isAuthenticated]);

  const loadCachedData = async () => {
    const cachedItems = await db.lineItems.toArray();
    setLineItems(cachedItems.sort((a, b) => b.date.localeCompare(a.date)));

    const annualMeta = await db.metadata.get('annualSummary');
    if (annualMeta) {
      setSummary(annualMeta.value);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (tokenInput && urlInput) {
      localStorage.setItem('auth_token', tokenInput);
      localStorage.setItem('apps_script_url', urlInput);
      setIsAuthenticated(true);
    }
  };

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    if (!amount || !description) return alert("Please complete all inputs");

    const newEntry = {
      id: crypto.randomUUID(),
      type,
      date,
      amount: parseFloat(amount),
      description,
      status,
      created_at: new Date().toISOString()
    };

    await queueMutation('INSERT', newEntry);
    
    // Clear the form fields
    setAmount('');
    setDescription('');
    setView('summary');
    loadCachedData();
  };

  const toggleStatus = async (item) => {
    const updated = { ...item, status: item.status === 'PLANNED' ? 'ACTUAL' : 'PLANNED' };
    await queueMutation('UPDATE', updated);
    loadCachedData();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-white p-6 rounded-xl shadow-md w-full max-w-md">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">Finance Gateway Secure Login</h2>
          <input 
            type="password" placeholder="Enter Secure Passphrase Token" value={tokenInput}
            onChange={e => setTokenInput(e.target.value)} className="w-full border p-3 rounded mb-3" required
          />
          <input 
            type="url" placeholder="Google Apps Script Macro Exec URL" value={urlInput}
            onChange={e => setUrlInput(e.target.value)} className="w-full border p-3 rounded mb-4" required
          />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded font-semibold hover:bg-blue-700">
            Access Dashboard
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 pb-20">
      {/* Top Navbar */}
      <header className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-sm">
        <h1 className="text-xl font-bold tracking-wide">Finance Tracker PWA</h1>
        <button onClick={() => { localStorage.clear(); setIsAuthenticated(false); }} className="text-xs border border-white px-2 py-1 rounded">
          Logout
        </button>
      </header>

      {/* Main View Wrapper */}
      <main className="p-4 max-w-lg mx-auto">
        {view === 'summary' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-700">Annual Financial Run Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
                <p className="text-xs uppercase text-emerald-700 font-bold tracking-wider">Total Income</p>
                <p className="text-2xl font-extrabold text-emerald-800">${summary.income.actual}</p>
                <p className="text-xs text-emerald-600 mt-1">Planned: ${summary.income.planned}</p>
              </div>
              <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl">
                <p className="text-xs uppercase text-rose-700 font-bold tracking-wider">Total Expenses</p>
                <p className="text-2xl font-extrabold text-rose-800">${summary.expense.actual}</p>
                <p className="text-xs text-rose-600 mt-1">Planned: ${summary.expense.planned}</p>
              </div>
            </div>
            
            <button onClick={() => setView('list')} className="w-full bg-white border border-gray-300 p-4 rounded-xl font-medium shadow-sm hover:bg-gray-100 flex justify-between items-center">
              <span>View Current Month Transactions</span>
              <span>→</span>
            </button>
          </div>
        )}

        {view === 'entry' && (
          <form onSubmit={handleSaveEntry} className="bg-white p-5 rounded-xl shadow-sm border space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Add Line Transaction</h2>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">Amount</label>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border p-2 rounded text-lg" placeholder="0.00" required />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">Description</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full border p-2 rounded" placeholder="E.g., Groceries" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">Type</label>
                <select value={type} onChange={e => setType(e.target.value)} className="w-full border p-2 rounded bg-white">
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border p-2 rounded bg-white">
                  <option value="PLANNED">Planned</option>
                  <option value="ACTUAL">Actual</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border p-2 rounded" required />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setView('summary')} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded font-medium">Cancel</button>
              <button type="submit" className="flex-1 bg-blue-600 text-white p-3 rounded font-medium shadow-md">Save Entry</button>
            </div>
          </form>
        )}

        {view === 'list' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">Transaction Registry</h2>
              <button onClick={() => setView('summary')} className="text-sm text-blue-600 font-medium">← Back</button>
            </div>
            <div className="divide-y border rounded-xl bg-white shadow-sm overflow-hidden">
              {lineItems.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 text-center">No cached records for this node viewport.</p>
              ) : (
                lineItems.map(item => (
                  <div key={item.id} className="p-3 flex justify-between items-center hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="font-semibold text-sm text-gray-800">{item.description}</p>
                      <p className="text-xs text-gray-400">{item.date} • <span className={item.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}>{item.type}</span></p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${item.type === 'INCOME' ? 'text-emerald-700' : 'text-gray-900'}`}>
                        {item.type === 'EXPENSE' ? '-' : '+'}${item.amount}
                      </span>
                      <button 
                        onClick={() => toggleStatus(item)}
                        className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs transition-all ${item.status === 'ACTUAL' ? 'bg-emerald-500 border-emerald-600 text-white' : 'border-amber-500 text-amber-600 bg-amber-50'}`}
                      >
                        {item.status === 'ACTUAL' ? '✓' : '⏳'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Sticky Tab Navigation Menu */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around p-2 shadow-lg max-w-lg mx-auto rounded-t-xl z-50">
        <button onClick={() => setView('summary')} className={`flex flex-col items-center p-2 text-xs font-semibold ${view === 'summary' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">📊</span>Summary
        </button>
        <button onClick={() => setView('entry')} className="flex flex-col items-center -mt-6 bg-blue-600 text-white rounded-full p-3 shadow-lg hover:bg-blue-700 transition-transform active:scale-95">
          <span className="text-2xl leading-none">+</span>
        </button>
        <button onClick={() => setView('list')} className={`flex flex-col items-center p-2 text-xs font-semibold ${view === 'list' ? 'text-blue-600' : 'text-gray-400'}`}>
          <span className="text-xl">📃</span>Ledger
        </button>
      </nav>
    </div>
  );
}