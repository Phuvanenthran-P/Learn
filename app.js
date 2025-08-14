/* FinSight - single file app logic
   - Lightweight IndexedDB wrapper
   - Transaction CRUD
   - Budgets & Goals
   - Recurring processor (runs on load)
   - CSV import/export
   - Simple canvas pie chart
*/

const DB_NAME = 'finsight-db';
const DB_VERSION = 1;
let db = null;

// Utility: basic IndexedDB wrapper
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('txns')) {
        const s = d.createObjectStore('txns', { keyPath: 'id', autoIncrement: true });
        s.createIndex('byDate', 'date');
      }
      if (!d.objectStoreNames.contains('budgets')) d.createObjectStore('budgets', { keyPath: 'category' });
      if (!d.objectStoreNames.contains('goals')) d.createObjectStore('goals', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function idbPut(store, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res(true);
    tx.onerror = rej;
  });
}
function idbAdd(store, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(val);
    req.onsuccess = (e) => res(e.target.result);
    tx.onerror = rej;
  });
}
function idbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = rej;
  });
}
function idbDelete(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = rej;
  });
}

// Default categories
const DEFAULT_CATS = ['Food','Transport','Groceries','Rent','Utilities','Entertainment','Salary','Other'];

// UI elements
const txnListEl = () => document.getElementById('txnList');
const balanceEl = () => document.getElementById('balance');
const insightCanvas = () => document.getElementById('insightChart');
const txnCategory = () => document.getElementById('txnCategory');

let deferredPrompt = null;

// Init
window.addEventListener('load', async () => {
  await idbOpen();
  registerSW();
  setupInstallPrompt();
  initUI();
  await processRecurring();
  renderAll();
});

// register service worker
function registerSW(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}

// install prompt logic
function setupInstallPrompt(){
  const installBtn = document.getElementById('installBtn');
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
    } else {
      showmessage('Use browser menu -> Add to Home screen.');
    }
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn').style.display = 'inline-block';
  });
}

// populate UI controls
function initUI(){
  // modal controls
  document.getElementById('addTxnBtn').onclick = () => showModal();
  document.getElementById('closeModal').onclick = hideModal;
  document.getElementById('addGoalBtn').onclick = () => showGoalModal();
  document.getElementById('closeGoalModal').onclick = hideGoalModal;

  // txn form submit
  const txnForm = document.getElementById('txnForm');
  txnForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = {
      type: document.getElementById('txnType').value,
      amount: parseFloat(document.getElementById('txnAmount').value) || 0,
      category: document.getElementById('txnCategory').value,
      date: document.getElementById('txnDate').value || new Date().toISOString().slice(0,10),
      note: document.getElementById('txnNote').value || '',
      recurring: document.getElementById('txnRecurring').value || 'none'
    };
    await idbAdd('txns', t);
    hideModal();
    renderAll();
  });

  // goal form
  const goalForm = document.getElementById('goalForm');
  goalForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const g = {
      name: document.getElementById('goalName').value,
      target: parseFloat(document.getElementById('goalTarget').value) || 0,
      current: parseFloat(document.getElementById('goalCurrent').value) || 0
    };
    await idbAdd('goals', g);
    hideGoalModal();
    renderAll();
  });

  // CSV export/import
  document.getElementById('exportCsv').onclick = exportCSV;
  document.getElementById('importBtn').onclick = () => document.getElementById('importCsv').click();
  document.getElementById('importCsv').addEventListener('change', handleCsvImport);

  // fill categories
  populateCategories();
}

// modal helpers
function showModal(){
  document.getElementById('modalTitle').textContent = 'Add Transaction';
  document.getElementById('txnForm').reset();
  document.getElementById('txnDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('modal').classList.remove('hidden');
}
function hideModal(){ document.getElementById('modal').classList.add('hidden'); }
function showGoalModal(){ document.getElementById('goalModal').classList.remove('hidden'); document.getElementById('goalForm').reset(); }
function hideGoalModal(){ document.getElementById('goalModal').classList.add('hidden'); }

async function populateCategories(){
  txnCategory().innerHTML = '';
  const all = DEFAULT_CATS;
  all.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    txnCategory().appendChild(opt);
  });
}

// rendering
async function renderAll(){
  const txns = await idbGetAll('txns');
  const budgets = await idbGetAll('budgets');
  const goals = await idbGetAll('goals');

  renderTxns(txns);
  renderBalance(txns);
  renderBudgets(budgets);
  renderGoals(goals);
  drawChart(txns);
}

function renderTxns(txns){
  const root = txnListEl();
  root.innerHTML = '';
  if (!txns.length) { root.textContent = 'No transactions yet.'; return; }

  txns.sort((a,b)=> new Date(b.date) - new Date(a.date));
  txns.forEach(t => {
    const el = document.createElement('div');
    el.className = 'txn';
    el.innerHTML = `
      <div class="meta">
        <div>${t.category} • <small style="color:#777">${t.date}</small></div>
        <div style="font-size:12px;color:#555">${t.note || ''}${t.recurring && t.recurring!=='none' ? ' • '+t.recurring : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="amt">${t.type === 'expense' ? '-' : '+'}${formatMoney(t.amount)}</div>
        <div style="margin-top:6px"><button class="btn small" data-id="${t.id}" data-action="edit">Edit</button> <button class="btn small alt" data-id="${t.id}" data-action="del">Del</button></div>
      </div>
    `;
    // hookup
    el.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', async (ev) => {
        const id = Number(b.getAttribute('data-id'));
        const action = b.getAttribute('data-action');
        if (action === 'del') {
          if (confirm('Delete this transaction?')) {
            await idbDelete('txns', id);
            renderAll();
          }
        } else if (action === 'edit') {
          editTxn(id);
        }
      });
    });
    root.appendChild(el);
  });
}

async function editTxn(id){
  const txns = await idbGetAll('txns');
  const t = txns.find(x=>x.id === id);
  if (!t) return;
  document.getElementById('modalTitle').textContent = 'Edit Transaction';
  document.getElementById('txnType').value = t.type;
  document.getElementById('txnAmount').value = t.amount;
  document.getElementById('txnCategory').value = t.category;
  document.getElementById('txnDate').value = t.date;
  document.getElementById('txnNote').value = t.note || '';
  document.getElementById('txnRecurring').value = t.recurring || 'none';
  document.getElementById('modal').classList.remove('hidden');

  // override submit to update rather than add
  const form = document.getElementById('txnForm');
  const submitHandler = async (ev) => {
    ev.preventDefault();
    const updated = {
      id: id,
      type: document.getElementById('txnType').value,
      amount: parseFloat(document.getElementById('txnAmount').value) || 0,
      category: document.getElementById('txnCategory').value,
      date: document.getElementById('txnDate').value,
      note: document.getElementById('txnNote').value || '',
      recurring: document.getElementById('txnRecurring').value || 'none'
    };
    await idbPut('txns', updated);
    form.removeEventListener('submit', submitHandler);
    hideModal();
    renderAll();
  };
  form.addEventListener('submit', submitHandler);
}

// balance & insights
function renderBalance(txns){
  const total = txns.reduce((s,t)=>{
    return s + (t.type === 'expense' ? -t.amount : t.amount);
  },0);
  balanceEl().textContent = formatMoney(total);
}

// budgets
async function renderBudgets(budgets){
  const el = document.getElementById('budgetList');
  el.innerHTML = '';
  if (!budgets.length) { el.textContent = 'No budgets set.'; return; }
  budgets.forEach(b=>{
    const d = document.createElement('div');
    d.style.padding='8px';
    d.style.borderBottom='1px solid #eee';
    d.innerHTML = `<strong>${b.category}</strong> • Limit: ${formatMoney(b.limit)}`;
    el.appendChild(d);
  });
}

// goals
async function renderGoals(goals){
  // optionally show in a section or integrate later; keeping simple by logging
  // we'll display progress in console (or extend the UI)
  // minimal display: put in budgets area as well (left for customization)
  // For now, no heavy UI to keep it minimal and fast
}

// format money
function formatMoney(n){
  const sign = n<0 ? '-' : '';
  const abs = Math.abs(n).toFixed(2);
  return `${sign}₹${abs}`;
}

// pie chart by category (last 30 days)
function drawChart(txns){
  const canvas = insightCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  const last30 = txns.filter(t => {
    const d = new Date(t.date);
    const days = (Date.now() - d.getTime())/(1000*60*60*24);
    return days <= 365; // show year by default for better data
  });

  const sums = {};
  last30.forEach(t => {
    if (t.type === 'expense') {
      sums[t.category] = (sums[t.category] || 0) + t.amount;
    }
  });
  const cats = Object.keys(sums);
  if (!cats.length) {
    ctx.fillStyle = '#777';
    ctx.font = '12px system-ui';
    ctx.fillText('No expense data', 10, h/2);
    return;
  }
  const total = cats.reduce((s,c)=>s+sums[c],0);
  // simple color palette (grayscale)
  let start = -Math.PI/2;
  cats.forEach((c,i)=>{
    const slice = sums[c]/total * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(w/2, h/2);
    ctx.arc(w/2, h/2, Math.min(w,h)/2 - 8, start, start+slice);
    ctx.closePath();
    const shade = 40 + (i*30) % 160;
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fill();
    start += slice;
  });
}

function showMessage(msg, duration=3000){
  const box = document.getElementById('messageBox');
  if (!box) return;
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, duration);
}

// recurring processor: create new occurrences if missing (on app load)
async function processRecurring(){
  const txns = await idbGetAll('txns');
  const today = new Date().toISOString().slice(0,10);
  for (const t of txns){
    if (!t.recurring || t.recurring === 'none') continue;
    // create next occurrences until up-to-date (simple approach)
    const lastDate = new Date(t.date);
    const now = new Date();
    let next = new Date(lastDate);
    while (true){
      if (t.recurring === 'daily') next.setDate(next.getDate()+1);
      if (t.recurring === 'weekly') next.setDate(next.getDate()+7);
      if (t.recurring === 'monthly') next.setMonth(next.getMonth()+1);
      if (next > now) break;
      // only add if there isn't already an identical txn on that date
      const dateStr = next.toISOString().slice(0,10);
      const existing = txns.find(x=>x.type===t.type && x.amount===t.amount && x.category===t.category && x.date===dateStr);
      if (!existing){
        await idbAdd('txns', {
          type: t.type,
          amount: t.amount,
          category: t.category,
          date: dateStr,
          note: t.note + ' (recurring)',
          recurring: t.recurring
        });
      }
      // loop continues until next > now
    }
  }
}

// CSV export
async function exportCSV(){
  const txns = await idbGetAll('txns');
  if (!txns.length) { showmessage('No data to export'); return; }
  const header = ['id','type','amount','category','date','note','recurring'];
  const rows = txns.map(t => header.map(h => JSON.stringify(t[h]||'')).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'finsight-transactions.csv'; a.click();
  URL.revokeObjectURL(url);
}

// CSV import (simple)
function handleCsvImport(e){
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    const txt = evt.target.result;
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const header = lines.shift().split(',');
    for (const ln of lines){
      try {
        const values = ln.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
        const obj = {};
        header.forEach((h,i) => {
          const key = h.replace(/"/g,'').trim();
          let val = values[i] || '';
          val = val.replace(/^"|"$/g,'');
          obj[key] = key === 'amount' ? parseFloat(val) : val;
        });
        // minimal validation
        if (!obj.type || !obj.amount) continue;
        await idbAdd('txns', {
          type: obj.type,
          amount: Number(obj.amount),
          category: obj.category || 'Other',
          date: obj.date || new Date().toISOString().slice(0,10),
          note: obj.note || '',
          recurring: obj.recurring || 'none'
        });
      } catch (err) { continue; }
    }
    showmessage('Import complete');
    renderAll();
  };
  reader.readAsText(f);
}

// small helper to seed default data (optional)
async function seedDefaults(){
  const txns = await idbGetAll('txns');
  if (txns.length) return;
  await idbAdd('txns', { type:'income', amount:50000, category:'Salary', date:new Date().toISOString().slice(0,10), note:'Initial salary' });
  await idbAdd('txns', { type:'expense', amount:1200, category:'Groceries', date:new Date().toISOString().slice(0,10), note:'Weekly groceries' });
}

// initial render
(async ()=>{ await seedDefaults(); })();

