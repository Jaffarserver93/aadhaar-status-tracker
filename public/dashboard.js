document.addEventListener('DOMContentLoaded', async () => {
  // Check auth
  try {
    const meRes = await fetch('/api/me');
    const meData = await meRes.json();
    if (!meData.authenticated) {
      window.location.href = '/';
      return;
    }
    document.getElementById('userBadge').innerHTML = `
      <svg class="w-3.5 h-3.5 text-[hsl(var(--sidebar-primary))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
      </svg>
      <span class="font-mono text-xs text-[hsl(var(--sidebar-foreground))]">${meData.username}</span>
    `;
  } catch {
    window.location.href = '/';
    return;
  }

  // UI References
  const modal = document.getElementById('modalBackdrop');
  const addBtn = document.getElementById('addTrackerBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const trackerForm = document.getElementById('addTrackerForm');
  const logoutBtn = document.getElementById('logoutBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  const modalError = document.getElementById('modalError');

  // Live Engine Elements
  const liveStatusText = document.getElementById('liveStatusText');
  const livePulse = document.getElementById('livePulse');

  // Fetch live API engine status every 1.5 seconds
  async function pollLiveStream() {
    try {
      const statusRes = await fetch('/api/debug/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (liveStatusText) liveStatusText.innerText = statusData.message || 'Idle';
        
        if (livePulse) {
          if (statusData.active) {
            livePulse.className = 'w-2 h-2 rounded-full bg-[hsl(var(--primary))] animate-pulse';
          } else {
            livePulse.className = 'w-2 h-2 rounded-full bg-[hsl(var(--muted-foreground))]';
          }
        }
      }
    } catch (e) {
      // Ignore transient polling drops
    }
  }

  setInterval(pollLiveStream, 1500);
  pollLiveStream();

  // Detect and display LAN access URL for mobile / other devices
  const lanBadge = document.getElementById('lanBadge');
  const lanUrlText = document.getElementById('lanUrlText');
  let currentLanUrl = '';
  try {
    const netRes = await fetch('/api/network-info');
    if (netRes.ok) {
      const netData = await netRes.json();
      if (netData.networkUrls && netData.networkUrls.length > 0) {
        currentLanUrl = netData.networkUrls[0].url;
        if (lanUrlText) {
          lanUrlText.textContent = `LAN: ${netData.networkUrls[0].url.replace('http://', '')}`;
        }
      } else {
        if (lanUrlText) lanUrlText.textContent = `LAN: ${window.location.host}`;
      }
    }
  } catch (e) {
    if (lanUrlText) lanUrlText.textContent = `LAN: ${window.location.host}`;
  }

  if (lanBadge) {
    lanBadge.addEventListener('click', () => {
      const urlToCopy = currentLanUrl || window.location.origin;
      navigator.clipboard.writeText(urlToCopy).then(() => {
        const orig = lanUrlText.textContent;
        lanUrlText.textContent = 'COPIED TO CLIPBOARD!';
        setTimeout(() => lanUrlText.textContent = orig, 1500);
      });
    });
  }

  // Modal Actions
  const openModal = () => {
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
    syncTypeInputs();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    trackerForm.reset();
    syncTypeInputs();
  };

  addBtn.addEventListener('click', openModal);
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);

  // Close modal when clicking on backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Type selection switching (EID vs SID vs Standard)
  const trackerTypeSelect = document.getElementById('trackerType');
  const eidInputContainer = document.getElementById('eidInputContainer');
  const sidInputContainer = document.getElementById('sidInputContainer');
  const sidNumberInput = document.getElementById('sidNumber');
  const sidCharCounter = document.getElementById('sidCharCounter');
  const standardInputContainer = document.getElementById('standardInputContainer');
  const trackerNumberInput = document.getElementById('trackerNumber');
  const eid14Fields = document.getElementById('eid14Fields');
  const eid28Fields = document.getElementById('eid28Fields');

  function syncTypeInputs() {
    const selectedType = trackerTypeSelect.value;
    if (selectedType === 'EID') {
      eidInputContainer.classList.remove('hidden');
      sidInputContainer.classList.add('hidden');
      standardInputContainer.classList.add('hidden');
      trackerNumberInput.removeAttribute('required');
      document.getElementById('eid14Number').focus();
    } else if (selectedType === 'SID') {
      eidInputContainer.classList.add('hidden');
      sidInputContainer.classList.remove('hidden');
      standardInputContainer.classList.add('hidden');
      trackerNumberInput.removeAttribute('required');
      sidNumberInput.focus();
    } else {
      eidInputContainer.classList.add('hidden');
      sidInputContainer.classList.add('hidden');
      standardInputContainer.classList.remove('hidden');
      trackerNumberInput.setAttribute('required', 'true');
      if (selectedType === 'SRN') {
        trackerNumberInput.placeholder = 'e.g. S1318711695580 (starts with S13 or S22)';
      } else {
        trackerNumberInput.placeholder = 'e.g. 12345678 (8-digit URN)';
      }
      trackerNumberInput.focus();
    }
  }

  trackerTypeSelect.addEventListener('change', syncTypeInputs);

  // Real-time counter & format helper for SID ('S' followed by 27 digits)
  sidNumberInput.addEventListener('input', (e) => {
    let val = e.target.value.trim().toUpperCase().replace(/[\s\/\-_]/g, '');
    if (val && !val.startsWith('S') && /^\d/.test(val)) {
      val = 'S' + val;
    }
    sidNumberInput.value = val;
    const len = val.length;
    sidCharCounter.innerText = `${len} / 28 chars`;
    if (len === 28 && val.startsWith('S')) {
      sidCharCounter.className = 'font-mono text-[10px] text-[hsl(var(--primary))] px-1.5 py-0.5 rounded bg-[hsla(var(--primary),0.12)] border border-[hsla(var(--primary),0.3)] font-semibold';
    } else {
      sidCharCounter.className = 'font-mono text-[10px] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]';
    }
  });

  // EID Mode switcher (14-digit + Date/Time vs Direct 28-digit)
  document.querySelectorAll('input[name="eidMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === '14digit') {
        eid14Fields.classList.remove('hidden');
        eid28Fields.classList.add('hidden');
        document.getElementById('eid14Number').focus();
      } else {
        eid14Fields.classList.add('hidden');
        eid28Fields.classList.remove('hidden');
        document.getElementById('eid28Number').focus();
      }
    });
  });

  // Logout Handler
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
    } catch (err) {
      console.error('Logout error:', err);
      window.location.href = '/';
    }
  });

  // Manual Refresh Button
  refreshBtn.addEventListener('click', async () => {
    refreshIcon.classList.add('animate-spin');
    await loadTrackers();
    setTimeout(() => refreshIcon.classList.remove('animate-spin'), 600);
  });

  // Fetch and Render Trackers
  async function loadTrackers() {
    try {
      const res = await fetch('/api/trackers');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      const data = await res.json();
      renderPipeline(data.trackers || []);
    } catch (err) {
      console.error('Failed to load trackers:', err);
    }
  }

  function renderPipeline(trackers) {
    const lists = {
      Processing: document.getElementById('processingList'),
      Completed: document.getElementById('completedList'),
      Failed: document.getElementById('failedList')
    };

    const counts = {
      Processing: document.getElementById('processingCount'),
      Completed: document.getElementById('completedCount'),
      Failed: document.getElementById('failedCount')
    };

    // Reset list contents
    Object.values(lists).forEach(el => el.innerHTML = '');
    const tally = { Processing: 0, Completed: 0, Failed: 0 };

    if (trackers.length === 0) {
      Object.keys(lists).forEach(key => {
        lists[key].innerHTML = `
          <div class="h-32 flex flex-col items-center justify-center text-[hsl(var(--muted-foreground))] font-mono text-xs italic">
            No active dossiers in this pipeline
          </div>
        `;
      });
    }

    trackers.forEach(t => {
      const status = t.current_status || 'Processing';
      tally[status] = (tally[status] || 0) + 1;

      const card = document.createElement('div');
      card.className = 'paper-card p-3.5 flex flex-col gap-2.5 transition-all hover:border-[hsl(var(--input))] bg-[hsl(var(--card))] border border-[hsl(var(--card-border))] text-[hsl(var(--card-foreground))]';

      const lastChecked = t.last_checked_at 
        ? new Date(t.last_checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
        : 'Initial Check Pending';

      let statusBadge = '';
      if (status === 'Processing') {
        statusBadge = `
          <span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium px-2 py-0.5 rounded bg-[hsla(var(--chart-4),0.15)] text-[hsl(39,60%,34%)] border border-[hsla(var(--chart-4),0.35)]">
            <svg class="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>In Progress</span>
          </span>
        `;
      } else if (status === 'Completed') {
        statusBadge = `
          <span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium px-2 py-0.5 rounded bg-[hsla(var(--primary),0.12)] text-[hsl(var(--primary))] border border-[hsla(var(--primary),0.3)]">
            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
            </svg>
            <span>Completed</span>
          </span>
        `;
      } else {
        statusBadge = `
          <span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium px-2 py-0.5 rounded bg-[hsla(var(--accent),0.15)] text-[hsl(16,55%,42%)] border border-[hsla(var(--accent),0.35)]">
            <svg class="w-2.5 h-2.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <span>Action Needed</span>
          </span>
        `;
      }

      let parsedJson = null;
      try {
        parsedJson = typeof t.json_data === 'string' ? JSON.parse(t.json_data) : t.json_data;
      } catch (e) {}

      let stagesHtml = '';
      if (parsedJson && parsedJson.statusData && parsedJson.statusData[0]?.stages) {
        const stages = parsedJson.statusData[0].stages;
        stagesHtml = `
          <div class="flex flex-wrap gap-1 mt-1">
            ${stages.map(s => {
              const isDone = s.state === 'COMPLETE';
              const isCurr = s.state === 'INPROGRESS';
              const bg = isDone 
                ? 'bg-[hsla(var(--primary),0.12)] text-[hsl(var(--primary))] border-[hsla(var(--primary),0.25)]' 
                : (isCurr 
                  ? 'bg-[hsla(var(--chart-4),0.15)] text-[hsl(39,60%,34%)] border-[hsla(var(--chart-4),0.35)]' 
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]');
              const icon = isDone 
                ? '<svg class="w-2.5 h-2.5 inline text-[hsl(var(--primary))]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' 
                : (isCurr 
                  ? '<svg class="w-2.5 h-2.5 inline animate-spin text-[hsl(39,60%,34%)]" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>'
                  : '<span class="inline-block w-1.5 h-1.5 rounded-full bg-[hsl(var(--input))]"></span>');
              return `<span class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border font-mono ${bg}">${s.stageName} ${icon}</span>`;
            }).join('')}
          </div>
        `;
      }

      const prettyJson = parsedJson ? JSON.stringify(parsedJson, null, 2) : (t.status_details ? JSON.stringify({ message: t.status_details }, null, 2) : '{}');

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[10px] font-medium px-2 py-0.5 rounded bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] border border-[hsl(var(--border))] tracking-wider uppercase">${t.type}</span>
            ${statusBadge}
          </div>
          <div class="flex items-center gap-1">
            <button class="check-now-btn text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] p-1 rounded hover:bg-[hsl(var(--secondary))] transition-colors" title="Check Now via Tathya API" data-id="${t.id}">
              <svg class="w-3.5 h-3.5 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
            <button class="delete-btn text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] p-1 rounded hover:bg-[hsla(var(--destructive),0.1)] transition-colors" title="Archive / Delete" data-id="${t.id}">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>

        <div>
          <a href="/${encodeURIComponent(t.identifier_number)}" class="font-mono text-xs sm:text-sm font-semibold text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] tracking-wide hover:underline flex items-center justify-between group">
            <span>${(t.type === 'EID' && (t.identifier_number || '').length === 28) ? `${t.identifier_number.slice(0, 4)}/${t.identifier_number.slice(4, 9)}/${t.identifier_number.slice(9, 14)}` : t.identifier_number}</span>
            <span class="text-[11px] text-[hsl(var(--muted-foreground))] font-sans font-normal flex items-center gap-1 group-hover:text-[hsl(var(--primary))] transition-colors">
              <span>View Dossier</span>
              <svg class="w-3 h-3 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M9 5l7 7-7 7"/>
              </svg>
            </span>
          </a>
          ${(t.type === 'EID' && (t.identifier_number || '').length === 28) ? `
            <div class="flex items-center gap-3 text-[10px] text-[hsl(var(--muted-foreground))] font-mono mt-0.5">
              <span class="inline-flex items-center gap-1">
                <svg class="w-3 h-3 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <span>${t.identifier_number.slice(20, 22)}/${t.identifier_number.slice(18, 20)}/${t.identifier_number.slice(14, 18)}</span>
              </span>
              <span class="inline-flex items-center gap-1">
                <svg class="w-3 h-3 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span>${t.identifier_number.slice(22, 24)}:${t.identifier_number.slice(24, 26)}:${t.identifier_number.slice(26, 28)}</span>
              </span>
            </div>` : ''}
          ${(t.type === 'SID' && (t.identifier_number || '').length === 28) ? `
            <div class="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))] font-mono mt-0.5">
              <span class="inline-flex items-center gap-1">
                <svg class="w-3 h-3 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
                <span>Physical Center Slip ('S' + 27 Digits)</span>
              </span>
            </div>` : ''}
        </div>
        
        ${t.status_details ? `<div class="text-xs text-[hsl(var(--foreground))] leading-relaxed bg-[hsl(var(--background))] p-2.5 rounded border border-[hsl(var(--border))] font-sans">${t.status_details}</div>` : ''}

        ${stagesHtml}

        <div class="bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded p-2.5 mt-1">
          <div class="flex items-center justify-between">
            <button type="button" class="toggle-json-btn text-[11px] font-mono font-medium text-[hsl(var(--primary))] hover:text-[hsl(var(--ring))] flex items-center gap-1.5 transition-colors">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
              <span>API JSON Payload</span>
              <svg class="json-arrow w-3 h-3 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M19 9l-7 7-7 7"/>
              </svg>
            </button>
            <button type="button" class="copy-json-btn text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] px-2 py-0.5 rounded bg-[hsl(var(--card))] border border-[hsl(var(--border))] font-mono transition-colors flex items-center gap-1">
              <svg class="copy-icon w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
              <span class="copy-text">Copy</span>
            </button>
          </div>
          <pre class="json-pre hidden mt-2 p-2.5 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-primary))] border border-[hsl(var(--sidebar-border))] rounded text-[10px] font-mono overflow-x-auto max-h-40 scrollbar-thin whitespace-pre leading-tight select-all">${prettyJson}</pre>
        </div>

        <div class="text-[10px] font-mono text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--card-border))] pt-2 flex items-center justify-between">
          <span>LAST VERIFIED:</span>
          <span class="text-[hsl(var(--foreground))] font-medium">${lastChecked}</span>
        </div>
      `;

      // Event listener for JSON toggle
      const toggleBtn = card.querySelector('.toggle-json-btn');
      const jsonPre = card.querySelector('.json-pre');
      const jsonArrow = card.querySelector('.json-arrow');
      toggleBtn.addEventListener('click', () => {
        jsonPre.classList.toggle('hidden');
        jsonArrow.classList.toggle('rotate-180');
      });

      // Event listener for Copy JSON
      const copyBtn = card.querySelector('.copy-json-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(prettyJson).then(() => {
          const copyText = copyBtn.querySelector('.copy-text');
          const original = copyText.innerText;
          copyText.innerText = 'Copied!';
          setTimeout(() => copyText.innerText = original, 1200);
        });
      });

      // Event listener for delete
      card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to remove this tracker from the ledger?')) {
          await fetch(`/api/trackers/${id}`, { method: 'DELETE' });
          loadTrackers();
        }
      });

      // Event listener for manual re-check
      card.querySelector('.check-now-btn').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const icon = e.currentTarget.querySelector('svg');
        icon.classList.add('animate-spin');
        await fetch(`/api/trackers/${id}/check`, { method: 'POST' });
        setTimeout(() => {
          icon.classList.remove('animate-spin');
          loadTrackers();
        }, 1200);
      });

      if (lists[status]) {
        if (lists[status].querySelector('.italic')) {
          lists[status].innerHTML = '';
        }
        lists[status].appendChild(card);
      }
    });

    counts.Processing.innerText = tally.Processing;
    counts.Completed.innerText = tally.Completed;
    counts.Failed.innerText = tally.Failed;
  }

  // Handle Form Submission
  trackerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    modalError.classList.add('hidden');

    const saveBtn = document.getElementById('saveTrackerBtn');
    saveBtn.disabled = true;
    saveBtn.innerText = 'Committing...';

    const type = document.getElementById('trackerType').value;
    let identifier_number = '';
    let date = '';
    let time = '';

    if (type === 'EID') {
      const mode = document.querySelector('input[name="eidMode"]:checked')?.value || '14digit';
      if (mode === '14digit') {
        const enr = document.getElementById('eid14Number').value.trim();
        date = document.getElementById('eidDate').value;
        time = document.getElementById('eidTime').value;

        if (!enr) {
          modalError.innerText = 'Please enter the 14-digit Enrolment Number.';
          modalError.classList.remove('hidden');
          saveBtn.disabled = false;
          saveBtn.innerText = 'Commit to Ledger';
          return;
        }
        if (!date || !time) {
          modalError.innerText = 'Please select both Enrolment Date and Enrolment Time.';
          modalError.classList.remove('hidden');
          saveBtn.disabled = false;
          saveBtn.innerText = 'Commit to Ledger';
          return;
        }
        identifier_number = enr;
      } else {
        const full28 = document.getElementById('eid28Number').value.trim();
        if (!full28 || full28.replace(/\D/g, '').length !== 28) {
          modalError.innerText = 'Please enter a valid 28-digit EID.';
          modalError.classList.remove('hidden');
          saveBtn.disabled = false;
          saveBtn.innerText = 'Commit to Ledger';
          return;
        }
        identifier_number = full28;
      }
    } else if (type === 'SID') {
      const sidVal = sidNumberInput.value.trim().toUpperCase().replace(/[\s\/\-_]/g, '');
      if (!sidVal) {
        modalError.innerText = "Please enter the SID Number ('S' followed by 27 digits).";
        modalError.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.innerText = 'Commit to Ledger';
        return;
      }
      if (sidVal.length !== 28 || !sidVal.startsWith('S')) {
        modalError.innerText = `Invalid SID (${sidVal.length} chars). SID must be 'S' followed by 27 digits (28 characters total, printed on acknowledgment slip while physically visiting Enrolment / Update center).`;
        modalError.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.innerText = 'Commit to Ledger';
        return;
      }
      identifier_number = sidVal;
    } else {
      identifier_number = document.getElementById('trackerNumber').value.trim();
      if (!identifier_number) {
        modalError.innerText = 'Please enter an identifier number.';
        modalError.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.innerText = 'Commit to Ledger';
        return;
      }
    }

    try {
      const res = await fetch('/api/trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, identifier_number, date, time })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add tracker');

      closeModal();
      loadTrackers();
    } catch (err) {
      modalError.innerText = err.message;
      modalError.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerText = 'Commit to Ledger';
    }
  });

  // Initial load
  loadTrackers();

  // Periodic polling every 10 seconds for real-time status updates
  setInterval(loadTrackers, 10000);
});
