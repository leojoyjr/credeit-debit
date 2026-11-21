/**
 * public/js/app.js
 * Complete frontend controller for Khata Ledger.
 * Vanilla JavaScript, mobile-first, high responsiveness, zero build step.
 */

// Application State
const state = {
  currentUser: null,
  csrfToken: null,
  parties: [],
  activeParty: null,
  activeView: 'dashboard',
  selectedTxType: 'credit_sale',
  ageingType: 'receivable',
  currencySymbol: '₹',
};

// Utilities
function formatMoney(cents) {
  const symbol = state.currencySymbol || '₹';
  const val = (Math.abs(cents || 0) / 100).toFixed(2);
  const sign = cents < 0 ? '-' : '';
  return `${sign}${symbol} ${val}`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button style="background:none;border:none;color:inherit;cursor:pointer;font-weight:bold;margin-left:8px;">&times;</button>
  `;
  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Modal management
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('open');
}

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const modal = e.target.closest('.modal-overlay');
    if (modal) modal.classList.remove('open');
  });
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('khata_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('khata_theme', next);
  });
}

// Navigation
function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.view-section').forEach((el) => (el.style.display = 'none'));
  document.querySelectorAll('.bottom-nav .nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === viewName);
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) target.style.display = 'block';

  // Load view data
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'parties') loadParties();
  if (viewName === 'reports') loadReports();
  if (viewName === 'settings') loadSettings();
}

document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.nav));
});

// App Initialization
async function initApp() {
  initTheme();

  // Listen for 401 Unauthorized
  window.addEventListener('auth:required', () => {
    document.getElementById('screen-login').classList.add('open');
  });

  try {
    // 1. Check if first run setup is needed
    const setupStatus = await api.get('/api/auth/setup-status');
    if (setupStatus.needs_setup) {
      document.getElementById('screen-setup').classList.add('open');
      return;
    }

    // 2. Check active user session
    await checkSession();
  } catch (err) {
    document.getElementById('screen-login').classList.add('open');
  }
}

async function checkSession() {
  try {
    const res = await api.get('/api/auth/me');
    state.currentUser = res.user;
    state.csrfToken = res.csrf_token;
    api.setCsrfToken(res.csrf_token);

    // Update UI Header
    document.getElementById('user-badge').style.display = 'flex';
    document.getElementById('logout-btn').style.display = 'inline-flex';
    document.getElementById('user-name-display').textContent = res.user.name;
    const roleEl = document.getElementById('user-role-display');
    roleEl.textContent = res.user.role.toUpperCase();
    roleEl.className = `role-tag role-${res.user.role}`;

    // Restrict Settings tab for staff
    const settingsNav = document.querySelector('.bottom-nav [data-nav="settings"]');
    if (res.user.role !== 'owner') {
      if (settingsNav) settingsNav.style.display = 'none';
      const exportBox = document.getElementById('export-parties-btn');
      if (exportBox) exportBox.parentElement.parentElement.style.display = 'none';
    } else {
      if (settingsNav) settingsNav.style.display = 'flex';
    }

    // Close auth screens
    closeModal('screen-setup');
    closeModal('screen-login');

    // Load initial settings and dashboard
    await loadBusinessSettings();
    switchView('dashboard');
  } catch (err) {
    document.getElementById('screen-login').classList.add('open');
  }
}

async function loadBusinessSettings() {
  try {
    const settings = await api.get('/api/settings');
    if (settings.business_name) {
      document.getElementById('header-business-name').textContent = settings.business_name;
    }
    if (settings.currency_symbol) {
      state.currencySymbol = settings.currency_symbol;
    }
  } catch (e) {
    // optional
  }
}

// ---------------- DASHBOARD ----------------
async function loadDashboard() {
  try {
    const summary = await api.get('/api/dashboard');
    const { kpis, ageing, top_debtors, top_creditors, recent_transactions } = summary;

    document.getElementById('kpi-receivable').textContent = formatMoney(kpis.total_receivable_cents);
    document.getElementById('kpi-payable').textContent = formatMoney(kpis.total_payable_cents);
    document.getElementById('kpi-net').textContent = formatMoney(kpis.net_position_cents);
    document.getElementById('kpi-overdue').textContent = formatMoney(kpis.total_overdue_cents);

    // Render Ageing
    renderAgeing(ageing[state.ageingType === 'receivable' ? 'receivables' : 'payables']);

    // Render Top Debtors
    const debtorsContainer = document.getElementById('top-debtors-list');
    if (top_debtors.length === 0) {
      debtorsContainer.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;">No pending receivables!</div>';
    } else {
      debtorsContainer.innerHTML = top_debtors
        .map(
          (d) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <div>
            <strong>${escapeHtml(d.name)}</strong>
            <div style="font-size:11px;color:var(--text-muted);">${d.phone || 'No phone'}</div>
          </div>
          <div style="text-align:right;">
            <div class="party-balance balance-owes">${formatMoney(d.amount_cents)}</div>
            <button class="btn btn-outline" style="min-height:26px;padding:2px 8px;font-size:11px;margin-top:2px;" onclick="openPartyLedgerById(${d.id})">Ledger</button>
          </div>
        </div>
      `
        )
        .join('');
    }

    // Render Top Creditors
    const creditorsContainer = document.getElementById('top-creditors-list');
    if (top_creditors.length === 0) {
      creditorsContainer.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;">No pending payables!</div>';
    } else {
      creditorsContainer.innerHTML = top_creditors
        .map(
          (c) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <div style="font-size:11px;color:var(--text-muted);">${c.phone || 'No phone'}</div>
          </div>
          <div style="text-align:right;">
            <div class="party-balance balance-we-owe">${formatMoney(c.amount_cents)}</div>
            <button class="btn btn-outline" style="min-height:26px;padding:2px 8px;font-size:11px;margin-top:2px;" onclick="openPartyLedgerById(${c.id})">Ledger</button>
          </div>
        </div>
      `
        )
        .join('');
    }

    // Render Recent Transactions
    const recentTbody = document.getElementById('recent-tx-tbody');
    if (recent_transactions.length === 0) {
      recentTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No transactions recorded yet.</td></tr>';
    } else {
      recentTbody.innerHTML = recent_transactions
        .map((tx) => {
          const isReversed = tx.reversed_of_id != null;
          return `
          <tr class="${isReversed ? 'is-reversed' : ''}">
            <td>${tx.date}</td>
            <td><strong>${escapeHtml(tx.party_name)}</strong></td>
            <td><span class="role-tag" style="background:var(--bg-surface-secondary);">${tx.type.replace('_', ' ')}</span></td>
            <td><strong>${formatMoney(tx.amount_cents)}</strong></td>
            <td><button class="btn btn-outline" style="min-height:26px;padding:2px 8px;font-size:11px;" onclick="openPartyLedgerById(${tx.party_id})">View</button></td>
          </tr>
        `;
        })
        .join('');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAgeing(report) {
  const total = report.total_cents || 1;
  const p0 = Math.min(100, Math.round((report.bucket_0_30 / total) * 100));
  const p31 = Math.min(100, Math.round((report.bucket_31_60 / total) * 100));
  const p61 = Math.min(100, Math.round((report.bucket_61_90 / total) * 100));
  const p90 = Math.min(100, Math.round((report.bucket_90_plus / total) * 100));

  document.getElementById('ageing-0-30').textContent = `${formatMoney(report.bucket_0_30)} (${p0}%)`;
  document.getElementById('bar-0-30').style.width = `${p0}%`;

  document.getElementById('ageing-31-60').textContent = `${formatMoney(report.bucket_31_60)} (${p31}%)`;
  document.getElementById('bar-31-60').style.width = `${p31}%`;

  document.getElementById('ageing-61-90').textContent = `${formatMoney(report.bucket_61_90)} (${p61}%)`;
  document.getElementById('bar-61-90').style.width = `${p61}%`;

  document.getElementById('ageing-90-plus').textContent = `${formatMoney(report.bucket_90_plus)} (${p90}%)`;
  document.getElementById('bar-90-plus').style.width = `${p90}%`;
}

document.getElementById('toggle-ageing-type-btn').addEventListener('click', () => {
  state.ageingType = state.ageingType === 'receivable' ? 'payable' : 'receivable';
  document.getElementById('toggle-ageing-type-btn').textContent =
    state.ageingType === 'receivable' ? 'Switch to Payables' : 'Switch to Receivables';
  loadDashboard();
});

// ---------------- PARTIES ----------------
let partyFilterType = 'all';
let partyFilterStatus = null;

async function loadParties() {
  try {
    const search = document.getElementById('party-search-input').value.trim();
    const query = new URLSearchParams();
    if (partyFilterType && partyFilterType !== 'all') query.set('type', partyFilterType);
    if (partyFilterStatus) query.set('balance_status', partyFilterStatus);
    if (search) query.set('search', search);

    const parties = await api.get(`/api/parties?${query.toString()}`);
    state.parties = parties;

    // Populate party select in Fast-Entry Modal
    const select = document.getElementById('entry-party-select');
    select.innerHTML = '<option value="">Select Party...</option>' +
      parties.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.type})</option>`).join('');

    // Render parties list
    const container = document.getElementById('parties-list-container');
    if (parties.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">No parties found. Tap "+ Add Party" to create one.</div>';
      return;
    }

    container.innerHTML = parties
      .map((p) => {
        let balClass = 'balance-zero';
        let balText = formatMoney(0);
        let subText = '';

        if (p.type === 'customer') {
          if (p.customer_balance_cents > 0) {
            balClass = 'balance-owes';
            balText = formatMoney(p.customer_balance_cents);
            subText = 'Owes You';
          } else if (p.customer_balance_cents < 0) {
            balClass = 'balance-advance';
            balText = formatMoney(Math.abs(p.customer_balance_cents));
            subText = 'Advance Received';
          }
        } else if (p.type === 'supplier') {
          if (p.supplier_balance_cents > 0) {
            balClass = 'balance-we-owe';
            balText = formatMoney(p.supplier_balance_cents);
            subText = 'You Owe';
          } else if (p.supplier_balance_cents < 0) {
            balClass = 'balance-advance';
            balText = formatMoney(Math.abs(p.supplier_balance_cents));
            subText = 'Advance Paid';
          }
        } else {
          // both
          balText = `Net: ${formatMoney(p.net_balance_cents)}`;
          subText = `Cust: ${formatMoney(p.customer_balance_cents)} | Supp: ${formatMoney(p.supplier_balance_cents)}`;
        }

        return `
        <div class="party-item" onclick="openPartyLedger(${p.id})">
          <div class="party-main">
            <div class="party-name">${escapeHtml(p.name)} <span class="role-tag" style="background:var(--bg-surface-secondary);">${p.type}</span></div>
            <div class="party-meta">📞 ${p.phone || 'No phone'} ${p.tax_id ? '• GST: ' + p.tax_id : ''}</div>
          </div>
          <div class="party-balance-box">
            <div class="party-balance ${balClass}">${balText}</div>
            <div style="font-size:11px;color:var(--text-muted);font-weight:600;">${subText}</div>
          </div>
        </div>
      `;
      })
      .join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Party Filter Pills
document.querySelectorAll('.filter-pills .filter-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pills .filter-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');

    if (pill.dataset.type) {
      partyFilterType = pill.dataset.type;
      partyFilterStatus = null;
    } else if (pill.dataset.status) {
      partyFilterStatus = pill.dataset.status;
      partyFilterType = 'all';
    }
    loadParties();
  });
});

let searchTimeout = null;
document.getElementById('party-search-input').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadParties, 300);
});

// ---------------- LEDGER STATEMENT ----------------
window.openPartyLedgerById = function (id) {
  openPartyLedger(id);
};

window.openPartyLedger = async function (partyId) {
  try {
    const fromDate = document.getElementById('ledger-from-date').value;
    const toDate = document.getElementById('ledger-to-date').value;
    const query = new URLSearchParams();
    if (fromDate) query.set('from_date', fromDate);
    if (toDate) query.set('to_date', toDate);

    const statement = await api.get(`/api/ledger/${partyId}?${query.toString()}`);
    state.activeParty = statement.party;

    // Render Party Header
    const p = statement.party;
    const isCustomer = p.type === 'customer';
    const isSupplier = p.type === 'supplier';
    const balCents = p.current_balance_cents;
    const balClass = balCents > 0 ? (isCustomer ? 'balance-owes' : 'balance-we-owe') : (balCents < 0 ? 'balance-advance' : 'balance-zero');
    const balLabel = balCents >= 0 ? (isCustomer ? 'Customer Owes Us' : 'We Owe Supplier') : 'Advance / Credit Balance';

    document.getElementById('ledger-party-header').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h2 style="font-size:20px;">${escapeHtml(p.name)}</h2>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">
            <span class="role-tag" style="background:var(--bg-surface-secondary);">${p.type.toUpperCase()}</span>
            ${p.phone ? ` • 📞 ${p.phone}` : ''}
            ${p.tax_id ? ` • GST: ${p.tax_id}` : ''}
          </div>
          ${p.credit_limit_cents > 0 ? `<div style="font-size:12px;margin-top:4px;">Credit Limit: <strong>${formatMoney(p.credit_limit_cents)}</strong> (Terms: ${p.payment_terms_days} days)</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:var(--text-muted);">${balLabel}</div>
          <div class="party-balance ${balClass}" style="font-size:24px;">${formatMoney(Math.abs(balCents))}</div>
        </div>
      </div>
    `;

    // Render Statement Table
    const tbody = document.getElementById('statement-tbody');
    const entries = statement.entries;

    let rowsHtml = `
      <tr style="background:var(--bg-surface-secondary);font-weight:600;">
        <td>${statement.filter.from_date || '-'}</td>
        <td colspan="3">Opening Balance</td>
        <td style="text-align:right;">${formatMoney(statement.opening_balance_cents)}</td>
        <td></td>
      </tr>
    `;

    if (entries.length === 0) {
      rowsHtml += `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No transactions in this period.</td></tr>`;
    } else {
      for (const entry of entries) {
        const isReversed = entry.is_reversed;
        const isReversal = entry.reversed_of_id != null;
        const canReverse = state.currentUser && state.currentUser.role === 'owner' && !isReversed && !isReversal;

        rowsHtml += `
          <tr class="${isReversed ? 'is-reversed' : ''}">
            <td>${entry.date}</td>
            <td>
              <strong>${entry.type.replace('_', ' ').toUpperCase()}</strong>
              ${entry.reference_no ? `<span style="font-size:11px;color:var(--text-muted);"> (${escapeHtml(entry.reference_no)})</span>` : ''}
              ${entry.note ? `<div style="font-size:12px;color:var(--text-muted);">${escapeHtml(entry.note)}</div>` : ''}
              ${isReversed ? `<div style="font-size:11px;color:var(--danger);font-weight:bold;">[Reversed by #${entry.reversed_by_id}]</div>` : ''}
              ${isReversal ? `<div style="font-size:11px;color:var(--info);font-weight:bold;">[Reversal of #${entry.reversed_of_id}]</div>` : ''}
            </td>
            <td style="text-align:right;color:var(--danger);font-weight:600;">${entry.debit_cents > 0 ? formatMoney(entry.debit_cents) : '-'}</td>
            <td style="text-align:right;color:var(--success);font-weight:600;">${entry.credit_cents > 0 ? formatMoney(entry.credit_cents) : '-'}</td>
            <td style="text-align:right;font-weight:700;">${formatMoney(entry.running_balance_cents)}</td>
            <td style="text-align:center;">
              ${canReverse ? `<button class="btn btn-danger" style="min-height:26px;padding:2px 8px;font-size:11px;" onclick="openReversalModal(${entry.id})">Reverse</button>` : ''}
            </td>
          </tr>
        `;
      }
    }

    // Closing row
    rowsHtml += `
      <tr style="background:var(--bg-surface-secondary);font-weight:700;">
        <td colspan="2">Closing Balance</td>
        <td style="text-align:right;color:var(--danger);">${formatMoney(statement.total_debits_cents)}</td>
        <td style="text-align:right;color:var(--success);">${formatMoney(statement.total_credits_cents)}</td>
        <td style="text-align:right;">${formatMoney(statement.closing_balance_cents)}</td>
        <td></td>
      </tr>
    `;

    tbody.innerHTML = rowsHtml;

    // Show Ledger View
    document.querySelectorAll('.view-section').forEach((el) => (el.style.display = 'none'));
    document.getElementById('view-ledger').style.display = 'block';
  } catch (err) {
    showToast(err.message, 'error');
  }
};

document.getElementById('back-to-parties-btn').addEventListener('click', () => {
  switchView('parties');
});

document.getElementById('ledger-filter-apply-btn').addEventListener('click', () => {
  if (state.activeParty) openPartyLedger(state.activeParty.id);
});

document.getElementById('ledger-filter-reset-btn').addEventListener('click', () => {
  document.getElementById('ledger-from-date').value = '';
  document.getElementById('ledger-to-date').value = '';
  if (state.activeParty) openPartyLedger(state.activeParty.id);
});

// PDF Statement Download
document.getElementById('statement-pdf-btn').addEventListener('click', () => {
  if (!state.activeParty) return;
  const from = document.getElementById('ledger-from-date').value;
  const to = document.getElementById('ledger-to-date').value;
  window.open(`/api/ledger/${state.activeParty.id}/pdf?from_date=${from}&to_date=${to}`, '_blank');
});

// Print Statement
document.getElementById('statement-print-btn').addEventListener('click', () => {
  window.print();
});

// WhatsApp Reminder Link Generator
document.getElementById('statement-whatsapp-btn').addEventListener('click', async () => {
  if (!state.activeParty) return;
  try {
    const reminder = await api.get(`/api/ledger/${state.activeParty.id}/reminder`);
    if (reminder.whatsapp_url) {
      window.open(reminder.whatsapp_url, '_blank');
    } else {
      showToast('No phone number on file for this party. Please edit party to add phone.', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Add entry shortcut from statement
document.getElementById('statement-new-tx-btn').addEventListener('click', () => {
  if (state.activeParty) {
    openFastEntryModal(state.activeParty.id);
  } else {
    openFastEntryModal();
  }
});

// ---------------- FAST ENTRY TRANSACTION MODAL ----------------
function openFastEntryModal(defaultPartyId = null) {
  const form = document.getElementById('fast-entry-form');
  form.reset();

  document.getElementById('entry-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('credit-limit-override-box').style.display = 'none';

  if (defaultPartyId) {
    document.getElementById('entry-party-select').value = String(defaultPartyId);
    loadOpenInvoicesForAllocations(defaultPartyId);
  }

  // Reset selected type button to credit_sale
  selectTxType('credit_sale');
  openModal('modal-fast-entry');
}

function selectTxType(type) {
  state.selectedTxType = type;
  document.querySelectorAll('.type-selector-grid .type-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.txType === type);
  });

  // Toggle invoice allocations section if payment
  const isPayment = ['payment_received', 'payment_made'].includes(type);
  const partyId = document.getElementById('entry-party-select').value;
  if (isPayment && partyId) {
    loadOpenInvoicesForAllocations(partyId);
  } else {
    document.getElementById('allocations-section').style.display = 'none';
  }
}

document.querySelectorAll('.type-selector-grid .type-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectTxType(btn.dataset.txType));
});

document.getElementById('fast-add-fab').addEventListener('click', () => openFastEntryModal());

document.getElementById('entry-party-select').addEventListener('change', (e) => {
  const partyId = e.target.value;
  if (['payment_received', 'payment_made'].includes(state.selectedTxType) && partyId) {
    loadOpenInvoicesForAllocations(partyId);
  }
});

async function loadOpenInvoicesForAllocations(partyId) {
  const container = document.getElementById('open-invoices-list');
  const section = document.getElementById('allocations-section');
  try {
    const invoices = await api.get(`/api/transactions/open-invoices/${partyId}`);
    if (invoices.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    container.innerHTML = invoices
      .map(
        (inv) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
        <div>
          <strong>${inv.reference_no || 'Invoice #' + inv.id}</strong> (${inv.date})
          <div style="font-size:11px;color:var(--text-muted);">Due: ${inv.due_date || 'None'} • Pending: ${formatMoney(inv.remaining_cents)}</div>
        </div>
        <input type="number" class="form-input invoice-alloc-input" data-invoice-id="${inv.id}" placeholder="0.00" step="0.01" max="${(inv.remaining_cents / 100).toFixed(2)}" style="width:100px;min-height:34px;padding:4px;">
      </div>
    `
      )
      .join('');
  } catch (err) {
    section.style.display = 'none';
  }
}

document.getElementById('fast-entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const partyId = parseInt(document.getElementById('entry-party-select').value, 10);
  const amountVal = parseFloat(document.getElementById('entry-amount').value);
  const amountCents = Math.round(amountVal * 100);
  const date = document.getElementById('entry-date').value;
  const ref = document.getElementById('entry-ref').value;
  const note = document.getElementById('entry-note').value;
  const overrideChecked = document.getElementById('credit-override-checkbox').checked;

  // Gather allocations if any
  const allocations = [];
  document.querySelectorAll('.invoice-alloc-input').forEach((input) => {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
      allocations.push({
        invoice_id: parseInt(input.dataset.invoiceId, 10),
        allocated_cents: Math.round(val * 100),
      });
    }
  });

  try {
    await api.post('/api/transactions', {
      party_id: partyId,
      type: state.selectedTxType,
      amount_cents: amountCents,
      date,
      reference_no: ref,
      note,
      allocations: allocations.length > 0 ? allocations : undefined,
      allow_credit_override: overrideChecked,
    });

    closeModal('modal-fast-entry');
    showToast('Transaction recorded successfully!', 'success');

    // Refresh current view
    if (state.activeView === 'dashboard') loadDashboard();
    if (state.activeView === 'parties') loadParties();
    if (state.activeParty && state.activeParty.id === partyId) openPartyLedger(partyId);
  } catch (err) {
    if (err.code === 'CREDIT_LIMIT_EXCEEDED') {
      const box = document.getElementById('credit-limit-override-box');
      box.style.display = 'block';
      document.getElementById('credit-limit-warning-msg').textContent = err.message;
      if (!err.details.can_override) {
        document.getElementById('credit-override-checkbox').parentElement.style.display = 'none';
      } else {
        document.getElementById('credit-override-checkbox').parentElement.style.display = 'flex';
      }
    } else {
      showToast(err.message, 'error');
    }
  }
});

// ---------------- ADD / EDIT PARTY MODAL ----------------
document.getElementById('open-add-party-btn').addEventListener('click', () => {
  document.getElementById('party-form').reset();
  document.getElementById('party-id').value = '';
  document.getElementById('party-modal-title').textContent = 'Add New Party';
  openModal('modal-party');
});

document.getElementById('party-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const partyId = document.getElementById('party-id').value;

  const data = {
    name: document.getElementById('party-name').value,
    type: document.getElementById('party-type').value,
    phone: document.getElementById('party-phone').value,
    credit_limit_cents: Math.round((parseFloat(document.getElementById('party-credit-limit').value) || 0) * 100),
    payment_terms_days: parseInt(document.getElementById('party-terms').value, 10) || 0,
    opening_balance_cents: Math.round((parseFloat(document.getElementById('party-opening-balance').value) || 0) * 100),
    tax_id: document.getElementById('party-tax-id').value,
    address: document.getElementById('party-address').value,
  };

  try {
    if (partyId) {
      await api.put(`/api/parties/${partyId}`, data);
      showToast('Party updated!', 'success');
    } else {
      await api.post('/api/parties', data);
      showToast('Party created!', 'success');
    }
    closeModal('modal-party');
    loadParties();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ---------------- REVERSAL MODAL (OWNER ONLY) ----------------
window.openReversalModal = function (txId) {
  document.getElementById('reverse-tx-id').value = txId;
  document.getElementById('reverse-note').value = '';
  openModal('modal-reversal');
};

document.getElementById('reversal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const txId = document.getElementById('reverse-tx-id').value;
  const note = document.getElementById('reverse-note').value;

  try {
    await api.post(`/api/transactions/${txId}/reverse`, { note });
    closeModal('modal-reversal');
    showToast(`Transaction #${txId} reversed successfully`, 'success');
    if (state.activeParty) openPartyLedger(state.activeParty.id);
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ---------------- REPORTS & CSV IMPORT / EXPORT ----------------
async function loadReports() {
  try {
    const summary = await api.get('/api/dashboard/monthly-summary');
    document.getElementById('monthly-summary-container').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
        <div style="padding:10px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">TOTAL SALES</div>
          <div style="font-size:18px;font-weight:800;color:var(--primary);">${formatMoney(summary.credit_sales_cents)}</div>
        </div>
        <div style="padding:10px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">TOTAL PAYMENTS COLLECTED</div>
          <div style="font-size:18px;font-weight:800;color:var(--success);">${formatMoney(summary.payments_received_cents)}</div>
        </div>
        <div style="padding:10px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">TOTAL PURCHASES</div>
          <div style="font-size:18px;font-weight:800;color:var(--danger);">${formatMoney(summary.credit_purchases_cents)}</div>
        </div>
        <div style="padding:10px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">NET CASH FLOW</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-main);">${formatMoney(summary.net_cash_flow_cents)}</div>
        </div>
      </div>
    `;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

let pendingImportRows = [];
document.getElementById('csv-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const csvText = evt.target.result;
      const previewRes = await api.post('/api/reports/parties/preview', csvText, {
        headers: { 'Content-Type': 'text/csv' },
      });

      pendingImportRows = previewRes.valid_rows;
      const previewDiv = document.getElementById('csv-preview-container');
      previewDiv.style.display = 'block';

      let errorHtml = '';
      if (previewRes.error_count > 0) {
        errorHtml = `
          <div style="background:var(--danger-light);color:var(--danger);padding:8px 12px;border-radius:var(--radius-sm);margin-bottom:10px;">
            ⚠️ Found ${previewRes.error_count} row errors. These will be skipped.
          </div>
        `;
      }

      previewDiv.innerHTML = `
        ${errorHtml}
        <div style="margin-bottom:8px;font-weight:bold;">
          Preview: ${previewRes.valid_count} valid party rows ready to import.
        </div>
        <button id="commit-import-btn" class="btn btn-success" style="margin-bottom:12px;">
          Confirm & Import ${previewRes.valid_count} Parties
        </button>
      `;

      document.getElementById('commit-import-btn').addEventListener('click', async () => {
        try {
          await api.post('/api/reports/parties/import', { valid_rows: pendingImportRows });
          showToast(`Successfully imported ${pendingImportRows.length} parties!`, 'success');
          previewDiv.style.display = 'none';
          document.getElementById('csv-file-input').value = '';
          loadParties();
        } catch (impErr) {
          showToast(impErr.message, 'error');
        }
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  reader.readAsText(file);
});

// ---------------- SETTINGS & USER MANAGEMENT (OWNER ONLY) ----------------
async function loadSettings() {
  try {
    const settings = await api.get('/api/settings');
    document.getElementById('setting-business-name').value = settings.business_name || '';
    document.getElementById('setting-currency-symbol').value = settings.currency_symbol || '₹';
    document.getElementById('setting-tax-rate').value = settings.tax_rate || '18';
    document.getElementById('setting-reminder-template').value = settings.reminder_template || '';

    // Load users
    loadUsersList();
    // Load backups
    loadBackupsList();
    // Load audit logs
    loadAuditLogsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    business_name: document.getElementById('setting-business-name').value,
    currency_symbol: document.getElementById('setting-currency-symbol').value,
    tax_rate: document.getElementById('setting-tax-rate').value,
    reminder_template: document.getElementById('setting-reminder-template').value,
  };
  try {
    await api.put('/api/settings', data);
    state.currencySymbol = data.currency_symbol;
    document.getElementById('header-business-name').textContent = data.business_name;
    showToast('Settings saved successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadUsersList() {
  try {
    const users = await api.get('/api/auth/users');
    const tbody = document.getElementById('users-table-tbody');
    tbody.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="role-tag role-${u.role}">${u.role.toUpperCase()}</span></td>
        <td>${u.is_active ? '<span style="color:var(--success);">Active</span>' : '<span style="color:var(--danger);">Deactivated</span>'}</td>
        <td>
          ${u.id !== state.currentUser.id && u.is_active ? `<button class="btn btn-outline" style="min-height:26px;padding:2px 8px;font-size:11px;" onclick="deactivateUser(${u.id})">Deactivate</button>` : ''}
        </td>
      </tr>
    `
      )
      .join('');
  } catch (err) {
    // optional
  }
}

window.deactivateUser = async function (userId) {
  if (!confirm('Are you sure you want to deactivate this staff account?')) return;
  try {
    await api.post(`/api/auth/users/${userId}/deactivate`);
    showToast('User deactivated', 'success');
    loadUsersList();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

document.getElementById('open-add-user-btn').addEventListener('click', () => {
  document.getElementById('user-create-form').reset();
  openModal('modal-user');
});

document.getElementById('user-create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('new-user-name').value,
    username: document.getElementById('new-user-username').value,
    password: document.getElementById('new-user-password').value,
    role: document.getElementById('new-user-role').value,
  };
  try {
    await api.post('/api/auth/users', data);
    closeModal('modal-user');
    showToast('Staff user created successfully', 'success');
    loadUsersList();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Backups
async function loadBackupsList() {
  try {
    const backups = await api.get('/api/backup');
    const tbody = document.getElementById('backups-table-tbody');
    if (backups.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No backups archived yet.</td></tr>';
      return;
    }
    tbody.innerHTML = backups
      .map(
        (b) => `
      <tr>
        <td><strong>${b.filename}</strong><div style="font-size:11px;color:var(--text-muted);">${b.created_at}</div></td>
        <td>${(b.size_bytes / 1024).toFixed(1)} KB</td>
        <td>
          <a href="/api/backup/download/${b.filename}" class="btn btn-outline" style="min-height:26px;padding:2px 8px;font-size:11px;" download>Download</a>
        </td>
      </tr>
    `
      )
      .join('');
  } catch (err) {
    // optional
  }
}

document.getElementById('backup-now-btn').addEventListener('click', async () => {
  try {
    const res = await api.post('/api/backup');
    showToast(`Backup created: ${res.filename}`, 'success');
    loadBackupsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Audit Logs
async function loadAuditLogsList() {
  try {
    const logs = await api.get('/api/settings/audit-logs');
    const tbody = document.getElementById('audit-log-tbody');
    tbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td><span style="font-size:11px;color:var(--text-muted);">${l.created_at}</span></td>
        <td><strong>${escapeHtml(l.user_name || 'System')}</strong></td>
        <td><span class="role-tag" style="background:var(--bg-surface-secondary);">${l.action}</span></td>
        <td>${l.entity} ${l.entity_id ? '#' + l.entity_id : ''}</td>
      </tr>
    `
      )
      .join('');
  } catch (err) {
    // optional
  }
}

// ---------------- SETUP & LOGIN FORMS ----------------
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    business_name: document.getElementById('setup-biz-name').value,
    name: document.getElementById('setup-full-name').value,
    username: document.getElementById('setup-username').value,
    password: document.getElementById('setup-password').value,
  };
  try {
    await api.post('/api/auth/setup', data);
    showToast('Owner account initialized!', 'success');
    // Now log in automatically
    const loginRes = await api.post('/api/auth/login', {
      username: data.username,
      password: data.password,
    });
    state.currentUser = loginRes.user;
    state.csrfToken = loginRes.csrf_token;
    api.setCsrfToken(loginRes.csrf_token);
    await checkSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await api.post('/api/auth/login', { username, password });
    state.currentUser = res.user;
    state.csrfToken = res.csrf_token;
    api.setCsrfToken(res.csrf_token);
    showToast('Logged in successfully!', 'success');
    await checkSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api.post('/api/auth/logout');
    window.location.reload();
  } catch (err) {
    window.location.reload();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Launch App on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
