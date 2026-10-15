document.addEventListener('DOMContentLoaded', async () => {
  // Check auth
  try {
    const meRes = await fetch('/api/me');
    const meData = await meRes.json();
    if (!meData.authenticated) {
      window.location.href = '/';
      return;
    }
    document.getElementById('userBadge').innerText = `👤 ${meData.username}`;
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
            livePulse.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
          } else {
            livePulse.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
          }
        }
      }
    } catch (e) {
      // Ignore transient polling drops
    }
  }

  setInterval(pollLiveStream, 1500);
  pollLiveStream();

  // Modal Actions
  const openModal = () => {
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('trackerNumber').focus();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    trackerForm.reset();
  };

  addBtn.addEventListener('click', openModal);
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);

  // Close modal when clicking on backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
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
          <div class="h-32 flex flex-col items-center justify-center text-slate-600 text-xs italic">
            No items in this pipeline
          </div>
        `;
      });
    }

    trackers.forEach(t => {
      const status = t.current_status || 'Processing';
      tally[status] = (tally[status] || 0) + 1;

      const card = document.createElement('div');
      card.className = 'bg-slate-800/90 border border-slate-700/60 rounded-xl p-4 shadow-sm hover:border-slate-500 transition-all flex flex-col gap-2.5';

      const lastChecked = t.last_checked_at 
        ? new Date(t.last_checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
        : 'Initial Check Pending';

      let statusBadge = '';
      if (status === 'Processing') {
        statusBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> In Progress</span>';
      } else if (status === 'Completed') {
        statusBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">✓ Completed</span>';
      } else {
        statusBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">⚠ Action Needed</span>';
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
              const bg = isDone ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : (isCurr ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-slate-850 text-slate-500 border-slate-800');
              const icon = isDone ? '✓' : (isCurr ? '⟳' : '○');
              return `<span class="text-[9px] px-1.5 py-0.5 rounded border font-mono ${bg}">${s.stageName} ${icon}</span>`;
            }).join('')}
          </div>
        `;
      }

      const prettyJson = parsedJson ? JSON.stringify(parsedJson, null, 2) : (t.status_details ? JSON.stringify({ message: t.status_details }, null, 2) : '{}');

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-950 text-indigo-300 border border-indigo-800 tracking-wider">${t.type}</span>
            ${statusBadge}
          </div>
          <div class="flex items-center gap-1.5">
            <button class="check-now-btn text-slate-400 hover:text-indigo-300 text-xs p-1 transition-colors" title="Check Now via API" data-id="${t.id}">🔄</button>
            <button class="delete-btn text-slate-400 hover:text-rose-400 text-xs p-1 transition-colors" title="Delete" data-id="${t.id}">&times;</button>
          </div>
        </div>

        <a href="/${encodeURIComponent(t.identifier_number)}" class="font-mono text-sm font-bold text-indigo-300 hover:text-indigo-200 tracking-wider hover:underline flex items-center justify-between">
          <span>${t.identifier_number}</span>
          <span class="text-xs text-slate-500 font-sans font-normal">Details &rarr;</span>
        </a>
        
        ${t.status_details ? `<div class="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">${t.status_details}</div>` : ''}

        ${stagesHtml}

        <div class="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 mt-1">
          <div class="flex items-center justify-between">
            <button type="button" class="toggle-json-btn text-[11px] font-mono font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
              <span>{ }</span>
              <span>API JSON Response</span>
              <span class="json-arrow text-[9px]">▼</span>
            </button>
            <button type="button" class="copy-json-btn text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 font-mono transition-colors">Copy</button>
          </div>
          <pre class="json-pre hidden mt-2 p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono text-emerald-400 overflow-x-auto max-h-36 scrollbar-thin whitespace-pre leading-tight select-all">${prettyJson}</pre>
        </div>

        <div class="text-[11px] text-slate-500 border-t border-slate-700/50 pt-2 flex items-center justify-between">
          <span>Last Checked:</span>
          <span class="text-slate-300 font-medium">${lastChecked}</span>
        </div>
      `;

      // Event listener for JSON toggle
      const toggleBtn = card.querySelector('.toggle-json-btn');
      const jsonPre = card.querySelector('.json-pre');
      const jsonArrow = card.querySelector('.json-arrow');
      toggleBtn.addEventListener('click', () => {
        jsonPre.classList.toggle('hidden');
        jsonArrow.innerText = jsonPre.classList.contains('hidden') ? '▼' : '▲';
      });

      // Event listener for Copy JSON
      const copyBtn = card.querySelector('.copy-json-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(prettyJson).then(() => {
          const original = copyBtn.innerText;
          copyBtn.innerText = 'Copied!';
          setTimeout(() => copyBtn.innerText = original, 1200);
        });
      });

      // Event listener for delete
      card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to remove this tracker?')) {
          await fetch(`/api/trackers/${id}`, { method: 'DELETE' });
          loadTrackers();
        }
      });

      // Event listener for manual re-check
      card.querySelector('.check-now-btn').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        e.currentTarget.classList.add('animate-spin');
        await fetch(`/api/trackers/${id}/check`, { method: 'POST' });
        setTimeout(loadTrackers, 1000);
      });

      if (lists[status]) {
        // If placeholder exists, remove it
        if (lists[status].querySelector('.text-slate-600')) {
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
    saveBtn.innerText = 'Adding...';

    const type = document.getElementById('trackerType').value;
    const identifier_number = document.getElementById('trackerNumber').value.trim();

    try {
      const res = await fetch('/api/trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, identifier_number })
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
      saveBtn.innerText = 'Start Tracking';
    }
  });

  // Initial load
  loadTrackers();

  // Periodic polling every 10 seconds for real-time status updates
  setInterval(loadTrackers, 10000);
});
