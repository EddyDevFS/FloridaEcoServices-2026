// ===== STATE =====
let state = {
  hotel: {
    id: 'demo-hotel-123',
    name: 'Grand Hotel Demo',
    buildings: [
      {
        id: 'building-1',
        name: 'Main Building',
        notes: 'Primary building with reception',
        floors: [
          {
            id: 'floor-1-1',
            nameOrNumber: '1',
            sortOrder: 1,
            notes: 'Ground floor with lobby',
            rooms: [
              { 
                id: 'room-101', 
                roomNumber: '101', 
                surface: 'CARPET', 
                active: true, 
                roomType: 'Standard',
                cleaningFrequency: 183,
                lastCleaned: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
                notes: 'Corner room'
              },
              { 
                id: 'room-102', 
                roomNumber: '102', 
                surface: 'TILE', 
                active: true, 
                roomType: 'Standard',
                cleaningFrequency: 183,
                lastCleaned: Date.now() - 50 * 24 * 60 * 60 * 1000
              },
              { 
                id: 'room-103', 
                roomNumber: '103', 
                surface: 'BOTH', 
                active: true, 
                roomType: 'Suite',
                cleaningFrequency: 90,
                lastCleaned: Date.now() - 20 * 24 * 60 * 60 * 1000
              },
            ],
            spaces: [
              { 
                id: 'space-1', 
                name: 'Main Lobby', 
                type: 'LOBBY', 
                sqft: 1200,
                cleaningFrequency: 30,
                notes: 'Marble floor'
              },
              { 
                id: 'space-2', 
                name: 'Corridor A', 
                type: 'CORRIDOR', 
                sqft: 800,
                cleaningFrequency: 183
              },
            ]
          }
        ]
      }
    ]
  },
  editing: {
    buildingId: null,
    floorId: null,
    roomId: null,
    spaceId: null
  },
  selectionMode: false,
  selectedRooms: new Set()
};

// ===== PERSISTENCE (LOCAL FIRST) =====
let persistTimer = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function ensureAppDataInitialized() {
  if (!window.HMP_DB) {
    console.warn('HMP_DB not loaded');
    return;
  }

  window.HMP_DB.init();
  // Always show an auth entry point, even in LOCAL_ONLY (to avoid user confusion).
  try { fecoRenderAuthBadge(null); } catch {}

  // Shadow mode: pull canonical dataset from backend into localStorage (read-first).
  try {
    const mode = window.HMP_DB.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
    if (mode && mode !== 'LOCAL_ONLY' && window.HMP_DB.apiPullLocalStorage) {
      let pulled = await window.HMP_DB.apiPullLocalStorage();
      if (pulled && pulled.status === 401) {
        // UI login handled by the login modal.
        await fecoEnsureLogin();
        pulled = await window.HMP_DB.apiPullLocalStorage();
      }
      if (mode === 'API_ONLY' && !pulled?.ok) {
        // API required: stop here to avoid editing a stale local dataset.
        throw new Error('API_ONLY requires API connectivity (pull failed).');
      }
    }
  } catch (e) {
    console.warn('API shadow pull failed:', e);
  }

  await fecoRefreshMe();

  // If we're in API mode and local storage is empty, prompt login proactively.
  try {
    const mode = window.HMP_DB.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    const hasHotels = (window.HMP_DB.getHotels?.() || []).length > 0;
    if (mode && mode !== 'LOCAL_ONLY' && !token && !hasHotels) {
      await fecoEnsureLogin();
    }
  } catch {}

  try { fecoRenderEmptyState(); } catch {}

  const activeHotel = window.HMP_DB.getActiveHotel();
  if (activeHotel) {
    state.hotel = deepClone(activeHotel);
    return;
  }

  window.HMP_DB.saveHotel(deepClone(state.hotel));
  window.HMP_DB.setActiveHotelId(state.hotel.id);
}

function saveCurrentHotel() {
  if (!window.HMP_DB) return;
  window.HMP_DB.saveHotel(deepClone(state.hotel));
  window.HMP_DB.setActiveHotelId(state.hotel.id);
}

function scheduleSaveAppData() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    saveCurrentHotel();
    updateHotelSelector();
  }, 250);
}

function updateHotelSelector() {
  const select = document.getElementById('hotelSelect');
  if (!select || !window.HMP_DB) return;

  const hotelEntries = window.HMP_DB.getHotels();
  hotelEntries.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'fr'));

  try { fecoRenderEmptyState(); } catch {}

  select.innerHTML = hotelEntries
    .map(h => `<option value="${h.id}" ${h.id === state.hotel.id ? 'selected' : ''}>${h.name || 'Unnamed hotel'}</option>`)
    .join('');

  const hotelNameInput = document.getElementById('contractHotelName');
  if (hotelNameInput) hotelNameInput.value = state.hotel.name || '';

  if (document.getElementById('roomList')) {
    renderPlanningRooms();
  }

  if (document.getElementById('wizardRoomList')) {
    renderWizardRooms();
  }

  if (document.getElementById('agendaFullGrid')) {
    renderAgendaFull();
  }

  if (document.getElementById('hotelPendingList')) {
    renderHotelDashboard();
  }
}

function onHotelSelected(hotelId) {
  if (!window.HMP_DB) return;
  const nextHotel = window.HMP_DB.getHotel(hotelId);
  if (!nextHotel) return;

  saveCurrentHotel();
  state.hotel = deepClone(nextHotel);
  window.HMP_DB.setActiveHotelId(state.hotel.id);
  state.editing = { buildingId: null, floorId: null, roomId: null, spaceId: null };
  state.selectionMode = false;
  state.selectedRooms.clear();
  renderAll();
  updateContractFormFromHotel();
  if (document.getElementById('wizardRoomList')) {
    resetWizardSelection();
    renderWizardRooms();
    renderWizardCommentRecap();
    updateWizardDuration();
  }
  showToast(`Switched to "${state.hotel.name}"`, 'info');
}

function createNewHotel() {
  const name = prompt('Hotel name?');
  if (!name || !name.trim()) return;
  if (!window.HMP_DB) ensureAppDataInitialized();

  saveCurrentHotel();
  const hotel = window.HMP_DB.createHotel(name.trim());
  state.hotel = deepClone(hotel);
  updateSaveStatus('saving');
  updateHotelSelector();
  updateContractFormFromHotel();
  renderAll();
  showToast(`Hotel "${hotel.name}" created`, 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

function renameActiveHotel() {
  const next = prompt('New hotel name?', state.hotel.name || '');
  if (!next || !next.trim()) return;
  state.hotel.name = next.trim();
  if (window.HMP_DB) window.HMP_DB.renameHotel(state.hotel.id, state.hotel.name);
  updateSaveStatus('saving');
  scheduleSaveAppData();
  updateContractFormFromHotel();
  renderAll();
  showToast('Hotel renamed', 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

let bulkModalData = {
  floorId: '',
  startRoomNumber: '',
  count: 20,
  surface: 'TILE',
  frequency: 183
};

let contractManual = {
  discount: false,
  final: false
};

let latestContractUrl = '';
let latestContractId = '';
let selectedPlanningRooms = new Set();
let selectedWizardRooms = new Set();
let selectedWizardSpaces = new Set();
let wizardManualRooms = new Set();
let wizardActiveFilters = new Set();
let wizardRoomNotes = new Map(); // roomId -> note (for this reservation)
let wizardSpaceNotes = new Map(); // spaceId -> note (for this reservation)
let wizardSurfaceDefault = 'BOTH'; // BOTH | CARPET | TILE
let wizardRoomSurfaceOverrides = new Map(); // roomId -> BOTH | CARPET | TILE
let wizardStep = 1;
let latestReservationUrl = '';
let agendaWeekOffset = 0;
let agendaFullWeekOffset = 0;

// ===== UTILITIES =====
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toastId = generateId('toast');
  
  const icons = {
    success: 'fas fa-check-circle',
    error: 'fas fa-exclamation-circle',
    warning: 'fas fa-exclamation-triangle',
    info: 'fas fa-info-circle'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.id = toastId;
  
  toast.innerHTML = `
    <i class="${icons[type]}" style="font-size: 20px;"></i>
    <div class="toast-content">
      <strong>${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
      <div>${message}</div>
    </div>
    <button class="toast-close" onclick="document.getElementById('${toastId}').remove()">×</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    if (document.getElementById(toastId)) {
      toast.style.animation = 'toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) reverse';
      setTimeout(() => toast.remove(), 400);
    }
  }, 4000);
}

function updateStats() {
  const buildings = state.hotel.buildings.length;
  let floors = 0;
  let rooms = 0;
  let spaces = 0;
  
  state.hotel.buildings.forEach(building => {
    floors += building.floors?.length || 0;
    building.floors?.forEach(floor => {
      rooms += floor.rooms?.length || 0;
      spaces += floor.spaces?.length || 0;
    });
  });
  
  document.getElementById('statsBuildings').textContent = `${buildings} buildings`;
  document.getElementById('statsFloors').textContent = `${floors} floors`;
  document.getElementById('statsRooms').textContent = `${rooms} rooms`;
  document.getElementById('statsSpaces').textContent = `${spaces} spaces`;
  
  // Update selected count
  const selectedCount = state.selectedRooms.size;
  if (selectedCount > 0) {
    document.getElementById('selectedRoomsCount').textContent = selectedCount;
    document.getElementById('statsSelected').style.display = 'flex';
    document.getElementById('selectedCount').textContent = `${selectedCount} selected`;
  } else {
    document.getElementById('statsSelected').style.display = 'none';
  }
}

function updateSaveStatus(status = 'saved') {
  const statusEl = document.getElementById('saveStatus');
  const icon = statusEl.querySelector('i');
  const text = statusEl.querySelector('span');
  
  if (status === 'saving') {
    icon.className = 'fas fa-spinner fa-spin';
    text.textContent = 'Saving...';
    statusEl.style.background = '#f59e0b';
    scheduleSaveAppData();
  } else {
    icon.className = 'fas fa-check-circle';
    text.textContent = 'Saved';
    statusEl.style.background = '#10b981';
  }
}

// ===== CONTRACT BUILDER =====
function getPricingDefaults() {
  if (!window.HMP_DB) return null;
  return window.HMP_DB.getPricingDefaults();
}

function getNumberValue(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const value = parseFloat(el.value);
  return Number.isFinite(value) ? value : 0;
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getPriceForSurface(prices, surfaceType) {
  if (!prices) return 0;
  if (surfaceType === 'CARPET') return prices.CARPET || 0;
  if (surfaceType === 'TILE') return prices.TILE || 0;
  return prices.BOTH || 0;
}

function updateContractFormFromHotel() {
  const hotelNameInput = document.getElementById('contractHotelName');
  if (hotelNameInput) hotelNameInput.value = state.hotel.name || '';
  const status = document.getElementById('contractStatus');
  if (status) {
    status.textContent = 'Draft';
    status.style.background = '#e2e8f0';
    status.style.color = '#475569';
  }
  contractManual = { discount: false, final: false };
  updateContractCalculations();
}

// ===== PLANNING =====
function getRoomDueCategory(room) {
  if (!room.active) return 'inactive';
  if (!room.lastCleaned || !room.cleaningFrequency) return 'clean';

  const daysSince = Math.floor((Date.now() - room.lastCleaned) / (1000 * 60 * 60 * 24));
  const daysUntil = room.cleaningFrequency - daysSince;

  if (daysUntil <= -60) return 'overdue_60';
  if (daysUntil < 0) return 'overdue_30';
  if (daysUntil <= 30) return 'due_30';
  if (daysUntil <= 60) return 'due_60';
  if (daysUntil <= 180) return 'due_180';
  return 'clean';
}

function getDaysUntilDue(room) {
  if (!room.lastCleaned || !room.cleaningFrequency) return null;
  const daysSince = Math.floor((Date.now() - room.lastCleaned) / (1000 * 60 * 60 * 24));
  return room.cleaningFrequency - daysSince;
}

function getRoomStatusLabel(status) {
  switch (status) {
    case 'inactive':
      return 'Inactive';
    case 'overdue_60':
      return 'Due 60+';
    case 'overdue_30':
      return 'Due 0-30';
    case 'due_30':
      return 'Due in 30';
    case 'due_60':
      return 'Due in 60';
    case 'due_180':
      return 'Due in 180';
    default:
      return 'Cleaned';
  }
}

function getAllRoomsWithContext() {
  const rooms = [];
  state.hotel.buildings.forEach(building => {
    (building.floors || []).forEach(floor => {
      (floor.rooms || []).forEach(room => {
        rooms.push({
          ...room,
          buildingId: building.id,
          buildingName: building.name,
          floorId: floor.id,
          floorName: floor.nameOrNumber
        });
      });
    });
  });
  return rooms;
}

function getAllSpacesWithContext() {
  const spaces = [];
  state.hotel.buildings.forEach(building => {
    (building.floors || []).forEach(floor => {
      (floor.spaces || []).forEach(space => {
        spaces.push({
          ...space,
          buildingId: building.id,
          buildingName: building.name,
          floorId: floor.id,
          floorName: floor.nameOrNumber
        });
      });
    });
  });
  return spaces;
}

function formatFloridaDateTime(dateStr, timeStr) {
  const base = `${dateStr}T${timeStr || '00:00'}:00`;
  const date = new Date(base);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function escapeHtml(value) {
  return (value || '').toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPlanningRooms() {
  const list = document.getElementById('roomList');
  if (!list) return;

  const buildings = state.hotel.buildings || [];
  if (!buildings.length) {
    list.innerHTML = '<div class="planning-item">No rooms yet. Configure the hotel first.</div>';
    return;
  }

  list.innerHTML = buildings.map(building => {
    const floors = building.floors || [];
    return `
      <div class="planning-group">
        <div class="planning-group-title">
          <i class="fas fa-building"></i> ${building.name || 'Building'}
        </div>
        ${floors.map(floor => {
          const rooms = floor.rooms || [];
          return `
            <div class="planning-subgroup">
              <div class="planning-subgroup-title">
                <i class="fas fa-layer-group"></i> Floor ${floor.nameOrNumber || ''}
              </div>
              ${rooms.length ? `
                <div class="planning-room-grid">
                  ${rooms.map(room => {
                    const status = getRoomDueCategory(room);
                    const statusLabel = getRoomStatusLabel(status);
                    const checked = selectedPlanningRooms.has(room.id) ? 'checked' : '';
                    const selectedClass = selectedPlanningRooms.has(room.id) ? 'selected' : '';
                    const label = String(room.roomNumber || '');
                    const lenClass = label.length >= 6 ? 'num-xlong' : (label.length >= 4 ? 'num-long' : '');
                    return `
                      <div class="room-square ${status} ${selectedClass} ${lenClass}" data-room-id="${room.id}" title="${statusLabel}">
                        <input type="checkbox" data-room-id="${room.id}" ${checked} />
                        <span class="room-number">${escapeHtml(label)}</span>
                        <button class="room-note-btn" data-note-id="${room.id}" title="Add note">
                          <i class="fas fa-comment"></i>
                        </button>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : '<div class="planning-item">No rooms on this floor.</div>'}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      const roomId = input.getAttribute('data-room-id');
      if (input.checked) selectedPlanningRooms.add(roomId);
      else selectedPlanningRooms.delete(roomId);
      const square = input.closest('.room-square');
      if (square) square.classList.toggle('selected', input.checked);
    });
  });

  list.querySelectorAll('.room-square').forEach(square => {
    square.addEventListener('click', (event) => {
      if (event.target.matches('input') || event.target.closest('.room-note-btn')) return;
      const roomId = square.getAttribute('data-room-id');
      const input = square.querySelector('input[type="checkbox"]');
      if (!roomId || !input) return;
      input.checked = !input.checked;
      if (input.checked) selectedPlanningRooms.add(roomId);
      else selectedPlanningRooms.delete(roomId);
      square.classList.toggle('selected', input.checked);
    });
  });

  list.querySelectorAll('.room-note-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const roomId = btn.getAttribute('data-note-id');
      if (!roomId) return;
      const room = getAllRoomsWithContext().find(r => r.id === roomId);
      if (!room) return;
      const next = prompt(`Note for room ${room.roomNumber}:`, room.notes || '');
      if (next === null) return;
      room.notes = next.trim();
      saveCurrentHotel();
      showToast('Room note saved', 'success');
    });
  });
}

function autoSelectDueRooms() {
  selectedPlanningRooms.clear();
  const rooms = getAllRoomsWithContext();
  rooms.forEach(room => {
    const status = getRoomDueCategory(room);
    if (status === 'overdue_60' || status === 'overdue_30') {
      selectedPlanningRooms.add(room.id);
    }
  });
  renderPlanningRooms();
  showToast('Selected due rooms', 'info');
}

function selectRoomsByWindow(days) {
  selectedPlanningRooms.clear();
  const rooms = getAllRoomsWithContext();
  rooms.forEach(room => {
    if (!room.active || !room.lastCleaned || !room.cleaningFrequency) return;
    const daysSince = Math.floor((Date.now() - room.lastCleaned) / (1000 * 60 * 60 * 24));
    const daysUntil = room.cleaningFrequency - daysSince;
    if (daysUntil < 0) return;
    if (daysUntil <= days) selectedPlanningRooms.add(room.id);
  });
  renderPlanningRooms();
  showToast(`Selected rooms due in ${days} days`, 'info');
}

function setWizardStep(step) {
  wizardStep = step;
  document.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-step') === String(step));
  });
  document.querySelectorAll('.wizard-panel').forEach(panel => {
    panel.style.display = panel.getAttribute('data-panel') === String(step) ? 'block' : 'none';
  });

  const backBtn = document.getElementById('wizardBackBtn');
  const nextBtn = document.getElementById('wizardNextBtn');
  if (backBtn) backBtn.disabled = step === 1;
  if (nextBtn) nextBtn.textContent = step === 3 ? 'Finish' : 'Next';
}

function resetWizardSelection() {
  selectedWizardRooms.clear();
  selectedWizardSpaces.clear();
  wizardManualRooms.clear();
  wizardActiveFilters.clear();
  wizardRoomNotes.clear();
  wizardSpaceNotes.clear();
  wizardRoomSurfaceOverrides.clear();
  wizardSurfaceDefault = 'BOTH';
}

function getSurfaceLabel(surface) {
  if (surface === 'CARPET') return 'Carpet only';
  if (surface === 'TILE') return 'Tile only';
  return 'Carpet & Tile';
}

function normalizeSurface(surface) {
  if (surface === 'CARPET' || surface === 'TILE' || surface === 'BOTH') return surface;
  return 'BOTH';
}

function getRoomSurface(roomId) {
  return wizardRoomSurfaceOverrides.get(roomId) || wizardSurfaceDefault;
}

function cycleSurface(surface) {
  const current = normalizeSurface(surface);
  if (current === 'BOTH') return 'TILE';
  if (current === 'TILE') return 'CARPET';
  return 'BOTH';
}

function setRoomSurfaceOverride(roomId, surface) {
  const next = normalizeSurface(surface);
  if (next === wizardSurfaceDefault) wizardRoomSurfaceOverrides.delete(roomId);
  else wizardRoomSurfaceOverrides.set(roomId, next);
}

function ensureWizardNoteModal() {
  if (document.getElementById('wizardNoteModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardNoteModal';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal" style="max-width: 640px;">
      <div class="modal-header">
        <h3><i class="fas fa-comment"></i> <span id="wizardNoteTitle">Note</span></h3>
        <button class="modal-close" id="wizardNoteClose">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row" id="wizardNoteSurfaceRow">
          <div class="form-field">
            <label>Cleaning type (this room)</label>
            <div class="planning-actions" style="justify-content:flex-start;">
              <button class="btn-secondary" id="wizardRoomSurfaceBoth" type="button">Carpet & Tile</button>
              <button class="btn-secondary" id="wizardRoomSurfaceCarpet" type="button">Carpet only</button>
              <button class="btn-secondary" id="wizardRoomSurfaceTile" type="button">Tile only</button>
            </div>
            <div class="hint">Default is applied to all rooms. Override here if needed.</div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="wizardNoteText">Comment for this cleaning</label>
            <textarea id="wizardNoteText" rows="4" placeholder="Optional note..."></textarea>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="wizardNoteClear" type="button"><i class="fas fa-eraser"></i> Clear</button>
        <button class="btn-primary" id="wizardNoteSave" type="button"><i class="fas fa-check"></i> Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
  overlay.querySelector('#wizardNoteClose')?.addEventListener('click', () => {
    overlay.style.display = 'none';
  });
}

function openWizardNoteEditor(target) {
  ensureWizardNoteModal();
  const overlay = document.getElementById('wizardNoteModal');
  if (!overlay) return;

  overlay.dataset.kind = target.kind;
  overlay.dataset.id = target.id;
  const title = overlay.querySelector('#wizardNoteTitle');
  const text = overlay.querySelector('#wizardNoteText');
  const saveBtn = overlay.querySelector('#wizardNoteSave');
  const clearBtn = overlay.querySelector('#wizardNoteClear');
  const surfaceRow = overlay.querySelector('#wizardNoteSurfaceRow');
  const surfaceBothBtn = overlay.querySelector('#wizardRoomSurfaceBoth');
  const surfaceCarpetBtn = overlay.querySelector('#wizardRoomSurfaceCarpet');
  const surfaceTileBtn = overlay.querySelector('#wizardRoomSurfaceTile');

  if (title) title.textContent = target.title || 'Note';

  const existing = target.kind === 'space'
    ? (wizardSpaceNotes.get(target.id) || '')
    : (wizardRoomNotes.get(target.id) || '');
  if (text) text.value = existing;

  if (surfaceRow) surfaceRow.style.display = target.kind === 'room' ? '' : 'none';
  let currentSurface = target.kind === 'room' ? getRoomSurface(target.id) : 'BOTH';

  const paintSurfaceButtons = () => {
    if (!surfaceBothBtn || !surfaceCarpetBtn || !surfaceTileBtn) return;
    surfaceBothBtn.classList.toggle('btn-primary', currentSurface === 'BOTH');
    surfaceCarpetBtn.classList.toggle('btn-primary', currentSurface === 'CARPET');
    surfaceTileBtn.classList.toggle('btn-primary', currentSurface === 'TILE');
    surfaceBothBtn.classList.toggle('btn-secondary', currentSurface !== 'BOTH');
    surfaceCarpetBtn.classList.toggle('btn-secondary', currentSurface !== 'CARPET');
    surfaceTileBtn.classList.toggle('btn-secondary', currentSurface !== 'TILE');
  };

  if (surfaceBothBtn) surfaceBothBtn.onclick = () => { currentSurface = 'BOTH'; paintSurfaceButtons(); };
  if (surfaceCarpetBtn) surfaceCarpetBtn.onclick = () => { currentSurface = 'CARPET'; paintSurfaceButtons(); };
  if (surfaceTileBtn) surfaceTileBtn.onclick = () => { currentSurface = 'TILE'; paintSurfaceButtons(); };
  paintSurfaceButtons();

  const commit = (next) => {
    const value = (next || '').trim();
    if (target.kind === 'space') {
      if (!value) wizardSpaceNotes.delete(target.id);
      else wizardSpaceNotes.set(target.id, value);
    } else {
      if (!value) wizardRoomNotes.delete(target.id);
      else wizardRoomNotes.set(target.id, value);
      setRoomSurfaceOverride(target.id, currentSurface);
    }
    renderWizardRooms();
    renderWizardCommentRecap();
    renderWizardSummary();
  };

  if (saveBtn) {
    saveBtn.onclick = () => {
      commit(text?.value || '');
      overlay.style.display = 'none';
      showToast('Note saved', 'success');
    };
  }
  if (clearBtn) {
    clearBtn.onclick = () => {
      commit('');
      overlay.style.display = 'none';
      showToast('Note cleared', 'info');
    };
  }

  overlay.style.display = 'flex';
  setTimeout(() => text?.focus(), 0);
}

function renderWizardCommentRecap() {
  const box = document.getElementById('wizardCommentRecap');
  if (!box) return;

  const rooms = getAllRoomsWithContext()
    .filter(r => selectedWizardRooms.has(r.id))
    .sort((a, b) => (a.buildingName || '').localeCompare(b.buildingName || '') ||
      (String(a.floorName || '')).localeCompare(String(b.floorName || '')) ||
      (String(a.roomNumber || '')).localeCompare(String(b.roomNumber || '')));
  const spaces = getAllSpacesWithContext()
    .filter(s => selectedWizardSpaces.has(s.id))
    .sort((a, b) => (a.buildingName || '').localeCompare(b.buildingName || '') ||
      (String(a.floorName || '')).localeCompare(String(b.floorName || '')) ||
      (String(a.name || '')).localeCompare(String(b.name || '')));

  const groupKey = (r) => `${r.buildingName || 'Building'}|||${r.floorName || ''}`;
  const grouped = new Map();
  rooms.forEach(room => {
    const key = groupKey(room);
    if (!grouped.has(key)) grouped.set(key, { building: room.buildingName || 'Building', floor: room.floorName || '', rooms: [] });
    grouped.get(key).rooms.push(room);
  });

  const floorBlocks = Array.from(grouped.values()).map(group => {
    const bySurface = new Map([['BOTH', []], ['CARPET', []], ['TILE', []]]);
    group.rooms.forEach(room => {
      const surface = getRoomSurface(room.id);
      if (!bySurface.has(surface)) bySurface.set(surface, []);
      bySurface.get(surface).push(room.roomNumber);
    });

    const lines = ['BOTH', 'CARPET', 'TILE']
      .map(surface => {
        const list = bySurface.get(surface) || [];
        if (!list.length) return null;
        return `<div><strong>${escapeHtml(getSurfaceLabel(surface))}</strong><br>Room: ${escapeHtml(list.join(', '))}</div>`;
      })
      .filter(Boolean)
      .join('<br>');

    const notes = group.rooms
      .map(room => {
        const note = (wizardRoomNotes.get(room.id) || '').trim();
        if (!note) return null;
        return `<div><strong>Note</strong><br>Room ${escapeHtml(room.roomNumber)}: ${escapeHtml(note)}</div>`;
      })
      .filter(Boolean)
      .join('<br>');

    const areas = spaces
      .filter(s => (s.buildingName || 'Building') === group.building && (s.floorName || '') === group.floor)
      .map(s => s.sqft ? `${s.name} (${s.sqft} sqft)` : s.name);
    const areasLine = areas.length ? `<div><strong>Areas</strong><br>${areas.map(escapeHtml).join(', ')}</div>` : '';

    return `
      <div class="planning-item">
        <div>
          <strong>${escapeHtml(group.building)} · Floor ${escapeHtml(group.floor)}</strong>
          <small style="display:block; margin-top:6px;">${lines}${areasLine ? `<br><br>${areasLine}` : ''}${notes ? `<br><br>${notes}` : ''}</small>
        </div>
      </div>
    `;
  }).join('');

  const ungroupedSpaces = spaces.filter(s => {
    const key = `${s.buildingName || 'Building'}|||${s.floorName || ''}`;
    return !grouped.has(key);
  });

  const spacesBlock = ungroupedSpaces.length
    ? `
      <div class="planning-item">
        <div>
          <strong>Areas</strong>
          <small>${ungroupedSpaces.map(s => escapeHtml(s.sqft ? `${s.name} (${s.sqft} sqft)` : s.name)).join(', ')}</small>
        </div>
      </div>
    `
    : '';

  box.innerHTML = (floorBlocks || spacesBlock)
    ? `${floorBlocks}${spacesBlock}`
    : '<div class="planning-item">Select rooms/areas above. Use 💬 to add notes or override surfaces per room.</div>';
}

function renderWizardRooms() {
  const list = document.getElementById('wizardRoomList');
  if (!list) return;

  const buildings = state.hotel.buildings || [];
  if (!buildings.length) {
    list.innerHTML = '<div class="planning-item">No rooms yet. Configure the hotel first.</div>';
    return;
  }

  list.innerHTML = buildings.map(building => {
    const floors = building.floors || [];
    return `
      <div class="planning-group">
        <div class="planning-group-title">
          <i class="fas fa-building"></i> ${building.name || 'Building'}
        </div>
        ${floors.map(floor => {
          const rooms = floor.rooms || [];
          const spaces = floor.spaces || [];
          return `
            <div class="planning-subgroup">
              <div class="planning-subgroup-title">
                <i class="fas fa-layer-group"></i> Floor ${floor.nameOrNumber || ''}
              </div>
              ${rooms.length ? `
                <div class="planning-room-grid">
                  ${rooms.map(room => {
                    const status = getRoomDueCategory(room);
                    const statusLabel = getRoomStatusLabel(status);
                    const checked = selectedWizardRooms.has(room.id) ? 'checked' : '';
                    const selectedClass = selectedWizardRooms.has(room.id) ? 'selected' : '';
                    const note = wizardRoomNotes.get(room.id) || '';
                    const noteClass = note.trim() ? 'has-note' : '';
                    const surface = getRoomSurface(room.id);
                    const surfaceClass = surface === 'CARPET' ? 'surface-carpet' : surface === 'TILE' ? 'surface-tile' : 'surface-both';
                    const surfaceShort = surface === 'CARPET' ? 'C' : surface === 'TILE' ? 'T' : 'CT';
                    const surfaceOverride = wizardRoomSurfaceOverrides.has(room.id);
                    const overrideClass = surfaceOverride ? 'has-override' : '';
                    const label = String(room.roomNumber || '');
                    const lenClass = label.length >= 6 ? 'num-xlong' : (label.length >= 4 ? 'num-long' : '');
                    return `
                      <div class="room-square ${status} ${selectedClass} ${lenClass}" data-room-id="${room.id}" title="${statusLabel}">
                        <input type="checkbox" data-room-id="${room.id}" ${checked} />
                        <span class="room-number">${escapeHtml(label)}</span>
                        <button class="room-surface-btn ${surfaceClass} ${overrideClass}" data-surface-room-id="${room.id}" title="Surface: ${getSurfaceLabel(surface)} (click to change)">
                          ${surfaceShort}
                        </button>
                        <button class="room-note-btn ${noteClass}" data-note-room-id="${room.id}" title="${note.trim() ? 'Edit note' : 'Add note'}">
                          <i class="fas fa-comment"></i>
                        </button>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : '<div class="planning-item">No rooms on this floor.</div>'}
              ${spaces.length ? `
                <div class="planning-room-grid" style="margin-top: 8px;">
                  ${spaces.map(space => {
                    const checked = selectedWizardSpaces.has(space.id) ? 'checked' : '';
                    const selectedClass = selectedWizardSpaces.has(space.id) ? 'selected' : '';
                    const label = space.sqft ? `${space.name} (${space.sqft} sqft)` : space.name;
                    const note = wizardSpaceNotes.get(space.id) || '';
                    const noteClass = note.trim() ? 'has-note' : '';
                    return `
                      <div class="room-square clean ${selectedClass}" data-space-id="${space.id}" title="${label}">
                        <input type="checkbox" data-space-id="${space.id}" ${checked} />
                        <span>${escapeHtml(space.name)}</span>
                        <button class="room-note-btn ${noteClass}" data-note-space-id="${space.id}" title="${note.trim() ? 'Edit note' : 'Add note'}">
                          <i class="fas fa-comment"></i>
                        </button>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  list.querySelectorAll('input[type="checkbox"][data-room-id]').forEach(input => {
    input.addEventListener('change', () => {
      const roomId = input.getAttribute('data-room-id');
      if (input.checked) wizardManualRooms.add(roomId);
      else wizardManualRooms.delete(roomId);
      const square = input.closest('.room-square');
      if (square) square.classList.toggle('selected', input.checked);
      updateWizardSelectionFromFilters();
      updateWizardDuration();
      renderWizardCommentRecap();
    });
  });

  list.querySelectorAll('input[type="checkbox"][data-space-id]').forEach(input => {
    input.addEventListener('change', () => {
      const spaceId = input.getAttribute('data-space-id');
      if (input.checked) selectedWizardSpaces.add(spaceId);
      else selectedWizardSpaces.delete(spaceId);
      const square = input.closest('.room-square');
      if (square) square.classList.toggle('selected', input.checked);
      updateWizardDuration();
      renderWizardCommentRecap();
    });
  });

  list.querySelectorAll('.room-square').forEach(square => {
    square.addEventListener('click', (event) => {
      if (event.target.matches('input') || event.target.closest('.room-note-btn') || event.target.closest('.room-surface-btn')) return;
      const roomId = square.getAttribute('data-room-id');
      const spaceId = square.getAttribute('data-space-id');
      const input = square.querySelector('input[type="checkbox"]');
      if (!input) return;
      input.checked = !input.checked;
      if (roomId) {
        if (input.checked) wizardManualRooms.add(roomId);
        else wizardManualRooms.delete(roomId);
      }
      if (spaceId) {
        if (input.checked) selectedWizardSpaces.add(spaceId);
        else selectedWizardSpaces.delete(spaceId);
      }
      updateWizardSelectionFromFilters();
      updateWizardDuration();
      renderWizardCommentRecap();
      square.classList.toggle('selected', input.checked);
    });
  });

  list.querySelectorAll('button[data-note-room-id]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const roomId = btn.getAttribute('data-note-room-id');
      const room = getAllRoomsWithContext().find(r => r.id === roomId);
      if (!room) return;
      openWizardNoteEditor({ kind: 'room', id: roomId, title: `Room ${room.roomNumber} notes` });
    });
  });

  list.querySelectorAll('button[data-surface-room-id]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const roomId = btn.getAttribute('data-surface-room-id');
      if (!roomId) return;
      if (!selectedWizardRooms.has(roomId)) {
        showToast('Select the room first', 'info');
        return;
      }
      const current = getRoomSurface(roomId);
      const next = cycleSurface(current);
      setRoomSurfaceOverride(roomId, next);
      renderWizardRooms();
      renderWizardCommentRecap();
      renderWizardSummary();
    });
  });

  list.querySelectorAll('button[data-note-space-id]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const spaceId = btn.getAttribute('data-note-space-id');
      const space = getAllSpacesWithContext().find(s => s.id === spaceId);
      if (!space) return;
      openWizardNoteEditor({ kind: 'space', id: spaceId, title: `${space.name} notes` });
    });
  });

  renderWizardCommentRecap();
}

function wizardSelectByWindow(mode) {
  if (wizardActiveFilters.has(mode)) {
    wizardActiveFilters.delete(mode);
  } else {
    wizardActiveFilters.add(mode);
  }
  updateWizardSelectionFromFilters();
  renderWizardRooms();
  updateWizardDuration();
}

function updateWizardSelectionFromFilters() {
  const rooms = getAllRoomsWithContext();
  const filtered = new Set();

  rooms.forEach(room => {
    const daysUntil = getDaysUntilDue(room);
    if (daysUntil == null) return;

    if (wizardActiveFilters.has('dueNow') && daysUntil >= -15 && daysUntil <= 15) {
      filtered.add(room.id);
    }
    if (wizardActiveFilters.has('past15') && daysUntil < 0 && daysUntil >= -15) {
      filtered.add(room.id);
    }
    if (wizardActiveFilters.has('past30') && daysUntil < -15 && daysUntil >= -30) {
      filtered.add(room.id);
    }
    if (wizardActiveFilters.has('coming30') && daysUntil >= 0 && daysUntil <= 30) {
      filtered.add(room.id);
    }
    if (wizardActiveFilters.has('coming60') && daysUntil > 30 && daysUntil <= 60) {
      filtered.add(room.id);
    }
  });

  selectedWizardRooms = new Set([...wizardManualRooms, ...filtered]);
}

function estimateDurationMinutes() {
  const roomsMinutes = selectedWizardRooms.size * 30;
  const spaces = getAllSpacesWithContext().filter(space => selectedWizardSpaces.has(space.id));
  const corridorMinutes = spaces.reduce((total, space) => {
    if (!space.sqft) return total;
    const chunks = Math.ceil(space.sqft / 250);
    return total + (chunks * 10);
  }, 0);
  return roomsMinutes + corridorMinutes;
}

function updateWizardDuration() {
  const durationEl = document.getElementById('wizardDuration');
  if (!durationEl) return;
  const minutes = estimateDurationMinutes();
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  durationEl.value = minutes ? `${hours}h ${String(mins).padStart(2, '0')}m` : '0h 00m';
}

function renderWizardSummary() {
  const summary = document.getElementById('wizardSummary');
  if (!summary) return;

  const surfaceDefault = normalizeSurface(document.getElementById('wizardSurfaceDefault')?.value || wizardSurfaceDefault);
  wizardSurfaceDefault = surfaceDefault;

  const rooms = getAllRoomsWithContext()
    .filter(r => selectedWizardRooms.has(r.id))
    .sort((a, b) => (a.buildingName || '').localeCompare(b.buildingName || '') ||
      (String(a.floorName || '')).localeCompare(String(b.floorName || '')) ||
      (String(a.roomNumber || '')).localeCompare(String(b.roomNumber || '')));
  const spaces = getAllSpacesWithContext()
    .filter(s => selectedWizardSpaces.has(s.id))
    .sort((a, b) => (a.buildingName || '').localeCompare(b.buildingName || '') ||
      (String(a.floorName || '')).localeCompare(String(b.floorName || '')) ||
      (String(a.name || '')).localeCompare(String(b.name || '')));

  const groupKey = (r) => `${r.buildingName || 'Building'}|||${r.floorName || ''}`;
  const grouped = new Map();
  rooms.forEach(room => {
    const key = groupKey(room);
    if (!grouped.has(key)) grouped.set(key, { building: room.buildingName || 'Building', floor: room.floorName || '', rooms: [] });
    grouped.get(key).rooms.push(room);
  });

  const floorBlocks = Array.from(grouped.values()).map(group => {
    const bySurface = new Map([['BOTH', []], ['CARPET', []], ['TILE', []]]);
    group.rooms.forEach(room => {
      const surface = getRoomSurface(room.id);
      if (!bySurface.has(surface)) bySurface.set(surface, []);
      bySurface.get(surface).push(room.roomNumber);
    });

    const lines = ['BOTH', 'CARPET', 'TILE']
      .map(surface => {
        const list = bySurface.get(surface) || [];
        if (!list.length) return null;
        return `<div><strong>${escapeHtml(getSurfaceLabel(surface))}</strong><br>Room: ${escapeHtml(list.join(', '))}</div>`;
      })
      .filter(Boolean)
      .join('<br>');

    const notes = group.rooms
      .map(room => {
        const note = (wizardRoomNotes.get(room.id) || '').trim();
        if (!note) return null;
        return `<div><strong>Note</strong><br>Room ${escapeHtml(room.roomNumber)}: ${escapeHtml(note)}</div>`;
      })
      .filter(Boolean)
      .join('<br>');

    const areas = spaces
      .filter(s => (s.buildingName || 'Building') === group.building && (s.floorName || '') === group.floor)
      .map(s => s.sqft ? `${s.name} (${s.sqft} sqft)` : s.name);
    const areasLine = areas.length ? `<div><strong>Areas</strong><br>${areas.map(escapeHtml).join(', ')}</div>` : '';

    return `
      <div class="planning-item">
        <div>
          <strong>${escapeHtml(group.building)} · Floor ${escapeHtml(group.floor)}</strong>
          <small style="display:block; margin-top:6px;">${lines}${areasLine ? `<br><br>${areasLine}` : ''}${notes ? `<br><br>${notes}` : ''}</small>
        </div>
      </div>
    `;
  }).join('');

  const ungroupedSpaces = spaces.filter(s => {
    const key = `${s.buildingName || 'Building'}|||${s.floorName || ''}`;
    return !grouped.has(key);
  });
  const spacesBlock = ungroupedSpaces.length
    ? `
      <div class="planning-item">
        <div>
          <strong>Areas</strong>
          <small>${ungroupedSpaces.map(s => escapeHtml(s.sqft ? `${s.name} (${s.sqft} sqft)` : s.name)).join(', ')}</small>
        </div>
      </div>
    `
    : '';

  summary.innerHTML = `
    <div class="planning-item">
      <strong>Rooms</strong>
      <small>${selectedWizardRooms.size} selected</small>
    </div>
    <div class="planning-item">
      <strong>Spaces</strong>
      <small>${selectedWizardSpaces.size} selected</small>
    </div>
    <div class="planning-item">
      <strong>Cleaning type (default)</strong>
      <small>${escapeHtml(getSurfaceLabel(surfaceDefault))}</small>
    </div>
    <div class="planning-item">
      <strong>Duration</strong>
      <small>${document.getElementById('wizardDuration')?.value || '-'}</small>
    </div>
    <div class="planning-item">
      <strong>Date</strong>
      <small>${document.getElementById('wizardDate')?.value || '-'}</small>
    </div>
    ${floorBlocks || spacesBlock ? `<div class="planning-item"><strong>Recap</strong><small style="display:block; margin-top:8px;">${floorBlocks}${spacesBlock}</small></div>` : ''}
  `;
}

function openWizard() {
  const modal = document.getElementById('reservationWizard');
  if (!modal) return;
  modal.style.display = 'flex';
  resetWizardSelection();
  const surfaceSelect = document.getElementById('wizardSurfaceDefault');
  if (surfaceSelect) surfaceSelect.value = wizardSurfaceDefault;
  renderWizardRooms();
  updateWizardDuration();
  setWizardStep(1);
}

function closeWizard() {
  const modal = document.getElementById('reservationWizard');
  if (!modal) return;
  modal.style.display = 'none';
}

function completeWizard() {
  if (!window.HMP_DB) return;
  const date = document.getElementById('wizardDate')?.value;
  const start = document.getElementById('wizardStart')?.value;
  if (!date || !start) {
    showToast('Please choose date and start time', 'warning');
    return false;
  }
  const anyReservation = window.HMP_DB.listReservations().some(resv =>
    !isReservationCancelled(resv) && resv.proposedDate === date
  );
  if (isDateBlocked(date) || anyReservation) {
    showToast('Date is already reserved. Please choose another date.', 'warning');
    return false;
  }
  if (!selectedWizardRooms.size && !selectedWizardSpaces.size) {
    showToast('Select at least one room or space', 'warning');
    return false;
  }

  const roomNotes = {};
  Array.from(selectedWizardRooms).forEach(id => {
    const note = (wizardRoomNotes.get(id) || '').trim();
    if (note) roomNotes[id] = note;
  });
  const spaceNotes = {};
  Array.from(selectedWizardSpaces).forEach(id => {
    const note = (wizardSpaceNotes.get(id) || '').trim();
    if (note) spaceNotes[id] = note;
  });
  const surfaceDefault = normalizeSurface(document.getElementById('wizardSurfaceDefault')?.value || wizardSurfaceDefault);
  wizardSurfaceDefault = surfaceDefault;
  const roomSurfaceOverrides = {};
  Array.from(selectedWizardRooms).forEach(id => {
    const override = wizardRoomSurfaceOverrides.get(id);
    if (override && override !== surfaceDefault) roomSurfaceOverrides[id] = override;
  });

  const reservation = window.HMP_DB.createReservation({
    hotelId: state.hotel.id,
    roomIds: Array.from(selectedWizardRooms),
    spaceIds: Array.from(selectedWizardSpaces),
    roomNotes,
    spaceNotes,
    surfaceDefault,
    roomSurfaceOverrides,
    notesGlobal: document.getElementById('wizardGlobalNotes')?.value || '',
    notesOrg: document.getElementById('wizardOrgNotes')?.value || '',
    durationMinutes: estimateDurationMinutes(),
    proposedDate: date,
    proposedStart: start
  });

  const origin = window.location.origin === 'null' ? '' : window.location.origin;
  const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
  latestReservationUrl = `${origin}${basePath}reservation_view.html?token=${reservation.token}&role=hotel`;

  const linkInput = document.getElementById('wizardLink');
  if (linkInput) linkInput.value = latestReservationUrl;

  renderWizardSummary();
  showToast('Reservation link created', 'success');
  return true;
}

function getHalfHourSlots(start, end) {
  const slots = [];
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  let minutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  while (minutes <= endMinutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
    minutes += 30;
  }
  return slots;
}

function formatAmPm(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = ((h + 11) % 12 + 1);
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function populateTimeSelect(selectId, start = '06:00', end = '20:00') {
  const select = document.getElementById(selectId);
  if (!select) return;
  const slots = getHalfHourSlots(start, end);
  select.innerHTML = slots
    .map(value => `<option value="${value}">${formatAmPm(value)}</option>`)
    .join('');
}

function isReservationCancelled(resv) {
  return (
    resv?.statusAdmin === 'CANCELLED' ||
    resv?.statusHotel === 'CANCELLED' ||
    !!resv?.cancelledAt
  );
}

function isDateBlocked(date) {
  const blockedSlots = window.HMP_DB.listBlockedSlots();
  const hasBlocked = blockedSlots.some(slot => slot.date === date);
  const approved = window.HMP_DB.listReservations().some(resv =>
    !isReservationCancelled(resv) &&
    resv.proposedDate === date &&
    resv.statusAdmin === 'APPROVED' &&
    resv.statusHotel === 'APPROVED'
  );
  return hasBlocked || approved;
}

function renderAgendaGrid() {
  const grid = document.getElementById('agendaGrid');
  if (!grid || !window.HMP_DB) return;

  const settings = window.HMP_DB.getSettings();
  const workStart = settings.workHours?.start || '08:00';
  const workEnd = settings.workHours?.end || '17:00';
  const slots = getHalfHourSlots(workStart, workEnd);

  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset + (agendaWeekOffset * 7));

  const days = Array.from({ length: 7 }, (_, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    const iso = date.toISOString().split('T')[0];
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
    return { iso, label, date };
  });

  const reservations = window.HMP_DB.listReservations().filter(resv =>
    resv.statusAdmin === 'APPROVED' && resv.statusHotel === 'APPROVED'
  );
  const blocks = window.HMP_DB.listBlockedSlots();
  const hotels = window.HMP_DB.getHotels();
  const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h.name]));

  const header = `
    <div class="agenda-row agenda-header">
      <div class="agenda-cell time"></div>
      ${days.map(day => `<div class="agenda-cell day">${day.label}<br><small>${day.iso}</small></div>`).join('')}
    </div>
  `;

  const rows = slots.map(slot => {
    return `
      <div class="agenda-row">
        <div class="agenda-cell time">${formatAmPm(slot)}</div>
        ${days.map(day => {
          const dayBlocked = blocks.some(b => b.date === day.iso);
          const dayReservations = reservations.filter(r => r.proposedDate === day.iso);
          let cellClass = 'agenda-cell';
          let content = '';
          let token = '';
          if (dayBlocked) {
            cellClass += ' blocked';
            content = 'Blocked';
          } else if (dayReservations.length) {
            cellClass += ' booked';
            if (dayReservations.length === 1) {
              const hotelName = hotelMap[dayReservations[0].hotelId] || 'Hotel';
              content = `${hotelName}`;
              token = dayReservations[0].token;
            } else {
              content = `${dayReservations.length} reservations`;
            }
          }
          return `<div class="${cellClass}" data-resv-token="${token}">${content}</div>`;
        }).join('')}
      </div>
    `;
  }).join('');

  grid.innerHTML = header + rows;

  grid.querySelectorAll('.agenda-cell.booked').forEach(cell => {
    const token = cell.getAttribute('data-resv-token');
    if (!token) return;
    cell.addEventListener('click', () => {
      const origin = window.location.origin === 'null' ? '' : window.location.origin;
      const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
      window.open(`${origin}${basePath}reservation_view.html?token=${token}&role=admin`, '_blank');
    });
  });

  const summary = document.getElementById('planningSummary');
  if (summary && days.length) {
    const start = days[0].iso;
    const end = days[6].iso;
    summary.textContent = `Week ${start} → ${end}`;
  }
}

function renderAgendaFull() {
  const grid = document.getElementById('agendaFullGrid');
  if (!grid || !window.HMP_DB) return;

  const settings = window.HMP_DB.getSettings();
  const workStart = settings.workHours?.start || '08:00';
  const workEnd = settings.workHours?.end || '17:00';
  const slots = getHalfHourSlots(workStart, workEnd);

  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset + (agendaFullWeekOffset * 7));

  const days = Array.from({ length: 7 }, (_, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    const iso = date.toISOString().split('T')[0];
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
    return { iso, label };
  });

  let reservations = window.HMP_DB.listReservations();
  const filterHotel = document.getElementById('agendaHotelFilter')?.value || 'ALL';
  const statusFilter = document.getElementById('agendaStatusFilter')?.value || 'APPROVED';
  const hotelOnlySelect = document.getElementById('hotelSelect');
  if (hotelOnlySelect) {
    const activeHotel = window.HMP_DB.getActiveHotelId();
    reservations = reservations.filter(resv => resv.hotelId === activeHotel);
  }

  const filtered = reservations.filter(resv => {
    if (filterHotel !== 'ALL' && resv.hotelId !== filterHotel) return false;
    if (statusFilter === 'APPROVED') {
      return resv.statusAdmin === 'APPROVED' && resv.statusHotel === 'APPROVED';
    }
    return true;
  });

  const blocks = window.HMP_DB.listBlockedSlots();
  const hotels = window.HMP_DB.getHotels();
  const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h.name]));

  const header = `
    <div class="agenda-row agenda-header">
      <div class="agenda-cell time"></div>
      ${days.map(day => `<div class="agenda-cell day">${day.label}<br><small>${day.iso}</small></div>`).join('')}
    </div>
  `;

  const rows = slots.map(slot => {
    return `
      <div class="agenda-row">
        <div class="agenda-cell time">${formatAmPm(slot)}</div>
        ${days.map(day => {
          const dayBlocked = blocks.some(b => b.date === day.iso);
          const dayReservations = filtered.filter(r => r.proposedDate === day.iso);
          let cellClass = 'agenda-cell';
          let content = '';
          let token = '';
          if (dayBlocked) {
            cellClass += ' blocked';
            content = 'Blocked';
          } else if (dayReservations.length) {
            cellClass += ' booked';
            if (dayReservations.length === 1) {
              const hotelName = hotelMap[dayReservations[0].hotelId] || 'Hotel';
              content = `${hotelName}`;
              token = dayReservations[0].token;
            } else {
              content = `${dayReservations.length} reservations`;
            }
          }
          return `<div class="${cellClass}" data-resv-token="${token}">${content}</div>`;
        }).join('')}
      </div>
    `;
  }).join('');

  grid.innerHTML = header + rows;

  grid.querySelectorAll('.agenda-cell.booked').forEach(cell => {
    const token = cell.getAttribute('data-resv-token');
    if (!token) return;
    cell.addEventListener('click', () => {
      const origin = window.location.origin === 'null' ? '' : window.location.origin;
      const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
      window.open(`${origin}${basePath}reservation_view.html?token=${token}`, '_blank');
    });
  });
}

function initAgendaPage() {
  if (!document.getElementById('agendaFullGrid')) return;
  const hotelSelect = document.getElementById('agendaHotelFilter');
  if (hotelSelect && window.HMP_DB) {
    const hotels = window.HMP_DB.getHotels();
    hotelSelect.innerHTML = `
      <option value="ALL">All hotels</option>
      ${hotels.map(h => `<option value="${h.id}">${h.name}</option>`).join('')}
    `;
  }

  const statusSelect = document.getElementById('agendaStatusFilter');
  if (statusSelect) statusSelect.addEventListener('change', renderAgendaFull);
  if (hotelSelect) hotelSelect.addEventListener('change', renderAgendaFull);

  const prev = document.getElementById('agendaPrevWeek');
  const next = document.getElementById('agendaNextWeek');
  if (prev) prev.addEventListener('click', () => {
    agendaFullWeekOffset -= 1;
    renderAgendaFull();
  });
  if (next) next.addEventListener('click', () => {
    agendaFullWeekOffset += 1;
    renderAgendaFull();
  });

  const exportBtn = document.getElementById('agendaExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const reservations = window.HMP_DB.listReservations();
      const lines = [
        'hotelId,hotelName,date,start,statusAdmin,statusHotel,durationMinutes'
      ];
      const hotels = window.HMP_DB.getHotels();
      const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h.name]));
      reservations.forEach(resv => {
        lines.push([
          resv.hotelId,
          `"${hotelMap[resv.hotelId] || ''}"`,
          resv.proposedDate || '',
          resv.proposedStart || '',
          resv.statusAdmin || '',
          resv.statusHotel || '',
          resv.durationMinutes || 0
        ].join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'agenda-export.csv';
      link.click();
    });
  }

  renderAgendaFull();
}

function computeAnnualReportLocal(hotelId, year) {
  const y = Number(year);
  const totals = { CARPET: 0, TILE: 0, BOTH: 0 };
  const months = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, CARPET: 0, TILE: 0, BOTH: 0, totalRooms: 0 }));

  const reservations = (window.HMP_DB?.listReservations?.() || [])
    .filter(r => r?.hotelId === hotelId)
    .filter(r => r?.statusAdmin === 'APPROVED' && r?.statusHotel === 'APPROVED');

  reservations.forEach(r => {
    let iso = String(r.confirmedAt || r.proposedDate || '').trim();
    if (!iso) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return;
      iso = d.toISOString().slice(0, 10);
    }
    if (iso.slice(0, 4) !== String(y)) return;
    const mIdx = Number(iso.slice(5, 7)) - 1;
    if (!(mIdx >= 0 && mIdx < 12)) return;

    const roomIds = Array.isArray(r.roomIds) ? r.roomIds : [];
    const overrides = (r.roomSurfaceOverrides && typeof r.roomSurfaceOverrides === 'object') ? r.roomSurfaceOverrides : {};
    const defaultSurface = String(r.surfaceDefault || 'BOTH').toUpperCase();
    roomIds.forEach((rid) => {
      const surface = String(overrides?.[rid] ?? defaultSurface).toUpperCase();
      const s = surface === 'CARPET' || surface === 'TILE' || surface === 'BOTH' ? surface : 'BOTH';
      totals[s] += 1;
      months[mIdx][s] += 1;
      months[mIdx].totalRooms += 1;
    });
  });

  return {
    year: y,
    hotelId,
    totals,
    derived: { carpetEquivalent: totals.CARPET + totals.BOTH, tileEquivalent: totals.TILE + totals.BOTH },
    months
  };
}

function computeRoadmapLocal(hotelId, date) {
  const reservations = (window.HMP_DB?.listReservations?.() || [])
    .filter(r => r?.hotelId === hotelId)
    .filter(r => r?.statusAdmin === 'APPROVED' && r?.statusHotel === 'APPROVED')
    .filter(r => String(r.proposedDate || '').trim() === String(date || '').trim())
    .sort((a, b) => String(a.proposedStart || '').localeCompare(String(b.proposedStart || '')));

  const roomById = new Map();
  const spaceById = new Map();
  (state.hotel?.buildings || []).forEach(b => {
    (b.floors || []).forEach(f => {
      (f.rooms || []).forEach(r => roomById.set(r.id, r));
      (f.spaces || []).forEach(s => spaceById.set(s.id, s));
    });
  });

  const openTasks = (window.HMP_DB?.listTasksByHotel?.(hotelId) || [])
    .filter(t => t.status !== 'DONE');

  const items = reservations.map(r => {
    const roomIds = Array.isArray(r.roomIds) ? r.roomIds : [];
    const spaceIds = Array.isArray(r.spaceIds) ? r.spaceIds : [];
    const overrides = (r.roomSurfaceOverrides && typeof r.roomSurfaceOverrides === 'object') ? r.roomSurfaceOverrides : {};
    const roomNotes = (r.roomNotes && typeof r.roomNotes === 'object') ? r.roomNotes : {};
    const spaceNotes = (r.spaceNotes && typeof r.spaceNotes === 'object') ? r.spaceNotes : {};
    const defaultSurface = String(r.surfaceDefault || 'BOTH').toUpperCase();

    const rooms = roomIds.map(id => {
      const base = roomById.get(id);
      const surface = String(overrides?.[id] ?? defaultSurface).toUpperCase();
      const s = surface === 'CARPET' || surface === 'TILE' || surface === 'BOTH' ? surface : 'BOTH';
      return {
        id,
        roomNumber: base?.roomNumber || '',
        sqft: base?.sqft ?? null,
        surface: s,
        note: String(roomNotes?.[id] || '').trim()
      };
    }).sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || ''));

    const spaces = spaceIds.map(id => {
      const base = spaceById.get(id);
      return {
        id,
        name: base?.name || '',
        type: base?.type || 'CORRIDOR',
        sqft: base?.sqft ?? null,
        note: String(spaceNotes?.[id] || '').trim()
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const locationIds = new Set([...roomIds, ...spaceIds].map(String));
    const tasks = openTasks.filter(t => (t.locations || []).some(l => (l.roomId && locationIds.has(String(l.roomId))) || (l.spaceId && locationIds.has(String(l.spaceId)))));

    return {
      id: r.id,
      token: r.token,
      proposedStart: r.proposedStart || '',
      durationMinutes: Number(r.durationMinutes) || 0,
      notesGlobal: r.notesGlobal || '',
      notesOrg: r.notesOrg || '',
      rooms,
      spaces,
      tasks: tasks.map(t => ({ id: t.id, status: t.status, priority: t.priority, type: t.type, description: t.description, assignedStaffId: t.assignedStaffId || null }))
    };
  });

  return { hotelId, date, reservations: items };
}

function initReportsPage() {
  if (!document.getElementById('annualSummary')) return;
  if (!window.HMP_DB) return;

  const annualSummary = document.getElementById('annualSummary');
  const annualByMonth = document.getElementById('annualByMonth');
  const roadmapList = document.getElementById('roadmapList');
  const yearSelect = document.getElementById('reportYear');
  const dateInput = document.getElementById('roadmapDate');
  const refreshAnnualBtn = document.getElementById('refreshAnnualBtn');
  const refreshRoadmapBtn = document.getElementById('refreshRoadmapBtn');
  const printAnnualBtn = document.getElementById('printAnnualBtn');
  const printRoadmapBtn = document.getElementById('printRoadmapBtn');

  const now = new Date();
  const currentYear = now.getFullYear();
  if (yearSelect) {
    yearSelect.innerHTML = [currentYear, currentYear - 1, currentYear - 2]
      .map(y => `<option value="${y}">${y}</option>`)
      .join('');
  }
  if (dateInput) dateInput.value = now.toISOString().slice(0, 10);

  const renderAnnual = (report) => {
    if (!annualSummary || !annualByMonth) return;
    const totals = report?.totals || { CARPET: 0, TILE: 0, BOTH: 0 };
    const derived = report?.derived || { carpetEquivalent: (totals.CARPET || 0) + (totals.BOTH || 0), tileEquivalent: (totals.TILE || 0) + (totals.BOTH || 0) };
    annualSummary.innerHTML = `
      <div class="planning-item">
        <div>
          <strong>Rooms cleaned (year ${report?.year || ''})</strong>
          <small>Carpet: ${derived.carpetEquivalent} • Tile: ${derived.tileEquivalent} • Both: ${totals.BOTH || 0}</small>
        </div>
      </div>
    `;

    const months = Array.isArray(report?.months) ? report.months : [];
    const max = Math.max(1, ...months.map(m => Number(m.totalRooms) || 0));
    annualByMonth.innerHTML = months.length
      ? months.map(m => {
          const total = Number(m.totalRooms) || 0;
          const pct = Math.round((total / max) * 100);
          return `
            <div class="planning-item">
              <div style="flex:1;">
                <strong>${String(m.month).padStart(2, '0')}</strong>
                <small>${total} room(s) • Carpet ${Number(m.CARPET || 0) + Number(m.BOTH || 0)} • Tile ${Number(m.TILE || 0) + Number(m.BOTH || 0)}</small>
                <div style="margin-top:8px; height:10px; border-radius:999px; background:rgba(15,23,42,0.08); overflow:hidden; border:1px solid rgba(15,23,42,0.10);">
                  <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#2d5af1,#0ea5e9); border-radius:999px;"></div>
                </div>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="planning-item">No data for this year.</div>';
  };

  const renderRoadmap = (roadmap) => {
    if (!roadmapList) return;
    const items = Array.isArray(roadmap?.reservations) ? roadmap.reservations : [];
    roadmapList.innerHTML = items.length
      ? items.map(r => {
          const rooms = Array.isArray(r.rooms) ? r.rooms : [];
          const spaces = Array.isArray(r.spaces) ? r.spaces : [];
          const tasks = Array.isArray(r.tasks) ? r.tasks : [];
          const roomLines = rooms.slice(0, 60).map(room => {
            const surface = room.surface === 'CARPET' ? 'Carpet' : room.surface === 'TILE' ? 'Tile' : 'Both';
            return `<div style="display:flex; gap:10px; justify-content:space-between;"><span><b>${escapeHtml(room.roomNumber || '')}</b> <span style="opacity:.75">(${surface})</span></span><span style="opacity:.75">${escapeHtml(room.note || '')}</span></div>`;
          }).join('') || '<div style="opacity:.75">No rooms selected.</div>';
          const spaceLines = spaces.slice(0, 30).map(s => `<div style="display:flex; gap:10px; justify-content:space-between;"><span><b>${escapeHtml(s.name || '')}</b> <span style="opacity:.75">(${escapeHtml(s.type || '')})</span></span><span style="opacity:.75">${escapeHtml(s.note || '')}</span></div>`).join('');
          const taskLines = tasks.slice(0, 30).map(t => `<div><b>${escapeHtml(t.type || 'TASK')}</b> • ${escapeHtml(t.priority || '')} • ${escapeHtml(t.status || '')}<div style="opacity:.75">${escapeHtml(t.description || '')}</div></div>`).join('');
          return `
            <div class="planning-item" style="display:block;">
              <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
                <div>
                  <strong>${escapeHtml(roadmap.date || '')} • ${escapeHtml(r.proposedStart || '')}</strong>
                  <small>${rooms.length} room(s) • ${spaces.length} space(s) • ${tasks.length} open task(s)</small>
                </div>
                <button class="btn-secondary btn-hotel" type="button" onclick="window.open('reservation_view.html?token=${encodeURIComponent(r.token)}&role=hotel','_blank')">
                  <i class="fas fa-link"></i> Link
                </button>
              </div>
              <div style="margin-top:10px; display:grid; gap:10px;">
                <div class="planning-item" style="background:rgba(15,23,42,0.02); border:1px solid rgba(15,23,42,0.08); border-radius:12px; padding:10px;">
                  <b>Rooms</b>
                  <div style="margin-top:8px; display:grid; gap:6px;">${roomLines}</div>
                </div>
                ${spaceLines ? `
                  <div class="planning-item" style="background:rgba(15,23,42,0.02); border:1px solid rgba(15,23,42,0.08); border-radius:12px; padding:10px;">
                    <b>Spaces</b>
                    <div style="margin-top:8px; display:grid; gap:6px;">${spaceLines}</div>
                  </div>
                ` : ''}
                ${taskLines ? `
                  <div class="planning-item" style="background:rgba(15,23,42,0.02); border:1px solid rgba(15,23,42,0.08); border-radius:12px; padding:10px;">
                    <b>Open tasks</b>
                    <div style="margin-top:8px; display:grid; gap:8px;">${taskLines}</div>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')
      : '<div class="planning-item">No approved reservation for this date yet.</div>';
  };

  const refreshAnnual = async () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const year = Number(yearSelect?.value || currentYear);
    if (!hotelId) return;
    try {
      const r = await window.HMP_DB.apiGetAnnualReport?.(hotelId, year);
      if (r?.status === 401) {
        await fecoEnsureLogin();
      } else if (r?.ok) {
        renderAnnual(r.report);
        return;
      }
    } catch {}
    renderAnnual(computeAnnualReportLocal(hotelId, year));
  };

  const refreshRoadmap = async () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const date = String(dateInput?.value || '').trim();
    if (!hotelId || !date) return;
    try {
      const r = await window.HMP_DB.apiGetRoadmap?.(hotelId, date);
      if (r?.status === 401) {
        await fecoEnsureLogin();
      } else if (r?.ok) {
        renderRoadmap(r.roadmap);
        return;
      }
    } catch {}
    renderRoadmap(computeRoadmapLocal(hotelId, date));
  };

  refreshAnnualBtn?.addEventListener('click', refreshAnnual);
  refreshRoadmapBtn?.addEventListener('click', refreshRoadmap);
  yearSelect?.addEventListener('change', refreshAnnual);
  dateInput?.addEventListener('change', refreshRoadmap);
  printAnnualBtn?.addEventListener('click', () => window.print());
  printRoadmapBtn?.addEventListener('click', () => window.print());

  const hotelSelect = document.getElementById('hotelSelect');
  hotelSelect?.addEventListener('change', () => setTimeout(() => {
    refreshAnnual();
    refreshRoadmap();
  }, 0));

  refreshAnnual();
  refreshRoadmap();
}

function initHotelWizard() {
  if (!document.getElementById('wizardRoomList')) return;
  populateTimeSelect('wizardStart');

  const wizardBack = document.getElementById('wizardBackBtn');
  const wizardNext = document.getElementById('wizardNextBtn');
  if (wizardBack) wizardBack.addEventListener('click', () => setWizardStep(Math.max(1, wizardStep - 1)));
  if (wizardNext) {
    wizardNext.addEventListener('click', () => {
      if (wizardStep === 1) {
        setWizardStep(2);
      } else if (wizardStep === 2) {
        const ok = completeWizard();
        if (ok) setWizardStep(3);
      } else {
        window.location.href = 'hotel_dashboard.html';
      }
    });
  }

  const wizardDueNow = document.getElementById('wizardDueNow');
  if (wizardDueNow) wizardDueNow.addEventListener('click', () => wizardSelectByWindow('dueNow'));
  const wizardPast15 = document.getElementById('wizardPast15');
  if (wizardPast15) wizardPast15.addEventListener('click', () => wizardSelectByWindow('past15'));
  const wizardPast30 = document.getElementById('wizardPast30');
  if (wizardPast30) wizardPast30.addEventListener('click', () => wizardSelectByWindow('past30'));
  const wizardComing30 = document.getElementById('wizardComing30');
  if (wizardComing30) wizardComing30.addEventListener('click', () => wizardSelectByWindow('coming30'));
  const wizardComing60 = document.getElementById('wizardComing60');
  if (wizardComing60) wizardComing60.addEventListener('click', () => wizardSelectByWindow('coming60'));

  const wizardSurface = document.getElementById('wizardSurfaceDefault');
  if (wizardSurface) {
    wizardSurface.value = wizardSurfaceDefault;
    wizardSurface.addEventListener('change', () => {
      wizardSurfaceDefault = normalizeSurface(wizardSurface.value);
      renderWizardCommentRecap();
      renderWizardSummary();
    });
  }

  renderWizardRooms();
  updateWizardDuration();
  setWizardStep(1);
}

function renderHotelDashboard() {
  const pendingList = document.getElementById('hotelPendingList');
  const upcomingList = document.getElementById('hotelUpcomingList');
  if (!pendingList || !upcomingList || !window.HMP_DB) return;

  const hotelId = window.HMP_DB.getActiveHotelId();
  const reservations = window.HMP_DB.listReservationsByHotel(hotelId);
  const cancelled = reservations.filter(resv => isReservationCancelled(resv));
  const pending = reservations.filter(resv =>
    !isReservationCancelled(resv) &&
    (resv.statusHotel !== 'APPROVED' || resv.statusAdmin !== 'APPROVED')
  );
  const approved = reservations.filter(resv =>
    !isReservationCancelled(resv) &&
    resv.statusHotel === 'APPROVED' && resv.statusAdmin === 'APPROVED'
  );

  const pendingBadge = document.getElementById('hotelPendingBadge');
  if (pendingBadge) pendingBadge.textContent = pending.length;

  const pendingHtml = pending.length
    ? pending.map(resv => `
        <div class="planning-item">
          <div>
            <strong>${resv.proposedDate || 'TBD'}</strong>
            <small>Admin ${resv.statusAdmin} / Hotel ${resv.statusHotel}</small>
          </div>
          <button class="btn-secondary btn-hotel" data-resv-link="${resv.token}">
            <i class="fas fa-link"></i>
          </button>
        </div>
      `).join('')
    : '<div class="planning-item">No pending reservations.</div>';

  const cancelledHtml = cancelled.length
    ? cancelled.map(resv => `
        <div class="planning-item">
          <div>
            <strong>${resv.proposedDate || 'TBD'}</strong>
            <small>CANCELLED</small>
          </div>
          <button class="btn-secondary btn-hotel" data-resv-link="${resv.token}">
            <i class="fas fa-link"></i>
          </button>
        </div>
      `).join('')
    : '';

  pendingList.innerHTML = `${pendingHtml}${cancelledHtml ? `<div class="planning-item"><strong>Cancelled</strong></div>${cancelledHtml}` : ''}`;

  upcomingList.innerHTML = approved.length
    ? approved.map(resv => `
        <div class="planning-item">
          <div>
            <strong>${resv.proposedDate || 'TBD'}</strong>
            <small>${resv.proposedStart || ''}</small>
          </div>
          <button class="btn-secondary btn-hotel" data-resv-link="${resv.token}">
            <i class="fas fa-link"></i>
          </button>
        </div>
      `).join('')
    : '<div class="planning-item">No upcoming reservations.</div>';

  document.querySelectorAll('button[data-resv-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const token = btn.getAttribute('data-resv-link');
      const origin = window.location.origin === 'null' ? '' : window.location.origin;
      const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
      window.open(`${origin}${basePath}reservation_view.html?token=${token}&role=hotel`, '_blank');
    });
  });
}

function initHotelIncidents() {
  if (!document.getElementById('incidentList')) return;
  const list = document.getElementById('incidentList');
  const button = document.getElementById('createIncidentBtn');
  if (!window.HMP_DB || !list || !button) return;
  const hotelSelect = document.getElementById('hotelSelect');

  const render = () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const incidents = window.HMP_DB.listIncidentsByHotel(hotelId);
    const staff = window.HMP_DB.listStaffByHotel(hotelId, { includeInactive: true });
    const staffById = Object.fromEntries(staff.map(member => [member.id, member]));
    const staffCreateSelect = document.getElementById('incidentAssignee');
    const renderStaffOptions = (selectedId) => [
      `<option value="" ${!selectedId ? 'selected' : ''}>Unassigned</option>`,
      ...staff.map(member => {
        const label = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
        const suffix = member.active === false ? ' (inactive)' : '';
        const selected = selectedId === member.id ? 'selected' : '';
        return `<option value="${member.id}" ${selected}>${label}${suffix}</option>`;
      })
    ].join('');

    if (staffCreateSelect) staffCreateSelect.innerHTML = renderStaffOptions('');

    list.innerHTML = incidents.length
      ? incidents.map(incident => `
          <div class="planning-item">
            <div>
              <strong>${incident.room || 'Area'}</strong>
              <small>${incident.category || 'INCIDENT'} · ${incident.type} · ${incident.priority} · ${incident.status}</small>
            </div>
            <small>${incident.description || ''}</small>
            <div class="planning-actions" style="margin-top: 10px;">
              <select class="hotel-select" data-incident-assign="${incident.id}" aria-label="Assign staff">
                ${renderStaffOptions(incident.assignedStaffId || '')}
              </select>
              <button class="btn-secondary btn-hotel" data-incident-events="${incident.id}">
                <i class="fas fa-list"></i> History
              </button>
            </div>
          </div>
        `).join('')
      : '<div class="planning-item">No incidents yet.</div>';

    list.querySelectorAll('select[data-incident-assign]').forEach(select => {
      select.addEventListener('change', async () => {
        const incidentId = select.getAttribute('data-incident-assign');
        const staffId = select.value || null;
        const member = staffById[staffId];
        window.HMP_DB.updateIncident(incidentId, { assignedStaffId: staffId });
        const ev = window.HMP_DB.addIncidentEvent(incidentId, {
          action: staffId ? 'ASSIGNED' : 'UNASSIGNED',
          actorRole: 'hotel_manager',
          note: staffId ? `Assigned to ${((member?.firstName || '') + ' ' + (member?.lastName || '')).trim()}` : 'Removed assignment',
          patch: { assignedStaffId: staffId }
        });

        // Persist to API (incidents are tasks under the hood).
        const persist = async () => {
          const res = await window.HMP_DB.apiPatchTaskByLegacy?.(incidentId, { assignedStaffId: staffId });
          if (res?.status === 401) {
            await fecoEnsureLogin();
            return window.HMP_DB.apiPatchTaskByLegacy?.(incidentId, { assignedStaffId: staffId });
          }
          if (res?.status === 404) {
            await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
            return window.HMP_DB.apiPatchTaskByLegacy?.(incidentId, { assignedStaffId: staffId });
          }
          return res;
        };

        try {
          const r = await persist();
          if (r?.ok && ev) {
            await window.HMP_DB.apiCreateTaskEventByLegacy?.(incidentId, {
              action: ev.action,
              note: ev.note || '',
              actorRole: ev.actorRole || 'hotel_manager',
              actorStaffId: ev.actorStaffId || null,
              patch: ev.patch || null
            });
          }
        } catch {}

        showToast(staffId ? 'Assigned' : 'Unassigned', 'success');
        render();
      });
    });

    list.querySelectorAll('button[data-incident-events]').forEach(btn => {
      btn.addEventListener('click', () => {
        const incidentId = btn.getAttribute('data-incident-events');
        const incident = window.HMP_DB.getData().incidents?.[incidentId];
        const events = Array.isArray(incident?.events) ? incident.events : [];
        if (!events.length) {
          showToast('No history yet', 'info');
          return;
        }
        const lines = events
          .slice(-10)
          .map(ev => `${(ev.at || '').slice(0, 16).replace('T', ' ')} · ${ev.action}${ev.note ? ` · ${ev.note}` : ''}`);
        alert(lines.join('\n'));
      });
    });
  };

  button.addEventListener('click', () => {
    const room = document.getElementById('incidentRoom')?.value?.trim();
    const category = document.getElementById('incidentCategory')?.value || 'INCIDENT';
    const type = document.getElementById('incidentType')?.value || 'OTHER';
    const priority = document.getElementById('incidentPriority')?.value || 'NORMAL';
    const assignedStaffId = document.getElementById('incidentAssignee')?.value || null;
    const description = document.getElementById('incidentDescription')?.value?.trim() || '';
    if (!room) {
      showToast('Room or area is required', 'warning');
      return;
    }
    window.HMP_DB.addIncident({
      hotelId: window.HMP_DB.getActiveHotelId(),
      room,
      category,
      type,
      priority,
      assignedStaffId,
      description
    });
    document.getElementById('incidentRoom').value = '';
    document.getElementById('incidentDescription').value = '';
    render();
    showToast('Incident reported', 'success');
  });

  render();
  if (hotelSelect) hotelSelect.addEventListener('change', () => setTimeout(render, 0));
}

function initHotelTasksManager() {
  if (!document.getElementById('taskList')) return;
  const list = document.getElementById('taskList');
  const button = document.getElementById('createTaskBtn');
  if (!window.HMP_DB || !list || !button) return;

  const counters = document.getElementById('taskCounters');
  const hotelSelect = document.getElementById('hotelSelect');

  const filterStatus = document.getElementById('taskFilterStatus');
  const filterPriority = document.getElementById('taskFilterPriority');
  const filterAssignee = document.getElementById('taskFilterAssignee');
  const filterSearch = document.getElementById('taskFilterSearch');
  const presetActive = document.getElementById('taskPresetActive');
  const presetPast = document.getElementById('taskPresetPast');

  const createType = document.getElementById('taskType');
  const createPriority = document.getElementById('taskPriority');
  const createAssignee = document.getElementById('taskAssignee');
  const createDescription = document.getElementById('taskDescription');

  const chooseTargetsBtn = document.getElementById('chooseTaskTargetsBtn');
  const targetsSummary = document.getElementById('taskTargetsSummary');
  const targetModal = document.getElementById('taskTargetModal');
  const closeTargetModal = document.getElementById('closeTaskTargetModal');
  const confirmTargetsBtn = document.getElementById('confirmTaskTargetsBtn');
  const clearTargetsBtn = document.getElementById('clearTaskTargetsBtn');
  const targetList = document.getElementById('taskTargetList');
  const targetSearch = document.getElementById('taskTargetSearch');

  const scheduleMode = document.getElementById('taskScheduleMode');
  const exactWrap = document.getElementById('taskExactWrap');
  const exactTimeWrap = document.getElementById('taskExactTimeWrap');
  const rangeWrap = document.getElementById('taskRangeWrap');
  const exactDate = document.getElementById('taskDate');
  const exactTime = document.getElementById('taskTime');
  const rangeStartDate = document.getElementById('taskStartDate');
  const rangeStartTime = document.getElementById('taskStartTime');
  const rangeEndDate = document.getElementById('taskEndDate');
  const rangeEndTime = document.getElementById('taskEndTime');

  const selectedTaskRooms = new Set();
  const selectedTaskSpaces = new Set();

  const renderAssigneeSelect = (select, staff, opts = {}) => {
    const { includeUnassigned = true, unassignedLabel = 'Unassigned', includeAll = false } = opts;
    const options = [];
    if (includeAll) options.push('<option value="ALL">All</option>');
    if (includeUnassigned) options.push(`<option value="">${unassignedLabel}</option>`);
    options.push(...staff.map(member => {
      const label = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
      const suffix = member.active === false ? ' (inactive)' : '';
      return `<option value="${member.id}">${label}${suffix}</option>`;
    }));
    select.innerHTML = options.join('');
  };

  const getBaseUrl = () => {
    const origin = window.location.origin === 'null' ? '' : window.location.origin;
    const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
    return `${origin}${basePath}`;
  };

  const computeCounters = (tasks) => {
    const open = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED').length;
    const urgent = tasks.filter(t => t.status !== 'DONE' && t.priority === 'URGENT').length;
    const done = tasks.filter(t => t.status === 'DONE').length;
    return { open, urgent, done, total: tasks.length };
  };

  const openModal = () => {
    if (!targetModal) return;
    if (targetSearch) targetSearch.value = '';
    renderTargetModal();
    targetModal.style.display = 'flex';
  };

  const closeModal = () => {
    if (!targetModal) return;
    targetModal.style.display = 'none';
  };

  const getTargetSummaryText = () => {
    const count = selectedTaskRooms.size + selectedTaskSpaces.size;
    if (count === 0) return 'No selection';
    const parts = [];
    if (selectedTaskRooms.size) parts.push(`${selectedTaskRooms.size} room${selectedTaskRooms.size > 1 ? 's' : ''}`);
    if (selectedTaskSpaces.size) parts.push(`${selectedTaskSpaces.size} area${selectedTaskSpaces.size > 1 ? 's' : ''}`);
    return parts.join(' · ');
  };

  const updateTargetsSummary = () => {
    if (!targetsSummary) return;
    targetsSummary.textContent = getTargetSummaryText();
  };

  const makeTargetsPayload = () => {
    const rooms = getAllRoomsWithContext().filter(r => selectedTaskRooms.has(r.id));
    const spaces = getAllSpacesWithContext().filter(s => selectedTaskSpaces.has(s.id));
    const targets = [];
    rooms.forEach(room => {
      targets.push({
        kind: 'room',
        buildingId: room.buildingId || null,
        floorId: room.floorId || null,
        roomId: room.id,
        label: `${room.buildingName ? `${room.buildingName} · ` : ''}${room.floorName ? `Floor ${room.floorName} · ` : ''}Room ${room.roomNumber}`
      });
    });
    spaces.forEach(space => {
      const label = space.sqft ? `${space.name} (${space.sqft} sqft)` : space.name;
      targets.push({
        kind: 'space',
        buildingId: space.buildingId || null,
        floorId: space.floorId || null,
        spaceId: space.id,
        label: `${space.buildingName ? `${space.buildingName} · ` : ''}${space.floorName ? `Floor ${space.floorName} · ` : ''}${label}`
      });
    });
    return targets;
  };

  const renderTargetModal = () => {
    if (!targetList) return;
    const buildings = state.hotel.buildings || [];
    if (!buildings.length) {
      targetList.innerHTML = '<div class="planning-item">No rooms yet. Configure the hotel first.</div>';
      return;
    }

    const query = (targetSearch?.value || '').trim().toLowerCase();
    const match = (text) => !query || (text || '').toString().toLowerCase().includes(query);

    targetList.innerHTML = buildings.map(building => {
      const floors = building.floors || [];
      const buildingName = building.name || 'Building';
      const floorBlocks = floors.map(floor => {
        const floorLabel = `Floor ${floor.nameOrNumber || ''}`.trim();
        const rooms = (floor.rooms || [])
          .filter(room => match(`${buildingName} ${floorLabel} ${room.roomNumber}`));
        const spaces = (floor.spaces || [])
          .filter(space => match(`${buildingName} ${floorLabel} ${space.name}`));

        if (!rooms.length && !spaces.length) return '';

        return `
          <div class="planning-subgroup">
            <div class="planning-subgroup-title">
              <i class="fas fa-layer-group"></i> ${floorLabel}
            </div>
            ${rooms.length ? `
              <div class="planning-room-grid">
                ${rooms.map(room => {
                  const status = getRoomDueCategory(room);
                  const statusLabel = getRoomStatusLabel(status);
                  const checked = selectedTaskRooms.has(room.id) ? 'checked' : '';
                  const selectedClass = selectedTaskRooms.has(room.id) ? 'selected' : '';
                  const label = String(room.roomNumber || '');
                  const lenClass = label.length >= 6 ? 'num-xlong' : (label.length >= 4 ? 'num-long' : '');
                  return `
                    <div class="room-square ${status} ${selectedClass} ${lenClass}" data-task-room="${room.id}" title="${statusLabel}">
                      <input type="checkbox" data-task-room="${room.id}" ${checked} />
                      <span class="room-number">${escapeHtml(label)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
            ${spaces.length ? `
              <div class="planning-room-grid" style="margin-top: 10px;">
                ${spaces.map(space => {
                  const label = space.sqft ? `${space.name} (${space.sqft} sqft)` : space.name;
                  const checked = selectedTaskSpaces.has(space.id) ? 'checked' : '';
                  const selectedClass = selectedTaskSpaces.has(space.id) ? 'selected' : '';
                  return `
                    <div class="room-square clean ${selectedClass}" data-task-space="${space.id}" title="${label}">
                      <input type="checkbox" data-task-space="${space.id}" ${checked} />
                      <span>${escapeHtml(space.name)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).filter(Boolean).join('');

      if (!floorBlocks) return '';

      return `
        <div class="planning-group">
          <div class="planning-group-title"><i class="fas fa-building"></i> ${buildingName}</div>
          ${floorBlocks}
        </div>
      `;
    }).filter(Boolean).join('') || '<div class="planning-item">No match.</div>';

    targetList.querySelectorAll('input[type="checkbox"][data-task-room]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-task-room');
        if (input.checked) selectedTaskRooms.add(id);
        else selectedTaskRooms.delete(id);
        const square = input.closest('.room-square');
        if (square) square.classList.toggle('selected', input.checked);
        updateTargetsSummary();
      });
    });

    targetList.querySelectorAll('input[type="checkbox"][data-task-space]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-task-space');
        if (input.checked) selectedTaskSpaces.add(id);
        else selectedTaskSpaces.delete(id);
        const square = input.closest('.room-square');
        if (square) square.classList.toggle('selected', input.checked);
        updateTargetsSummary();
      });
    });

    targetList.querySelectorAll('.room-square').forEach(square => {
      square.addEventListener('click', (event) => {
        if (event.target.matches('input')) return;
        const input = square.querySelector('input[type="checkbox"]');
        if (!input) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      });
    });
  };

  const getSchedulePayload = () => {
    const mode = scheduleMode?.value || 'EXACT';
    if (mode === 'NONE') return null;
    if (mode === 'RANGE') {
      const startDate = rangeStartDate?.value || '';
      const startTime = rangeStartTime?.value || '';
      const endDate = rangeEndDate?.value || '';
      const endTime = rangeEndTime?.value || '';
      if (!startDate || !endDate) return null;
      return { mode: 'RANGE', startDate, startTime, endDate, endTime };
    }
    const date = exactDate?.value || '';
    const time = exactTime?.value || '';
    if (!date) return null;
    return { mode: 'EXACT', date, time };
  };

  const setScheduleModeUi = () => {
    const mode = scheduleMode?.value || 'EXACT';
    const isRange = mode === 'RANGE';
    const isNone = mode === 'NONE';
    if (rangeWrap) rangeWrap.style.display = isRange ? '' : 'none';
    if (exactWrap) exactWrap.style.display = (!isRange && !isNone) ? '' : 'none';
    if (exactTimeWrap) exactTimeWrap.style.display = (!isRange && !isNone) ? '' : 'none';
  };

  const formatScheduleLabel = (schedule) => {
    if (!schedule) return '';
    if (schedule.mode === 'RANGE') {
      const start = schedule.startDate ? formatFloridaDateTime(schedule.startDate, schedule.startTime || '00:00') : '';
      const end = schedule.endDate ? formatFloridaDateTime(schedule.endDate, schedule.endTime || '00:00') : '';
      return start && end ? `${start} → ${end}` : '';
    }
    if (schedule.mode === 'EXACT') return schedule.date ? formatFloridaDateTime(schedule.date, schedule.time || '00:00') : '';
    return '';
  };

  const render = () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const tasks = window.HMP_DB.listTasksByHotel(hotelId);
    const staff = window.HMP_DB.listStaffByHotel(hotelId, { includeInactive: true });
    const staffById = Object.fromEntries(staff.map(m => [m.id, m]));

    if (createAssignee) renderAssigneeSelect(createAssignee, staff, { includeUnassigned: true, unassignedLabel: 'Unassigned' });
    if (filterAssignee) renderAssigneeSelect(filterAssignee, staff, { includeUnassigned: true, unassignedLabel: 'Unassigned', includeAll: true });

    const filtered = tasks.filter(task => {
      let statusOk = true;
      if (filterStatus) {
        const v = filterStatus.value;
        if (v === 'ACTIVE') statusOk = task.status !== 'DONE' && task.status !== 'CANCELLED';
        else if (v === 'PAST') statusOk = task.status === 'DONE' || task.status === 'CANCELLED';
        else statusOk = v === 'ALL' || task.status === v;
      }
      const prioOk = !filterPriority || filterPriority.value === 'ALL' || task.priority === filterPriority.value;
      const assigneeOk = !filterAssignee || filterAssignee.value === 'ALL' || (filterAssignee.value === '' ? !task.assignedStaffId : task.assignedStaffId === filterAssignee.value);
      const query = (filterSearch?.value || '').trim().toLowerCase();
      const searchOk = !query || [
        (task.locations || []).map(l => l.label).join(' '),
        task.location?.label,
        task.description,
        task.type,
        task.priority,
        task.status
      ].some(v => (v || '').toString().toLowerCase().includes(query));
      return statusOk && prioOk && assigneeOk && searchOk;
    });

    filtered.sort((a, b) => {
      const statusRank = (t) => (t.status === 'OPEN' ? 0 : t.status === 'IN_PROGRESS' ? 1 : t.status === 'BLOCKED' ? 2 : t.status === 'DONE' ? 3 : 4);
      const prioRank = (t) => (t.priority === 'URGENT' ? 0 : t.priority === 'HIGH' ? 1 : 2);
      return statusRank(a) - statusRank(b) || prioRank(a) - prioRank(b) || (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    if (counters) {
      const c = computeCounters(tasks);
      counters.textContent = `${c.open} open · ${c.urgent} urgent · ${c.done} done · ${c.total} total`;
    }

	    list.innerHTML = filtered.length
	      ? filtered.map(task => {
	          const assignee = task.assignedStaffId ? staffById[task.assignedStaffId] : null;
	          const assigneeName = assignee ? `${assignee.firstName || ''} ${assignee.lastName || ''}`.trim() : 'Unassigned';
            const assignOptions = [
              `<option value="" ${!task.assignedStaffId ? 'selected' : ''}>Unassigned</option>`,
              ...staff.map(member => {
                const label = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
                const suffix = member.active === false ? ' (inactive)' : '';
                const selected = task.assignedStaffId === member.id ? 'selected' : '';
                return `<option value="${member.id}" ${selected}>${label}${suffix}</option>`;
              })
            ].join('');
	          const targetCount = Array.isArray(task.locations) ? task.locations.length : 0;
	          const targetLabel = targetCount ? task.locations.slice(0, 2).map(t => t.label).join(' · ') : (task.location?.label || 'Area');
	          const scheduleLabel = formatScheduleLabel(task.schedule);
	          return `
	            <div class="planning-item">
	              <div>
	                <strong>${targetCount ? `${targetCount} target${targetCount > 1 ? 's' : ''}: ${targetLabel}` : targetLabel}</strong>
	                <small>${task.type} · ${task.priority} · ${task.status} · ${assigneeName}${scheduleLabel ? ` · ${scheduleLabel}` : ''}</small>
	              </div>
	              <small>${task.description || ''}</small>
	              <div class="planning-actions" style="margin-top: 10px;">
                  <select class="hotel-select" data-task-assign="${task.id}" aria-label="Assign staff">
                    ${assignOptions}
                  </select>
	                <button class="btn-secondary btn-hotel" data-task-open="${task.id}">
	                  <i class="fas fa-up-right-from-square"></i> Open
	                </button>
	              </div>
	            </div>
	          `;
	        }).join('')
	      : '<div class="planning-item">No tasks found.</div>';

	    list.querySelectorAll('button[data-task-open]').forEach(btn => {
	      btn.addEventListener('click', () => {
	        const taskId = btn.getAttribute('data-task-open');
	        window.open(`${getBaseUrl()}hotel_task_view.html?id=${encodeURIComponent(taskId)}`, '_blank');
	      });
	    });

      list.querySelectorAll('select[data-task-assign]').forEach(select => {
        select.addEventListener('change', async () => {
          const taskId = select.getAttribute('data-task-assign');
          const staffId = select.value || null;
          window.HMP_DB.updateTask(taskId, { assignedStaffId: staffId });
          const ev = window.HMP_DB.addTaskEvent(taskId, {
            action: staffId ? 'ASSIGNED' : 'UNASSIGNED',
            actorRole: 'hotel_manager',
            note: staffId ? 'Assigned' : 'Unassigned',
            patch: { assignedStaffId: staffId }
          });

          const persist = async () => {
            const res = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { assignedStaffId: staffId });
            if (res?.status === 401) {
              await fecoEnsureLogin();
              return window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { assignedStaffId: staffId });
            }
            if (res?.status === 404) {
              await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
              return window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { assignedStaffId: staffId });
            }
            return res;
          };

          try {
            const r = await persist();
            if (r?.ok && ev) {
              await window.HMP_DB.apiCreateTaskEventByLegacy?.(taskId, {
                action: ev.action,
                note: ev.note || '',
                actorRole: ev.actorRole || 'hotel_manager',
                actorStaffId: ev.actorStaffId || null,
                patch: ev.patch || null
              });
            }
          } catch {}

          showToast(staffId ? 'Assigned' : 'Unassigned', 'success');
          render();
        });
      });
	  };

  button.addEventListener('click', () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const type = createType?.value || 'OTHER';
    const priority = createPriority?.value || 'NORMAL';
    const assignedStaffId = createAssignee?.value || null;
    const description = createDescription?.value?.trim() || '';
    const locations = makeTargetsPayload();
    const schedule = getSchedulePayload();

    if (!locations.length) {
      showToast('Choose at least one room / area', 'warning');
      return;
    }

    const task = window.HMP_DB.addTask({
      hotelId,
      category: 'TASK',
      locations,
      type,
      priority,
      description,
      assignedStaffId,
      schedule,
      actorRole: 'hotel_manager'
    });

    if (assignedStaffId) {
      window.HMP_DB.addTaskEvent(task.id, {
        action: 'ASSIGNED',
        actorRole: 'hotel_manager',
        note: 'Assigned at creation'
      });
    }

    if (createDescription) createDescription.value = '';
    selectedTaskRooms.clear();
    selectedTaskSpaces.clear();
    updateTargetsSummary();
    render();
    showToast('Task created', 'success');
  });

  [filterStatus, filterPriority, filterAssignee].forEach(el => {
    if (!el) return;
    el.addEventListener('change', render);
  });
  if (filterSearch) filterSearch.addEventListener('input', render);
  if (hotelSelect) hotelSelect.addEventListener('change', () => setTimeout(render, 0));
  if (presetActive && filterStatus) presetActive.addEventListener('click', () => { filterStatus.value = 'ACTIVE'; render(); });
  if (presetPast && filterStatus) presetPast.addEventListener('click', () => { filterStatus.value = 'PAST'; render(); });

  if (chooseTargetsBtn) chooseTargetsBtn.addEventListener('click', openModal);
  if (closeTargetModal) closeTargetModal.addEventListener('click', closeModal);
  if (confirmTargetsBtn) confirmTargetsBtn.addEventListener('click', () => {
    updateTargetsSummary();
    closeModal();
  });
  if (clearTargetsBtn) clearTargetsBtn.addEventListener('click', () => {
    selectedTaskRooms.clear();
    selectedTaskSpaces.clear();
    renderTargetModal();
    updateTargetsSummary();
  });
  if (targetModal) {
    targetModal.addEventListener('click', (event) => {
      if (event.target === targetModal) closeModal();
    });
  }
  if (targetSearch) targetSearch.addEventListener('input', renderTargetModal);

  if (scheduleMode) scheduleMode.addEventListener('change', setScheduleModeUi);
  setScheduleModeUi();
  const settings = window.HMP_DB.getSettings();
  const workStart = settings.workHours?.start || '08:00';
  const workEnd = settings.workHours?.end || '17:00';
  if (exactTime) populateTimeSelect('taskTime', workStart, workEnd);
  if (rangeStartTime) populateTimeSelect('taskStartTime', workStart, workEnd);
  if (rangeEndTime) populateTimeSelect('taskEndTime', workStart, workEnd);

  updateTargetsSummary();
  render();
}

function initTaskView() {
  if (!document.getElementById('taskMeta')) return;
  if (!window.HMP_DB) return;

  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('id');
  if (!taskId) return;

  const title = document.getElementById('taskTitle');
  const subtitle = document.getElementById('taskSubtitle');
  const meta = document.getElementById('taskMeta');
  const timeline = document.getElementById('taskTimeline');
  const attachments = document.getElementById('taskAttachments');

  const statusSelect = document.getElementById('taskStatus');
  const assigneeSelect = document.getElementById('taskAssigneeDetail');
  const actorSelect = document.getElementById('taskActorStaff');

  const noteInput = document.getElementById('taskNote');
  const addNoteBtn = document.getElementById('addTaskNoteBtn');
  const photoInput = document.getElementById('taskPhoto');
  const hotelSelect = document.getElementById('hotelSelect');
  const printBtn = document.getElementById('taskPrintBtn');

  const renderStaffOptions = (select, staff, selectedId, opts = {}) => {
    const { includeUnassigned = true } = opts;
    const options = [];
    if (includeUnassigned) options.push(`<option value="" ${!selectedId ? 'selected' : ''}>Unassigned</option>`);
    options.push(...staff.map(member => {
      const label = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
      const selected = selectedId === member.id ? 'selected' : '';
      return `<option value="${member.id}" ${selected}>${label}</option>`;
    }));
    select.innerHTML = options.join('');
  };

  const formatDateTime = (iso) => {
    if (!iso) return '';
    return iso.slice(0, 16).replace('T', ' ');
  };

  const escapeHtml = (value) => {
    return (value || '').toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  };

  const render = () => {
    const task = window.HMP_DB.getTask(taskId);
    if (!task) {
      if (title) title.textContent = 'Task not found';
      return;
    }

    const hotelId = task.hotelId || window.HMP_DB.getActiveHotelId();
    if (hotelId) window.HMP_DB.setActiveHotelId(hotelId);

    const staff = window.HMP_DB.listStaffByHotel(hotelId, { includeInactive: true });
    const staffById = Object.fromEntries(staff.map(m => [m.id, m]));

    const assignee = task.assignedStaffId ? staffById[task.assignedStaffId] : null;
    const assigneeName = assignee ? `${assignee.firstName || ''} ${assignee.lastName || ''}`.trim() : 'Unassigned';

    if (title) title.textContent = task.location?.label || 'Task';
    if (subtitle) subtitle.textContent = `${task.type} · ${task.priority} · ${task.status}`;

    if (meta) {
      meta.innerHTML = `
        <div class="task-meta-item"><strong>Status</strong>${task.status}</div>
        <div class="task-meta-item"><strong>Priority</strong>${task.priority}</div>
        <div class="task-meta-item"><strong>Assignee</strong>${assigneeName}</div>
        <div class="task-meta-item"><strong>Created</strong>${formatDateTime(task.createdAt)}</div>
        <div class="task-meta-item"><strong>Updated</strong>${formatDateTime(task.updatedAt)}</div>
      `;
    }

    if (statusSelect) statusSelect.value = task.status || 'OPEN';
    if (assigneeSelect) renderStaffOptions(assigneeSelect, staff, task.assignedStaffId || '', { includeUnassigned: true });
    if (actorSelect) {
      renderStaffOptions(actorSelect, staff, actorSelect.value || '', { includeUnassigned: true });
      if (!actorSelect.value && task.assignedStaffId) actorSelect.value = task.assignedStaffId;
    }

    if (timeline) {
      const events = Array.isArray(task.events) ? task.events.slice().reverse() : [];
      timeline.innerHTML = events.length
        ? events.map(ev => {
            const actor = ev.actorStaffId ? staffById[ev.actorStaffId] : null;
            const actorName = actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() : (ev.actorRole || 'system');
            return `
              <div class="task-event">
                <div><strong>${ev.action}</strong> · ${actorName}</div>
                <small>${formatDateTime(ev.at)}${ev.note ? ` · ${escapeHtml(ev.note)}` : ''}</small>
              </div>
            `;
          }).join('')
        : '<div class="planning-item">No events yet.</div>';
    }

    if (attachments) {
      const atts = Array.isArray(task.attachments) ? task.attachments.slice().reverse() : [];
      const apiBase = window.HMP_DB?.getApiBase ? window.HMP_DB.getApiBase() : '';
      const resolveSrc = (src) => {
        const s = String(src || '').trim();
        if (!s) return '';
        if (s.startsWith('/') && apiBase) return `${apiBase}${s}`;
        return s;
      };
      attachments.innerHTML = atts.length
        ? atts.map(att => {
            const src = resolveSrc(att.url || att.dataUrl || '');
            if (!src) return '';
            return `
              <a href="${src}" target="_blank" rel="noopener">
                <img src="${src}" alt="${escapeHtml(att.name || 'photo')}" />
              </a>
            `;
          }).join('')
        : '<div class="planning-item">No photos yet.</div>';
    }
  };

  const getActor = () => {
    const staffId = actorSelect?.value || null;
    return {
      actorRole: staffId ? 'hotel_staff' : 'hotel_manager',
      actorStaffId: staffId || null
    };
  };

  const toApiEventPayload = (ev) => {
    if (!ev) return null;
    return {
      action: ev.action,
      note: ev.note || '',
      actorRole: ev.actorRole || 'hotel_manager',
      actorStaffId: ev.actorStaffId || null,
      patch: ev.patch || null
    };
  };

  const persistTaskToApi = async (patch, ev) => {
    const mode = window.HMP_DB?.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
    const apiBase = window.HMP_DB?.getApiBase ? window.HMP_DB.getApiBase() : '';
    if (mode === 'LOCAL_ONLY' || !apiBase) return { ok: false, skipped: true };

    const ensureAuth = async () => {
      const token = window.HMP_DB?.getAccessToken ? window.HMP_DB.getAccessToken() : '';
      if (token) return true;
      await fecoEnsureLogin();
      // user may still cancel
      return !!(window.HMP_DB?.getAccessToken ? window.HMP_DB.getAccessToken() : '');
    };

    const tryPatch = async () => {
      const r = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, patch);
      return r || { ok: false, error: 'no_api_patch' };
    };

    const tryEvent = async () => {
      const payload = toApiEventPayload(ev);
      if (!payload) return { ok: true, skipped: true };
      const r = await window.HMP_DB.apiCreateTaskEventByLegacy?.(taskId, payload);
      return r || { ok: false, error: 'no_api_event' };
    };

    if (!(await ensureAuth())) return { ok: false, status: 401, error: 'not_logged_in' };

    let pr = await tryPatch();
    if (!pr.ok && (pr.status === 404 || pr.error === 'task_not_found')) {
      // Task may not exist on API yet (not pushed). Push dataset once, then retry.
      await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
      pr = await tryPatch();
    }
    if (!pr.ok && pr.status === 401) {
      await fecoEnsureLogin();
      pr = await tryPatch();
    }
    if (!pr.ok) return pr;

    let er = await tryEvent();
    if (!er.ok && (er.status === 404 || er.error === 'task_not_found')) {
      await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
      er = await tryEvent();
    }
    if (!er.ok && er.status === 401) {
      await fecoEnsureLogin();
      er = await tryEvent();
    }
    if (!er.ok) return er;

    return { ok: true };
  };

  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      const task = window.HMP_DB.getTask(taskId);
      if (!task) return;
      const next = statusSelect.value;
      let extraNote = '';
      if (next === 'BLOCKED') {
        extraNote = prompt('Blocked reason (optional):', '') || '';
      }
      window.HMP_DB.updateTask(taskId, { status: next });
      const actor = getActor();
      const ev = window.HMP_DB.addTaskEvent(taskId, {
        action: 'STATUS_CHANGED',
        note: `→ ${next}${extraNote ? ` · ${extraNote.trim()}` : ''}`,
        ...actor,
        patch: { status: next }
      });
      const r = await persistTaskToApi({ status: next }, ev);
      showToast(r?.ok ? 'Saved' : 'Save failed (not synced)', r?.ok ? 'success' : 'warning');
      render();
    });
  }

  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async () => {
      const next = assigneeSelect.value || null;
      window.HMP_DB.updateTask(taskId, { assignedStaffId: next });
      const actor = getActor();
      const ev = window.HMP_DB.addTaskEvent(taskId, { action: next ? 'ASSIGNED' : 'UNASSIGNED', note: next ? 'Assigned' : 'Unassigned', ...actor, patch: { assignedStaffId: next } });
      const r = await persistTaskToApi({ assignedStaffId: next }, ev);
      showToast(r?.ok ? 'Saved' : 'Save failed (not synced)', r?.ok ? 'success' : 'warning');
      render();
    });
  }

  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', async () => {
      const note = noteInput?.value?.trim() || '';
      if (!note) {
        showToast('Note is empty', 'warning');
        return;
      }
      const actor = getActor();
      const ev = window.HMP_DB.addTaskEvent(taskId, { action: 'NOTE_ADDED', note, ...actor });
      const r = await persistTaskToApi({}, ev);
      if (!r?.ok) showToast('Note saved locally (not synced)', 'warning');
      if (noteInput) noteInput.value = '';
      showToast('Note added', 'success');
      render();
    });
  }

  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (file.size > 1_500_000) {
        showToast('Image too large (max ~1.5MB)', 'warning');
        photoInput.value = '';
        return;
      }

      // Preferred path (when logged-in): upload to API so photos are stored as files (webp) on server.
      try {
        const mode = window.HMP_DB?.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
        const apiBase = window.HMP_DB?.getApiBase ? window.HMP_DB.getApiBase() : '';
        const token = window.HMP_DB?.getAccessToken ? window.HMP_DB.getAccessToken() : '';
        if (mode !== 'LOCAL_ONLY' && apiBase && token) {
          const actor = getActor();
          const form = new FormData();
          form.append('file', file, file.name);
          form.append('actorRole', actor.actorRole || 'hotel_staff');
          if (actor.actorStaffId) form.append('actorStaffId', actor.actorStaffId);

          const res = await fetch(`${apiBase}/api/v1/tasks/by-legacy/${encodeURIComponent(taskId)}/attachments`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            body: form
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || `upload_failed_${res.status}`);

          const att = body?.attachment || {};
          window.HMP_DB.addTaskAttachment(taskId, {
            id: att.id,
            at: att.at,
            name: att.name || file.name,
            mime: att.mime || 'image/webp',
            url: att.url || null,
            sizeBytes: att.sizeBytes || null,
            width: att.width || null,
            height: att.height || null,
            dataUrl: null,
            actorRole: att.actorRole || actor.actorRole,
            actorStaffId: att.actorStaffId || actor.actorStaffId
          });
          showToast('Photo uploaded', 'success');
          photoInput.value = '';
          render();
          return;
        }
      } catch (e) {
        // Fallback to local dataUrl (offline / not logged-in / API error)
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const actor = getActor();
        window.HMP_DB.addTaskAttachment(taskId, {
          name: file.name,
          mime: file.type,
          dataUrl,
          ...actor
        });
        window.HMP_DB.addTaskEvent(taskId, { action: 'PHOTO_ADDED', note: file.name, ...actor });
        showToast('Photo added (local)', 'success');
        photoInput.value = '';
        render();
      };
      reader.onerror = () => {
        showToast('Failed to read image', 'error');
        photoInput.value = '';
      };
      reader.readAsDataURL(file);
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  if (hotelSelect) hotelSelect.addEventListener('change', () => setTimeout(render, 0));

  render();
}

function initHotelStaff() {
  if (!document.getElementById('staffList')) return;
  const list = document.getElementById('staffList');
  const button = document.getElementById('addStaffBtn');
  if (!window.HMP_DB || !list || !button) return;
  const hotelSelect = document.getElementById('hotelSelect');

  const pushDataset = async () => {
    try {
      const mode = window.HMP_DB?.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
      if (mode === 'LOCAL_ONLY') return { ok: true, skipped: true };
      const r = await window.HMP_DB.apiPushLocalStorage?.();
      if (r?.status === 401) {
        await fecoEnsureLogin();
        return window.HMP_DB.apiPushLocalStorage?.();
      }
      return r;
    } catch {
      return { ok: false };
    }
  };

  const getBaseUrl = () => {
    const origin = window.location.origin === 'null' ? '' : window.location.origin;
    const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
    return `${origin}${basePath}`;
  };

  const render = () => {
    const hotelId = window.HMP_DB.getActiveHotelId();
    const staff = window.HMP_DB.listStaffByHotel(hotelId, { includeInactive: true });
    list.innerHTML = staff.length
      ? staff.map(member => {
          const name = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
          const status = member.active === false ? 'Inactive' : 'Active';
          return `
            <div class="planning-item">
              <div>
                <strong>${name}</strong>
                <small>${member.phone || 'No phone'} · ${status}</small>
              </div>
              <div class="planning-actions">
                <button class="btn-secondary btn-hotel" data-staff-portal="${member.id}">
                  <i class="fas fa-clipboard-check"></i> Tasks
                </button>
                <button class="btn-secondary btn-hotel" data-staff-toggle="${member.id}">
                  <i class="fas fa-user-slash"></i> ${member.active === false ? 'Activate' : 'Deactivate'}
                </button>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="planning-item">No staff yet.</div>';

    list.querySelectorAll('button[data-staff-portal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const staffId = btn.getAttribute('data-staff-portal');
        window.open(`${getBaseUrl()}staff_tasks.html?staffId=${encodeURIComponent(staffId)}`, '_blank');
      });
    });

    list.querySelectorAll('button[data-staff-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const staffId = btn.getAttribute('data-staff-toggle');
        const member = window.HMP_DB.getStaff(staffId);
        if (!member) return;
        window.HMP_DB.updateStaff(staffId, { active: member.active === false ? true : false });
        const pushed = await pushDataset();
        showToast(pushed?.ok ? 'Saved' : 'Saved locally (not synced)', pushed?.ok ? 'success' : 'warning');
        render();
      });
    });
  };

  button.addEventListener('click', async () => {
    const firstName = document.getElementById('staffFirstName')?.value?.trim() || '';
    const lastName = document.getElementById('staffLastName')?.value?.trim() || '';
    const phone = document.getElementById('staffPhone')?.value?.trim() || '';
    const notes = document.getElementById('staffNotes')?.value?.trim() || '';
    if (!firstName && !lastName) {
      showToast('First name or last name is required', 'warning');
      return;
    }
    window.HMP_DB.addStaff({
      hotelId: window.HMP_DB.getActiveHotelId(),
      firstName,
      lastName,
      phone,
      notes
    });
    ['staffFirstName', 'staffLastName', 'staffPhone', 'staffNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    render();
    const pushed = await pushDataset();
    showToast(pushed?.ok ? 'Staff added' : 'Staff added (local only)', pushed?.ok ? 'success' : 'warning');
  });

  render();
  if (hotelSelect) hotelSelect.addEventListener('change', () => setTimeout(render, 0));
}

function initStaffTasks() {
  if (!document.getElementById('staffTaskList')) return;
  const list = document.getElementById('staffTaskList');
  const history = document.getElementById('staffTaskHistory');
  const staffSelect = document.getElementById('staffSelect');
  const subtitle = document.getElementById('staffHeaderSubtitle');
  if (!window.HMP_DB || !list || !staffSelect) return;
  const hotelSelect = document.getElementById('hotelSelect');

  const params = new URLSearchParams(window.location.search);
  const preferredStaffId = params.get('staffId');
  const token = params.get('token');

  const getActiveHotelId = () => window.HMP_DB.getActiveHotelId();

  const renderStaffOptions = () => {
    const hotelId = getActiveHotelId();
    const staff = window.HMP_DB.listStaffByHotel(hotelId, { includeInactive: false });
    staffSelect.innerHTML = staff.length
      ? staff.map(member => {
          const name = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Staff';
          return `<option value="${member.id}">${name}</option>`;
        }).join('')
      : '<option value="">No staff</option>';
  };

  const resolveInitialIdentity = () => {
    if (token) {
      const member = window.HMP_DB.getStaffByToken(token);
      if (member?.hotelId) window.HMP_DB.setActiveHotelId(member.hotelId);
      renderStaffOptions();
      if (member) staffSelect.value = member.id;
      return;
    }
    renderStaffOptions();
    if (preferredStaffId) staffSelect.value = preferredStaffId;
  };

  const render = () => {
    const staffId = staffSelect.value;
    if (!staffId) {
      list.innerHTML = '<div class="planning-item">No staff selected.</div>';
      if (history) history.innerHTML = '';
      return;
    }
    const member = window.HMP_DB.getStaff(staffId);
    const memberName = `${member?.firstName || ''} ${member?.lastName || ''}`.trim() || 'Staff';
    if (subtitle) subtitle.textContent = memberName;

    const tasks = window.HMP_DB.listTasksByStaff(staffId)
      .filter(t => t.hotelId === getActiveHotelId())
      .map(t => ({ ...t, events: Array.isArray(t.events) ? t.events : [] }));

    const open = tasks.filter(t => t.status !== 'DONE');
    const done = tasks.filter(t => t.status === 'DONE');

    const formatScheduleLabel = (schedule) => {
      if (!schedule) return '';
      if (schedule.mode === 'RANGE') {
        const start = schedule.startDate ? formatFloridaDateTime(schedule.startDate, schedule.startTime || '00:00') : '';
        const end = schedule.endDate ? formatFloridaDateTime(schedule.endDate, schedule.endTime || '00:00') : '';
        return start && end ? `${start} → ${end}` : '';
      }
      if (schedule.mode === 'EXACT') return schedule.date ? formatFloridaDateTime(schedule.date, schedule.time || '00:00') : '';
      return '';
    };

    list.innerHTML = open.length
      ? open.map(task => `
          <div class="planning-item">
            <div>
              <strong>${task.location?.label || task.room || 'Area'}</strong>
              <small>${task.category || 'TASK'} · ${task.type} · ${task.priority} · ${task.status}${formatScheduleLabel(task.schedule) ? ` · ${formatScheduleLabel(task.schedule)}` : ''}</small>
            </div>
            <small>${task.description || ''}</small>
            <div class="planning-actions" style="margin-top: 10px;">
              <button class="btn-secondary btn-hotel" data-task-open="${task.id}"><i class="fas fa-up-right-from-square"></i> Open</button>
              ${task.status === 'OPEN'
                ? `<button class="btn-secondary btn-hotel" data-task-start="${task.id}"><i class="fas fa-play"></i> Start</button>`
                : ''
              }
              <button class="btn-primary" data-task-done="${task.id}"><i class="fas fa-check"></i> Done</button>
            </div>
          </div>
        `).join('')
      : '<div class="planning-item">No assigned tasks.</div>';

    if (history) {
      history.innerHTML = done.length
        ? done.slice(0, 25).map(task => `
            <div class="planning-item">
              <div>
                <strong>${task.location?.label || task.room || 'Area'}</strong>
                <small>${task.category || 'TASK'} · ${task.type} · DONE</small>
              </div>
              <small>${(task.events || []).slice(-1)[0]?.note || ''}</small>
            </div>
          `).join('')
        : '<div class="planning-item">No completed tasks yet.</div>';
    }

    list.querySelectorAll('button[data-task-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const taskId = btn.getAttribute('data-task-open');
        const origin = window.location.origin === 'null' ? '' : window.location.origin;
        const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
        window.open(`${origin}${basePath}hotel_task_view.html?id=${encodeURIComponent(taskId)}`, '_blank');
      });
    });

    list.querySelectorAll('button[data-task-start]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.getAttribute('data-task-start');
        window.HMP_DB.updateTask(taskId, { status: 'IN_PROGRESS' });
        const ev = window.HMP_DB.addTaskEvent(taskId, {
          action: 'STARTED',
          actorRole: 'hotel_staff',
          actorStaffId: staffId,
          note: 'Work started'
        });
        try {
          const r = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { status: 'IN_PROGRESS' });
          if (r?.status === 401) {
            await fecoEnsureLogin();
          } else if (r?.status === 404) {
            await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
          }
          const r2 = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { status: 'IN_PROGRESS' });
          if (r2?.ok && ev) {
            await window.HMP_DB.apiCreateTaskEventByLegacy?.(taskId, {
              action: ev.action,
              note: ev.note || '',
              actorRole: ev.actorRole || 'hotel_staff',
              actorStaffId: ev.actorStaffId || null,
              patch: ev.patch || null
            });
          }
          showToast(r2?.ok ? 'Started' : 'Started (local only)', r2?.ok ? 'success' : 'warning');
        } catch {
          showToast('Started (local only)', 'warning');
        }
        render();
      });
    });

    list.querySelectorAll('button[data-task-done]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.getAttribute('data-task-done');
        const note = prompt('Comment (optional):', '') || '';
        window.HMP_DB.updateTask(taskId, {
          status: 'DONE',
          closedAt: new Date().toISOString(),
          resolvedByStaffId: staffId
        });
        const ev = window.HMP_DB.addTaskEvent(taskId, {
          action: 'COMPLETED',
          actorRole: 'hotel_staff',
          actorStaffId: staffId,
          note: note.trim()
        });
        try {
          const r = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { status: 'DONE' });
          if (r?.status === 401) {
            await fecoEnsureLogin();
          } else if (r?.status === 404) {
            await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
          }
          const r2 = await window.HMP_DB.apiPatchTaskByLegacy?.(taskId, { status: 'DONE' });
          if (r2?.ok && ev) {
            await window.HMP_DB.apiCreateTaskEventByLegacy?.(taskId, {
              action: ev.action,
              note: ev.note || '',
              actorRole: ev.actorRole || 'hotel_staff',
              actorStaffId: ev.actorStaffId || null,
              patch: ev.patch || null
            });
          }
          showToast(r2?.ok ? 'Completed' : 'Completed (local only)', r2?.ok ? 'success' : 'warning');
        } catch {
          showToast('Completed (local only)', 'warning');
        }
        render();
      });
    });
  };

  resolveInitialIdentity();

  staffSelect.addEventListener('change', render);
  if (hotelSelect) {
    hotelSelect.addEventListener('change', () => {
      setTimeout(() => {
        renderStaffOptions();
        render();
      }, 0);
    });
  }
  render();
}

function renderTechnicians() {
  const list = document.getElementById('techList');
  const select = document.getElementById('sessionTech');
  if (!list && !select) return;
  if (!window.HMP_DB) return;

  const technicians = window.HMP_DB.listTechnicians();
  if (list) {
    list.innerHTML = technicians.length
      ? technicians.map(tech => `
          <div class="planning-item">
            <div>
              <strong>${tech.name}</strong>
              <small>${tech.phone || 'No phone'}</small>
            </div>
            <button class="btn-secondary btn-hotel" data-tech-id="${tech.id}">
              <i class="fas fa-trash"></i> Remove
            </button>
          </div>
        `).join('')
      : '<div class="planning-item">No technicians yet.</div>';
  }

  if (select) {
    select.innerHTML = technicians.length
      ? technicians.map(tech => `<option value="${tech.id}">${tech.name}</option>`).join('')
      : '<option value="">No technicians</option>';
  }

  if (list) {
    list.querySelectorAll('button[data-tech-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tech-id');
        window.HMP_DB.deleteTechnician(id);
        window.HMP_DB.apiDeleteTechnician?.(id).then(r => {
          if (r?.status === 401) fecoEnsureLogin();
        }).catch(() => {});
        renderTechnicians();
        showToast('Technician removed', 'success');
      });
    });
  }
}

function renderBlockedSlots() {
  const list = document.getElementById('blockList');
  if (!list || !window.HMP_DB) return;

  const blocks = window.HMP_DB.listBlockedSlots();
  list.innerHTML = blocks.length
    ? blocks.map(block => `
        <div class="planning-item">
          <div>
            <strong>${block.date} ${block.start} - ${block.end}</strong>
            <small>${block.note || 'Blocked'}</small>
          </div>
          <button class="btn-secondary btn-hotel" data-block-id="${block.id}">
            <i class="fas fa-trash"></i> Remove
          </button>
        </div>
      `).join('')
    : '<div class="planning-item">No blocked slots.</div>';

  list.querySelectorAll('button[data-block-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-block-id');
      window.HMP_DB.deleteBlockedSlot(id);
      window.HMP_DB.apiDeleteBlockedSlot?.(id).then(r => {
        if (r?.status === 401) fecoEnsureLogin();
      }).catch(() => {});
      renderBlockedSlots();
      renderAgendaGrid();
      showToast('Block removed', 'success');
    });
  });
}

function saveWorkHours() {
  if (!window.HMP_DB) return;
  const start = document.getElementById('workStart')?.value;
  const end = document.getElementById('workEnd')?.value;
  if (!start || !end) return;
  window.HMP_DB.updateSettings({
    workHours: { start, end }
  });
  renderAgendaGrid();
}

function createPlanningSession() {
  if (!window.HMP_DB) return;
  if (!selectedPlanningRooms.size) {
    showToast('Select at least one room', 'warning');
    return;
  }

  const date = document.getElementById('sessionDate')?.value;
  const start = document.getElementById('sessionStart')?.value;
  const end = document.getElementById('sessionEnd')?.value;
  const techId = document.getElementById('sessionTech')?.value || '';
  if (!date || !start || !end) {
    showToast('Please set date and time', 'warning');
    return;
  }
  if (isDateBlocked(date)) {
    showToast('Day is already booked or blocked', 'warning');
    return;
  }

  const session = window.HMP_DB.createSession({
    hotelId: state.hotel.id,
    roomIds: Array.from(selectedPlanningRooms),
    date,
    start,
    end,
    technicianId: techId
  });

  window.HMP_DB.apiUpsertSession?.(state.hotel.id, {
    legacyId: session.id,
    date,
    start,
    end,
    roomIds: Array.from(selectedPlanningRooms),
    technicianId: techId
  }).then(r => {
    if (r?.status === 401) fecoEnsureLogin();
  }).catch(() => {});

  showToast(`Session created for ${formatFloridaDateTime(date, start)}`, 'success');
  selectedPlanningRooms.clear();
  renderPlanningRooms();
  renderAgendaGrid();
}

function renderPendingReservations() {
  const list = document.getElementById('pendingReservations');
  if (!list || !window.HMP_DB) return;
  const reservations = window.HMP_DB.listReservations();
  const cancelled = reservations.filter(resv => isReservationCancelled(resv));
  const pending = reservations.filter(resv =>
    !isReservationCancelled(resv) &&
    (resv.statusAdmin !== 'APPROVED' || resv.statusHotel !== 'APPROVED')
  );
  const hotels = window.HMP_DB.getHotels();
  const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h.name]));

  const pendingHtml = pending.length
    ? pending.map(resv => `
        <div class="planning-item">
          <div>
            <strong>${hotelMap[resv.hotelId] || 'Hotel'}</strong>
            <small>${resv.proposedDate || 'TBD'} · ${resv.proposedStart || ''} · Admin ${resv.statusAdmin} / Hotel ${resv.statusHotel}</small>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary btn-hotel" data-resv-link="${resv.token}">
              <i class="fas fa-link"></i>
            </button>
            <button class="btn-primary btn-hotel" data-resv-approve="${resv.id}">
              <i class="fas fa-check"></i>
            </button>
            <button class="btn-secondary btn-hotel" data-resv-cancel="${resv.id}" title="Cancel request">
              <i class="fas fa-ban"></i> Cancel
            </button>
            <button class="btn-secondary btn-hotel danger" data-resv-delete="${resv.id}" title="Delete permanently">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      `).join('')
    : '<div class="planning-item">No pending reservations.</div>';

  const cancelledHtml = cancelled.length
    ? `
      <div class="planning-item">
        <div>
          <strong>Cancelled</strong>
          <small>${cancelled.length} reservation(s)</small>
        </div>
      </div>
      ${cancelled.map(resv => `
        <div class="planning-item">
          <div>
            <strong>${hotelMap[resv.hotelId] || 'Hotel'}</strong>
            <small>${resv.proposedDate || 'TBD'} · ${resv.proposedStart || ''} · CANCELLED</small>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary btn-hotel" data-resv-link="${resv.token}">
              <i class="fas fa-link"></i>
            </button>
            <button class="btn-secondary btn-hotel danger" data-resv-delete="${resv.id}" title="Delete permanently">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      `).join('')}
    `
    : '';

  list.innerHTML = `${pendingHtml}${cancelledHtml}`;

  list.querySelectorAll('button[data-resv-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const token = btn.getAttribute('data-resv-link');
      const origin = window.location.origin === 'null' ? '' : window.location.origin;
      const basePath = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
      window.open(`${origin}${basePath}reservation_view.html?token=${token}&role=admin`, '_blank');
    });
  });

  list.querySelectorAll('button[data-resv-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-resv-approve');
      window.HMP_DB.updateReservation(id, {
        statusAdmin: 'APPROVED'
      });
      try {
        const persist = async () => {
          const res = await window.HMP_DB.apiPatchReservation?.(id, { statusAdmin: 'APPROVED' });
          if (res?.status === 401) {
            await fecoEnsureLogin();
            return window.HMP_DB.apiPatchReservation?.(id, { statusAdmin: 'APPROVED' });
          }
          if (res?.status === 404) {
            await window.HMP_DB.apiPushLocalStorage?.().catch(() => {});
            return window.HMP_DB.apiPatchReservation?.(id, { statusAdmin: 'APPROVED' });
          }
          return res;
        };
        await persist();
      } catch {}
      renderPendingReservations();
      renderAgendaGrid();
      showToast('Reservation approved', 'success');
    });
  });

  list.querySelectorAll('button[data-resv-cancel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-resv-cancel');
      const ok = confirm('Cancel this reservation request? It will no longer block scheduling.');
      if (!ok) return;
      window.HMP_DB.cancelReservation(id, { by: 'admin' });
      try {
        const res = await window.HMP_DB.apiCancelReservation?.(id, { by: 'admin' });
        if (res?.status === 401) {
          await fecoEnsureLogin();
          await window.HMP_DB.apiCancelReservation?.(id, { by: 'admin' });
        }
      } catch {}
      renderPendingReservations();
      renderAgendaGrid();
      showToast('Reservation cancelled', 'success');
    });
  });

  list.querySelectorAll('button[data-resv-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-resv-delete');
      const ok = confirm('Delete this reservation permanently?');
      if (!ok) return;
      window.HMP_DB.deleteReservation(id);
      try {
        const res = await window.HMP_DB.apiDeleteReservation?.(id);
        if (res?.status === 401) {
          await fecoEnsureLogin();
          await window.HMP_DB.apiDeleteReservation?.(id);
        }
      } catch {}
      renderPendingReservations();
      renderAgendaGrid();
      showToast('Reservation deleted', 'success');
    });
  });
}

function initPlanning() {
  if (!document.getElementById('roomList')) return;
  const settings = window.HMP_DB.getSettings();
  const timezoneEl = document.getElementById('planningTimezone');
  if (timezoneEl) timezoneEl.textContent = settings.timezone || 'America/New_York';

  populateTimeSelect('sessionStart');
  populateTimeSelect('sessionEnd');
  const sessionStart = document.getElementById('sessionStart');
  const sessionEnd = document.getElementById('sessionEnd');
  if (sessionStart && sessionEnd) {
    sessionStart.value = settings.workHours?.start || '08:00';
    sessionEnd.value = settings.workHours?.end || '17:00';
  }

  const dueBtn = document.getElementById('selectDueBtn');
  if (dueBtn) dueBtn.addEventListener('click', autoSelectDueRooms);

  const select30 = document.getElementById('select30Btn');
  if (select30) select30.addEventListener('click', () => selectRoomsByWindow(30));

  const select60 = document.getElementById('select60Btn');
  if (select60) select60.addEventListener('click', () => selectRoomsByWindow(60));

  const select90 = document.getElementById('select90Btn');
  if (select90) select90.addEventListener('click', () => selectRoomsByWindow(90));

  const createBtn = document.getElementById('createSessionBtn');
  if (createBtn) createBtn.addEventListener('click', createPlanningSession);

  const openWizardBtn = document.getElementById('openReservationWizard');
  if (openWizardBtn) openWizardBtn.addEventListener('click', openWizard);

  const closeWizardBtn = document.getElementById('closeReservationWizard');
  if (closeWizardBtn) closeWizardBtn.addEventListener('click', closeWizard);

  const wizardBack = document.getElementById('wizardBackBtn');
  const wizardNext = document.getElementById('wizardNextBtn');
  if (wizardBack) wizardBack.addEventListener('click', () => setWizardStep(Math.max(1, wizardStep - 1)));
  if (wizardNext) {
    wizardNext.addEventListener('click', () => {
      if (wizardStep === 1) {
        setWizardStep(2);
      } else if (wizardStep === 2) {
        const ok = completeWizard();
        if (ok) setWizardStep(3);
      } else {
        closeWizard();
      }
    });
  }

  const wizardDueNow = document.getElementById('wizardDueNow');
  if (wizardDueNow) wizardDueNow.addEventListener('click', () => wizardSelectByWindow('dueNow'));
  const wizardPast15 = document.getElementById('wizardPast15');
  if (wizardPast15) wizardPast15.addEventListener('click', () => wizardSelectByWindow('past15'));
  const wizardPast30 = document.getElementById('wizardPast30');
  if (wizardPast30) wizardPast30.addEventListener('click', () => wizardSelectByWindow('past30'));
  const wizardComing30 = document.getElementById('wizardComing30');
  if (wizardComing30) wizardComing30.addEventListener('click', () => wizardSelectByWindow('coming30'));
  const wizardComing60 = document.getElementById('wizardComing60');
  if (wizardComing60) wizardComing60.addEventListener('click', () => wizardSelectByWindow('coming60'));

  const wizardSurface = document.getElementById('wizardSurfaceDefault');
  if (wizardSurface) {
    wizardSurface.value = wizardSurfaceDefault;
    wizardSurface.addEventListener('change', () => {
      wizardSurfaceDefault = normalizeSurface(wizardSurface.value);
      renderWizardCommentRecap();
      renderWizardSummary();
    });
  }

  populateTimeSelect('wizardStart');

  renderPlanningRooms();
  renderTechnicians();
  renderPendingReservations();
  renderAgendaGrid();

  const prevWeek = document.getElementById('prevWeekBtn');
  const nextWeek = document.getElementById('nextWeekBtn');
  if (prevWeek) prevWeek.addEventListener('click', () => {
    agendaWeekOffset -= 1;
    renderAgendaGrid();
  });
  if (nextWeek) nextWeek.addEventListener('click', () => {
    agendaWeekOffset += 1;
    renderAgendaGrid();
  });
}

function initSettings() {
  if (!document.getElementById('workStart')) return;
  const settings = window.HMP_DB.getSettings();
  const timezoneEl = document.getElementById('planningTimezone');
  if (timezoneEl) timezoneEl.textContent = settings.timezone || 'America/New_York';

  populateTimeSelect('workStart');
  populateTimeSelect('workEnd');
  populateTimeSelect('blockStart');
  populateTimeSelect('blockEnd');

  const workStart = document.getElementById('workStart');
  const workEnd = document.getElementById('workEnd');
  workStart.value = settings.workHours?.start || '08:00';
  workEnd.value = settings.workHours?.end || '17:00';
  workStart.addEventListener('change', saveWorkHours);
  workEnd.addEventListener('change', saveWorkHours);

  const addTechBtn = document.getElementById('addTechBtn');
  if (addTechBtn) {
    addTechBtn.addEventListener('click', () => {
      const firstName = document.getElementById('techFirstName')?.value?.trim();
      const lastName = document.getElementById('techLastName')?.value?.trim();
      if (!firstName || !lastName) {
        showToast('Technician first and last name required', 'warning');
        return;
      }
      const name = `${firstName} ${lastName}`.trim();
      const phone = document.getElementById('techPhone')?.value || '';
      const notes = document.getElementById('techNotes')?.value || '';
      const tech = window.HMP_DB.addTechnician({ name, phone, notes });
      window.HMP_DB.apiUpsertTechnician?.({
        legacyId: tech.id,
        name: tech.name,
        phone: tech.phone || '',
        notes: tech.notes || ''
      }).then(r => {
        if (r?.status === 401) fecoEnsureLogin();
      }).catch(() => {});
      document.getElementById('techFirstName').value = '';
      document.getElementById('techLastName').value = '';
      document.getElementById('techPhone').value = '';
      document.getElementById('techNotes').value = '';
      renderTechnicians();
      showToast('Technician added', 'success');
    });
  }

  const addBlockBtn = document.getElementById('addBlockBtn');
  if (addBlockBtn) {
    addBlockBtn.addEventListener('click', () => {
      const date = document.getElementById('blockDate')?.value;
      const start = document.getElementById('blockStart')?.value;
      const end = document.getElementById('blockEnd')?.value;
      if (!date || !start || !end) {
        showToast('Block requires date and time', 'warning');
        return;
      }
      const note = document.getElementById('blockNote')?.value || '';
      const slot = window.HMP_DB.addBlockedSlot({ date, start, end, note });
      window.HMP_DB.apiUpsertBlockedSlot?.({
        legacyId: slot.id,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        note: slot.note || ''
      }).then(r => {
        if (r?.status === 401) fecoEnsureLogin();
      }).catch(() => {});
      document.getElementById('blockDate').value = '';
      document.getElementById('blockStart').value = '';
      document.getElementById('blockEnd').value = '';
      document.getElementById('blockNote').value = '';
      renderBlockedSlots();
      showToast('Block added', 'success');
    });
  }

  renderTechnicians();
  renderBlockedSlots();
}

function updateContractCalculations() {
  const surfaceType = document.getElementById('contractSurfaceType')?.value || 'BOTH';
  const rooms = getNumberValue('contractRoomsPerSession');
  const minRooms = getNumberValue('roomsMinPerSession');

  const basePrices = {
    BOTH: getNumberValue('baseBoth'),
    CARPET: getNumberValue('baseCarpet'),
    TILE: getNumberValue('baseTile')
  };
  const penaltyPrices = {
    BOTH: getNumberValue('penaltyBoth'),
    CARPET: getNumberValue('penaltyCarpet'),
    TILE: getNumberValue('penaltyTile')
  };
  const contractPrices = {
    BOTH: getNumberValue('contractBoth'),
    CARPET: getNumberValue('contractCarpet'),
    TILE: getNumberValue('contractTile')
  };
  const advantagePrices = {
    BOTH: getNumberValue('advantageBoth'),
    CARPET: getNumberValue('advantageCarpet'),
    TILE: getNumberValue('advantageTile')
  };

  let tier = 'Contract';
  let appliedPrice = getPriceForSurface(contractPrices, surfaceType);

  if (rooms < minRooms) {
    tier = 'Penalty';
    appliedPrice = getPriceForSurface(penaltyPrices, surfaceType);
  } else if (rooms >= minRooms) {
    tier = 'Max advantage';
    appliedPrice = getPriceForSurface(advantagePrices, surfaceType);
  }

  const basePrice = getPriceForSurface(basePrices, surfaceType);
  if (!appliedPrice) appliedPrice = basePrice;

  const otherCarpetSqft = getNumberValue('otherSqftCarpet');
  const otherTileSqft = getNumberValue('otherSqftTile');
  const sqftCarpet = getNumberValue('sqftCarpet');
  const sqftTile = getNumberValue('sqftTile');

  const otherTotal = (otherCarpetSqft * sqftCarpet) + (otherTileSqft * sqftTile);
  const total = (rooms * appliedPrice) + otherTotal;

  setInputValue('priceTier', tier);
  setInputValue('appliedPricePerRoom', `$${appliedPrice.toFixed(2)}`);
  const totalField = document.getElementById('contractTotal');
  if (totalField) totalField.value = `$${total.toFixed(2)}`;
}

function syncPricingDefaultsFromForm() {
  if (!window.HMP_DB) return;
  window.HMP_DB.setPricingDefaults({
    roomsMinPerSession: getNumberValue('roomsMinPerSession'),
    roomsMaxPerSession: getNumberValue('roomsMaxPerSession'),
    basePrices: {
      BOTH: getNumberValue('baseBoth'),
      CARPET: getNumberValue('baseCarpet'),
      TILE: getNumberValue('baseTile')
    },
    penaltyPrices: {
      BOTH: getNumberValue('penaltyBoth'),
      CARPET: getNumberValue('penaltyCarpet'),
      TILE: getNumberValue('penaltyTile')
    },
    contractPrices: {
      BOTH: getNumberValue('contractBoth'),
      CARPET: getNumberValue('contractCarpet'),
      TILE: getNumberValue('contractTile')
    },
    advantagePrices: {
      BOTH: getNumberValue('advantageBoth'),
      CARPET: getNumberValue('advantageCarpet'),
      TILE: getNumberValue('advantageTile')
    },
    sqftPrices: {
      CARPET: getNumberValue('sqftCarpet'),
      TILE: getNumberValue('sqftTile')
    }
  });
}

function buildContractPayload() {
  const surfaceType = document.getElementById('contractSurfaceType')?.value || 'BOTH';
  const frequency = document.getElementById('contractFrequency')?.value || 'YEARLY';
  const rooms = getNumberValue('contractRoomsPerSession');
  const minRooms = getNumberValue('roomsMinPerSession');
  const maxRooms = getNumberValue('roomsMaxPerSession');

  const basePrices = {
    BOTH: getNumberValue('baseBoth'),
    CARPET: getNumberValue('baseCarpet'),
    TILE: getNumberValue('baseTile')
  };
  const penaltyPrices = {
    BOTH: getNumberValue('penaltyBoth'),
    CARPET: getNumberValue('penaltyCarpet'),
    TILE: getNumberValue('penaltyTile')
  };
  const contractPrices = {
    BOTH: getNumberValue('contractBoth'),
    CARPET: getNumberValue('contractCarpet'),
    TILE: getNumberValue('contractTile')
  };
  const advantagePrices = {
    BOTH: getNumberValue('advantageBoth'),
    CARPET: getNumberValue('advantageCarpet'),
    TILE: getNumberValue('advantageTile')
  };

  const appliedTier = document.getElementById('priceTier')?.value || '';
  const appliedPriceRaw = document.getElementById('appliedPricePerRoom')?.value || '$0';
  const appliedPrice = parseFloat(appliedPriceRaw.replace('$', '')) || 0;

  const otherSqftCarpet = getNumberValue('otherSqftCarpet');
  const otherSqftTile = getNumberValue('otherSqftTile');
  const sqftCarpet = getNumberValue('sqftCarpet');
  const sqftTile = getNumberValue('sqftTile');

  const contactName = document.getElementById('contractContactName')?.value || '';
  const contactEmail = document.getElementById('contractContactEmail')?.value || '';
  const contactCc = document.getElementById('contractContactCc')?.value || '';

  const notes = document.getElementById('contractNotes')?.value || '';
  const totalText = document.getElementById('contractTotal')?.value || '$0';
  const totalValue = parseFloat(totalText.replace('$', '')) || 0;

  return {
    hotelId: state.hotel.id,
    hotelName: state.hotel.name || '',
    contact: {
      name: contactName,
      email: contactEmail,
      cc: contactCc
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    },
    pricing: {
      basePrices,
      penaltyPrices,
      contractPrices,
      advantagePrices,
      sqftPrices: {
        CARPET: sqftCarpet,
        TILE: sqftTile
      }
    },
    roomsMinPerSession: minRooms,
    roomsMaxPerSession: maxRooms,
    roomsPerSession: rooms,
    frequency,
    surfaceType,
    appliedTier,
    appliedPricePerRoom: appliedPrice,
    otherSurfaces: {
      carpetSqft: otherSqftCarpet,
      tileSqft: otherSqftTile
    },
    totalPerSession: totalValue,
    notes,
    sentAt: new Date().toISOString()
  };
}

function generateContractLink() {
  if (!window.HMP_DB) return;
  if (!state.hotel?.id) {
    showToast('Please select a hotel first', 'warning');
    return;
  }

  syncPricingDefaultsFromForm();
  const payload = buildContractPayload();
  const origin = window.location.origin === 'null' ? '' : window.location.origin;
  const pathname = window.location.pathname;
  const basePath = pathname.endsWith('index_old.html')
    ? pathname.replace(/index_old\.html$/, '')
    : pathname.slice(0, pathname.lastIndexOf('/') + 1);

  const linkInput = document.getElementById('contractLink');
  const openBtn = document.getElementById('openContractBtn');
  const status = document.getElementById('contractStatus');

  const setUi = (tokenValue) => {
    const link = `${origin}${basePath}contract_view.html?token=${encodeURIComponent(String(tokenValue || ''))}`;
    latestContractUrl = link;
    if (linkInput) linkInput.value = link;
    if (openBtn) openBtn.disabled = false;
    const sendBtn = document.getElementById('sendContractBtn');
    if (sendBtn) sendBtn.disabled = !latestContractId;
    if (status) {
      status.textContent = 'Sent';
      status.style.background = '#dbeafe';
      status.style.color = '#1d4ed8';
    }
    showToast('Contract link generated', 'success');
  };

  (async () => {
    // Prefer DB-backed contract creation when available; fallback to local.
    try {
      const mode = window.HMP_DB.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
      if (mode && mode !== 'LOCAL_ONLY' && window.HMP_DB.apiCreateContract) {
        const res = await window.HMP_DB.apiCreateContract(state.hotel.id, payload);
        if (res?.status === 401) {
          if (typeof fecoEnsureLogin === 'function') await fecoEnsureLogin();
        }
        const res2 = res?.status === 401 ? await window.HMP_DB.apiCreateContract(state.hotel.id, payload) : res;
        if (res2?.ok && res2?.contract?.token) {
          latestContractId = String(res2.contract.id || '');
          // Mirror into local storage (keeps local pages consistent/offline-friendly).
          try {
            if (res2.contract.legacyId) res2.contract.id = res2.contract.legacyId;
            window.HMP_DB.createContract({ ...payload, ...res2.contract, id: res2.contract.id });
            window.HMP_DB.updateContract(res2.contract.id, res2.contract);
          } catch {}
          setUi(res2.contract.token);
          return;
        }
      }
    } catch {}

    // Local fallback
    const contract = window.HMP_DB.createContract(payload);
    latestContractId = '';
    setUi(contract.token);
  })();
}

function initContractForm() {
  if (!document.getElementById('contractPanel')) return;
  const defaults = getPricingDefaults();
  if (defaults) {
    setInputValue('roomsMinPerSession', defaults.roomsMinPerSession);
    setInputValue('roomsMaxPerSession', defaults.roomsMaxPerSession);
    setInputValue('baseBoth', defaults.basePrices.BOTH);
    setInputValue('baseCarpet', defaults.basePrices.CARPET);
    setInputValue('baseTile', defaults.basePrices.TILE);
    setInputValue('penaltyBoth', defaults.penaltyPrices.BOTH);
    setInputValue('penaltyCarpet', defaults.penaltyPrices.CARPET);
    setInputValue('penaltyTile', defaults.penaltyPrices.TILE);
    setInputValue('contractBoth', defaults.contractPrices.BOTH);
    setInputValue('contractCarpet', defaults.contractPrices.CARPET);
    setInputValue('contractTile', defaults.contractPrices.TILE);
    setInputValue('advantageBoth', defaults.advantagePrices.BOTH);
    setInputValue('advantageCarpet', defaults.advantagePrices.CARPET);
    setInputValue('advantageTile', defaults.advantagePrices.TILE);
    setInputValue('sqftCarpet', defaults.sqftPrices.CARPET);
    setInputValue('sqftTile', defaults.sqftPrices.TILE);
  }

  updateContractFormFromHotel();
  updateContractCalculations();

  const watchedInputs = [
    'contractSurfaceType',
    'contractFrequency',
    'contractRoomsPerSession',
    'roomsMinPerSession',
    'roomsMaxPerSession',
    'baseBoth',
    'baseCarpet',
    'baseTile',
    'penaltyBoth',
    'penaltyCarpet',
    'penaltyTile',
    'contractBoth',
    'contractCarpet',
    'contractTile',
    'advantageBoth',
    'advantageCarpet',
    'advantageTile',
    'otherSqftCarpet',
    'otherSqftTile',
    'sqftCarpet',
    'sqftTile'
  ];

  watchedInputs.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (id === 'contractSurfaceType' || id === 'contractFrequency') {
        if (!contractManual.discount) updateContractCalculations();
      }
      updateContractCalculations();
    });
  });

  const generateBtn = document.getElementById('generateContractBtn');
  if (generateBtn) generateBtn.addEventListener('click', generateContractLink);

  const sendBtn = document.getElementById('sendContractBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      if (!latestContractId) {
        showToast('Create the contract first (Generate link)', 'warning');
        return;
      }
      try {
        sendBtn.disabled = true;
        const r = await window.HMP_DB.apiSendContract?.(latestContractId);
        if (r?.status === 401) {
          await fecoEnsureLogin();
        }
        const r2 = r?.status === 401 ? await window.HMP_DB.apiSendContract?.(latestContractId) : r;
        if (!r2?.ok) {
          const err = r2?.error || 'Send failed';
          showToast(String(err), 'error');
          return;
        }
        showToast('Email sent', 'success');
      } finally {
        sendBtn.disabled = !latestContractId;
      }
    });
  }

  const openBtn = document.getElementById('openContractBtn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (latestContractUrl) window.open(latestContractUrl, '_blank');
    });
  }
}

function getCleaningStatus(room) {
  if (!room.lastCleaned || !room.cleaningFrequency) return 'unknown';
  
  const daysSinceCleaning = Math.floor((Date.now() - room.lastCleaned) / (1000 * 60 * 60 * 24));
  const daysUntilDue = room.cleaningFrequency - daysSinceCleaning;
  
  if (daysSinceCleaning > room.cleaningFrequency) return 'overdue';
  if (daysUntilDue <= 30) return 'soon';
  return 'ok';
}

function getCleaningText(room) {
  if (!room.lastCleaned || !room.cleaningFrequency) return 'No data';
  
  const daysSinceCleaning = Math.floor((Date.now() - room.lastCleaned) / (1000 * 60 * 60 * 24));
  const daysUntilDue = room.cleaningFrequency - daysSinceCleaning;
  
  if (daysSinceCleaning > room.cleaningFrequency) return `Overdue by ${daysSinceCleaning - room.cleaningFrequency}d`;
  return `Due in ${daysUntilDue}d`;
}

// ===== SELECTION MODE =====
function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  state.selectedRooms.clear();
  
  if (state.selectionMode) {
    document.getElementById('selectionMode').style.display = 'flex';
    document.getElementById('toggleSelectionBtn').innerHTML = '<i class="fas fa-times"></i> Exit Selection';
    document.getElementById('toggleSelectionBtn').classList.add('active');
    showToast('Selection mode enabled. Click rooms to select.', 'info');
  } else {
    document.getElementById('selectionMode').style.display = 'none';
    document.getElementById('toggleSelectionBtn').innerHTML = '<i class="fas fa-check-square"></i> Multi-select';
    document.getElementById('toggleSelectionBtn').classList.remove('active');
  }
  
  renderAll();
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedRooms.clear();
  document.getElementById('selectionMode').style.display = 'none';
  document.getElementById('toggleSelectionBtn').innerHTML = '<i class="fas fa-check-square"></i> Multi-select';
  document.getElementById('toggleSelectionBtn').classList.remove('active');
  renderAll();
}

function toggleRoomSelection(roomId) {
  if (!state.selectionMode) return;
  
  if (state.selectedRooms.has(roomId)) {
    state.selectedRooms.delete(roomId);
  } else {
    state.selectedRooms.add(roomId);
  }
  
  updateStats();
  renderAll();
}

function batchAction(action, value) {
  if (state.selectedRooms.size === 0) {
    showToast('No rooms selected', 'warning');
    return;
  }
  
  let count = 0;
  
  state.hotel.buildings.forEach(building => {
    building.floors?.forEach(floor => {
      floor.rooms?.forEach(room => {
        if (state.selectedRooms.has(room.id)) {
          switch (action) {
            case 'status':
              room.active = value === 'active';
              count++;
              break;
            case 'surface':
              room.surface = value;
              count++;
              break;
            case 'frequency':
              room.cleaningFrequency = parseInt(value);
              count++;
              break;
          }
        }
      });
    });
  });
  
  updateSaveStatus('saving');
  renderAll();
  showToast(`Updated ${count} rooms`, 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

function batchDeleteSelected() {
  if (state.selectedRooms.size === 0) {
    showToast('No rooms selected', 'warning');
    return;
  }
  
  if (!confirm(`Delete ${state.selectedRooms.size} selected rooms?`)) return;
  
  state.hotel.buildings.forEach(building => {
    building.floors?.forEach(floor => {
      if (floor.rooms) {
        floor.rooms = floor.rooms.filter(room => !state.selectedRooms.has(room.id));
      }
    });
  });
  
  state.selectedRooms.clear();
  updateSaveStatus('saving');
  renderAll();
  showToast(`Deleted ${state.selectedRooms.size} rooms`, 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

// ===== RENDERING =====
function renderBuilding(building) {
  const isEditing = state.editing.buildingId === building.id;
  
  return `
    <div class="building-card" data-building-id="${building.id}">
      <div class="building-header">
        <div class="building-name ${isEditing ? 'editing' : ''}" 
             onclick="${isEditing ? '' : `startEditBuilding('${building.id}')`}">
          ${isEditing ? 
            `<input type="text" value="${building.name}" 
                    onblur="saveBuildingName('${building.id}', this.value)"
                    onkeydown="if(event.key === 'Enter') this.blur()"
                    autofocus>` 
            : building.name}
          <i class="fas fa-edit" style="font-size: 18px; opacity: 0.7;"></i>
        </div>
        <div class="building-actions">
          <button class="action-btn" onclick="addFloor('${building.id}')" title="Add floor">
            <i class="fas fa-layer-group"></i>
          </button>
          <button class="action-btn primary" onclick="startAddSpace('${building.id}')" title="Add space">
            <i class="fas fa-plus"></i>
          </button>
          <button class="action-btn danger" onclick="deleteBuilding('${building.id}')" title="Delete building">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      
      <div class="building-notes">
        ${isEditing ? 
          `<textarea class="notes-input" placeholder="Notes (optional)" 
                    onblur="saveBuildingNotes('${building.id}', this.value)">${building.notes || ''}</textarea>`
          : building.notes ? 
            `<div class="notes-display" onclick="startEditBuilding('${building.id}')">
              <i class="fas fa-sticky-note"></i> ${building.notes}
            </div>`
            : `<div class="notes-display" onclick="startEditBuilding('${building.id}')" style="color: #94a3b8;">
                <i class="fas fa-plus"></i> Add notes
              </div>`}
      </div>
      
      <div class="floors-container">
        ${building.floors?.map(floor => renderFloor(floor, building.id)).join('') || 
          `<div class="empty-state">
            <div class="empty-icon">🏗️</div>
            <h3>No floors yet</h3>
            <p>Click the <i class="fas fa-layer-group"></i> button to add one</p>
          </div>`}
      </div>
      
      <div class="building-stats">
        <span><i class="fas fa-layer-group"></i> ${building.floors?.length || 0} floors</span>
        <span><i class="fas fa-door-closed"></i> ${building.floors?.reduce((total, floor) => total + (floor.rooms?.length || 0), 0)} rooms</span>
      </div>
    </div>
  `;
}

function renderFloor(floor, buildingId) {
  const isEditing = state.editing.floorId === floor.id;
  const roomCount = floor.rooms?.length || 0;
  const spaceCount = floor.spaces?.length || 0;
  
  return `
    <div class="floor-card" data-floor-id="${floor.id}">
      <div class="floor-header">
        <div class="floor-title">
          <div class="floor-name ${isEditing ? 'editing' : ''}" 
               onclick="${isEditing ? '' : `startEditFloor('${floor.id}')`}">
            ${isEditing ? 
              `<input type="text" value="${floor.nameOrNumber}" 
                      onblur="saveFloorName('${floor.id}', this.value)"
                      onkeydown="if(event.key === 'Enter') this.blur()"
                      autofocus>` 
              : `Floor ${floor.nameOrNumber}`}
          </div>
          <div class="floor-stats">
            <i class="fas fa-door-closed"></i> ${roomCount} rooms
            <i class="fas fa-square"></i> ${spaceCount} spaces
          </div>
        </div>
        <div class="floor-actions">
          <button class="action-btn primary" onclick="openBulkModal('${floor.id}')" title="Add multiple rooms">
            <i class="fas fa-bolt"></i> 20
          </button>
          <button class="action-btn danger" onclick="deleteFloor('${buildingId}', '${floor.id}')" title="Delete floor">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      
      ${floor.notes ? 
        `<div class="notes-display" onclick="startEditFloor('${floor.id}')" style="margin-bottom: 20px;">
          <i class="fas fa-sticky-note"></i> ${floor.notes}
        </div>`
        : ''}
      
      <div class="rooms-grid" style="grid-template-columns: repeat(5, 1fr);">
        ${floor.rooms?.map(room => renderRoom(room)).join('') || ''}
        <div class="add-room-btn" onclick="addRoom('${floor.id}')" title="Add room">
          <i class="fas fa-plus"></i>
        </div>
      </div>
      
      <div class="spaces-list">
        ${floor.spaces?.map(space => renderSpace(space)).join('') || ''}
        <button class="add-space-btn" onclick="startAddSpaceToFloor('${floor.id}')">
          <i class="fas fa-plus"></i> Add Space
        </button>
      </div>
    </div>
  `;
}

function renderRoom(room) {
  const isEditing = state.editing.roomId === room.id;
  const isSelected = state.selectedRooms.has(room.id);
  const surfaceClass = room.surface.toLowerCase();
  const cleaningStatus = getCleaningStatus(room);
  const cleaningText = getCleaningText(room);
  const daysClass = cleaningStatus === 'overdue' ? 'overdue' : cleaningStatus === 'soon' ? 'soon' : 'ok';
  
  // Version compacte pour la grille
  return `
    <div class="room-chip ${surfaceClass} ${!room.active ? 'inactive' : ''} ${isSelected ? 'selected' : ''}" 
         data-room-id="${room.id}"
         onclick="${state.selectionMode ? `toggleRoomSelection('${room.id}')` : `toggleRoomDetail('${room.id}')`}"
         title="Click to view details\n${room.roomNumber} - ${room.surface}\n${cleaningText}">
      ${state.selectionMode ? 
        `<div class="room-checkbox" onclick="event.stopPropagation(); toggleRoomSelection('${room.id}')"></div>` 
        : ''}
      <span class="room-number">${room.roomNumber}</span>
      <span class="room-days ${daysClass}">${cleaningText}</span>
      ${room.notes ? `<i class="fas fa-comment" style="font-size: 12px; opacity: 0.7;"></i>` : ''}
    </div>
  `;
}

function renderSpace(space) {
  const isEditing = state.editing.spaceId === space.id;
  const typeClass = space.type.toLowerCase();
  
  if (isEditing) {
    return `
      <div class="space-chip editing ${typeClass}" data-space-id="${space.id}">
        <input type="text" value="${space.name}" placeholder="Name" style="width: 120px;">
        <select value="${space.type}" style="width: 120px;">
          <option value="CORRIDOR">Corridor</option>
          <option value="LOBBY">Lobby</option>
          <option value="MEETING">Meeting</option>
          <option value="GYM">Gym</option>
          <option value="OTHER">Other</option>
        </select>
        <input type="number" value="${space.sqft || ''}" placeholder="Sqft" style="width: 80px;">
        <button class="tiny-btn" onclick="saveSpaceEdit('${space.id}')">
          <i class="fas fa-check"></i>
        </button>
        <button class="tiny-btn danger" onclick="deleteSpace('${space.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }
  
  return `
    <div class="space-chip ${typeClass}" 
         data-space-id="${space.id}"
         onclick="startEditSpace('${space.id}')"
         title="${space.name} - ${space.type}${space.sqft ? ` (${space.sqft} sqft)` : ''}">
      <i class="fas fa-${typeClass === 'corridor' ? 'walking' : 
                         typeClass === 'lobby' ? 'door-open' : 
                         typeClass === 'meeting' ? 'users' : 
                         typeClass === 'gym' ? 'dumbbell' : 'shapes'}"></i>
      <span>${space.name}</span>
      ${space.sqft ? `<small>${space.sqft} sqft</small>` : ''}
    </div>
  `;
}

function renderAll() {
  const container = document.getElementById('buildingsContainer');
  if (!container) return;
  container.innerHTML = state.hotel.buildings.map(building => renderBuilding(building)).join('');
  updateStats();
  updateSetupPreview();
}

// ===== ROOM DETAIL CARD =====
function toggleRoomDetail(roomId) {
  // If selection mode is enabled, use the selection
  if (state.selectionMode) {
    toggleRoomSelection(roomId);
    return;
  }
  
  // Close any in-progress editing first
  if (state.editing.roomId === roomId) {
    state.editing = {};
    renderAll();
    return;
  }
  
  // Close any other open detail card
  document.querySelectorAll('.room-detail-card').forEach(card => {
    card.remove();
  });
  
  // Find the room
  let room = null;
  let buildingName = '';
  let floorName = '';
  
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const foundRoom = floor.rooms?.find(r => r.id === roomId);
      if (foundRoom) {
        room = foundRoom;
        buildingName = building.name;
        floorName = floor.nameOrNumber;
        break;
      }
    }
    if (room) break;
  }
  
  if (!room) return;
  
  // Create the detail card
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  const rect = roomEl.getBoundingClientRect();
  
  const detailCard = document.createElement('div');
  detailCard.className = 'room-detail-card';
  detailCard.id = `room-detail-${roomId}`;
  detailCard.style.cssText = `
    position: fixed;
    top: ${rect.top - 10}px;
    left: ${rect.right + 20}px;
    z-index: 1000;
    min-width: 320px;
  `;
  
  const cleaningStatus = getCleaningStatus(room);
  const cleaningText = getCleaningText(room);
  const lastCleanedDate = room.lastCleaned ? new Date(room.lastCleaned).toLocaleDateString('en-US') : 'Never';
  const nextCleaningDate = room.lastCleaned ? 
    new Date(room.lastCleaned + room.cleaningFrequency * 24 * 60 * 60 * 1000).toLocaleDateString('en-US') : 
    'Unknown';
  
  detailCard.innerHTML = `
    <div class="detail-header">
      <h4><i class="fas fa-door-closed"></i> Room ${room.roomNumber}</h4>
      <button class="btn-close" onclick="closeRoomDetail('${roomId}')">×</button>
    </div>
    <div class="detail-body">
      <div class="detail-info">
        <div class="info-row">
          <span class="label">Building:</span>
          <span class="value">${buildingName}</span>
        </div>
        <div class="info-row">
          <span class="label">Floor:</span>
          <span class="value">${floorName}</span>
        </div>
        <div class="info-row">
          <span class="label">Surface:</span>
          <span class="value ${room.surface.toLowerCase()}">${room.surface}</span>
        </div>
        <div class="info-row">
          <span class="label">Status:</span>
          <span class="value ${room.active ? 'active' : 'inactive'}">
            <i class="fas fa-${room.active ? 'check-circle' : 'times-circle'}"></i>
            ${room.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div class="info-row">
          <span class="label">Cleaning Status:</span>
          <span class="value ${cleaningStatus}">
            <i class="fas fa-${cleaningStatus === 'overdue' ? 'exclamation-triangle' : cleaningStatus === 'soon' ? 'exclamation-circle' : 'check-circle'}"></i>
            ${cleaningText}
          </span>
        </div>
        <div class="info-row">
          <span class="label">Last Cleaned:</span>
          <span class="value">${lastCleanedDate}</span>
        </div>
        <div class="info-row">
          <span class="label">Next Cleaning:</span>
          <span class="value">${nextCleaningDate}</span>
        </div>
      </div>
      
      <div class="detail-actions">
        <div class="action-group">
          <label><i class="fas fa-comment"></i> Notes</label>
          <textarea class="room-notes-input" placeholder="Add notes about this room..." 
                    onblur="saveRoomNotes('${roomId}', this.value)">${room.notes || ''}</textarea>
        </div>
        
        <div class="action-group">
          <label><i class="fas fa-vector-square"></i> Surface Type</label>
          <select class="surface-select" onchange="saveRoomSurface('${roomId}', this.value)">
            <option value="CARPET" ${room.surface === 'CARPET' ? 'selected' : ''}>Carpet</option>
            <option value="TILE" ${room.surface === 'TILE' ? 'selected' : ''}>Tile</option>
            <option value="BOTH" ${room.surface === 'BOTH' ? 'selected' : ''}>Both</option>
            <option value="OTHER" ${room.surface === 'OTHER' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        
        <div class="action-group">
          <label><i class="fas fa-broom"></i> Cleaning Frequency</label>
          <select class="frequency-select" onchange="saveRoomFrequency('${roomId}', parseInt(this.value))">
            <option value="30" ${room.cleaningFrequency === 30 ? 'selected' : ''}>Monthly (30 days)</option>
            <option value="90" ${room.cleaningFrequency === 90 ? 'selected' : ''}>Quarterly (90 days)</option>
            <option value="183" ${room.cleaningFrequency === 183 ? 'selected' : ''}>Every 6 months (183 days)</option>
            <option value="365" ${room.cleaningFrequency === 365 ? 'selected' : ''}>Yearly (365 days)</option>
          </select>
        </div>
        
        <div class="button-group">
          <button class="btn-small primary" onclick="markAsCleaned('${roomId}'); closeRoomDetail('${roomId}')">
            <i class="fas fa-broom"></i> Mark as Cleaned
          </button>
          <button class="btn-small ${room.active ? 'danger' : 'success'}" onclick="toggleRoomStatus('${roomId}'); closeRoomDetail('${roomId}')">
            <i class="fas fa-${room.active ? 'eye-slash' : 'eye'}"></i> ${room.active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="btn-small danger" onclick="deleteRoom('${roomId}'); closeRoomDetail('${roomId}')">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(detailCard);
  
  // Reposition if the card overflows the viewport
  setTimeout(() => {
    const cardRect = detailCard.getBoundingClientRect();
    if (cardRect.right > window.innerWidth) {
      detailCard.style.left = `${rect.left - cardRect.width - 20}px`;
    }
    if (cardRect.bottom > window.innerHeight) {
      detailCard.style.top = `${window.innerHeight - cardRect.height - 20}px`;
    }
  }, 0);
}

function closeRoomDetail(roomId) {
  const detailCard = document.getElementById(`room-detail-${roomId}`);
  if (detailCard) detailCard.remove();
}

function saveRoomNotes(roomId, notes) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room) {
        room.notes = notes.trim();
        updateSaveStatus('saving');
        renderAll();
        setTimeout(() => updateSaveStatus('saved'), 300);
        return;
      }
    }
  }
}

// ===== BUILDING ACTIONS =====
function addBuilding() {
  const newBuilding = {
    id: generateId('building'),
    name: `Building ${String.fromCharCode(65 + state.hotel.buildings.length)}`,
    notes: '',
    floors: []
  };
  
  state.hotel.buildings.push(newBuilding);
  updateSaveStatus('saving');
  renderAll();
  showToast(`Building "${newBuilding.name}" added`, 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

function startEditBuilding(buildingId) {
  state.editing = { buildingId };
  renderAll();
}

function saveBuildingName(buildingId, newName) {
  const building = state.hotel.buildings.find(b => b.id === buildingId);
  if (building && newName.trim()) {
    building.name = newName.trim();
    updateSaveStatus('saving');
    showToast(`Building renamed to "${building.name}"`, 'success');
    state.editing = {};
    renderAll();
    setTimeout(() => updateSaveStatus('saved'), 500);
  }
}

function saveBuildingNotes(buildingId, notes) {
  const building = state.hotel.buildings.find(b => b.id === buildingId);
  if (building) {
    building.notes = notes.trim();
    state.editing = {};
    updateSaveStatus('saving');
    renderAll();
    setTimeout(() => updateSaveStatus('saved'), 300);
  }
}

function deleteBuilding(buildingId) {
  if (confirm('Delete this building and all its floors?')) {
    state.hotel.buildings = state.hotel.buildings.filter(b => b.id !== buildingId);
    updateSaveStatus('saving');
    renderAll();
    showToast('Building deleted', 'success');
    setTimeout(() => updateSaveStatus('saved'), 500);
  }
}

// ===== FLOOR ACTIONS =====
function addFloor(buildingId) {
  const building = state.hotel.buildings.find(b => b.id === buildingId);
  if (building) {
    const floorNumber = (building.floors?.length || 0) + 1;
    const newFloor = {
      id: generateId('floor'),
      nameOrNumber: String(floorNumber),
      sortOrder: floorNumber,
      notes: '',
      rooms: [],
      spaces: []
    };
    
    if (!building.floors) building.floors = [];
    building.floors.push(newFloor);
    
    updateSaveStatus('saving');
    renderAll();
    showToast(`Floor ${floorNumber} added to ${building.name}`, 'success');
    setTimeout(() => updateSaveStatus('saved'), 500);
  }
}

function startEditFloor(floorId) {
  state.editing = { floorId };
  renderAll();
}

function saveFloorName(floorId, newName) {
  for (const building of state.hotel.buildings) {
    const floor = building.floors?.find(f => f.id === floorId);
    if (floor && newName.trim()) {
      floor.nameOrNumber = newName.trim();
      updateSaveStatus('saving');
      showToast(`Floor renamed to ${newName}`, 'success');
      state.editing = {};
      renderAll();
      setTimeout(() => updateSaveStatus('saved'), 500);
      break;
    }
  }
}

function deleteFloor(buildingId, floorId) {
  if (confirm('Delete this floor and all its rooms?')) {
    const building = state.hotel.buildings.find(b => b.id === buildingId);
    if (building?.floors) {
      building.floors = building.floors.filter(f => f.id !== floorId);
      updateSaveStatus('saving');
      renderAll();
      showToast('Floor deleted', 'success');
      setTimeout(() => updateSaveStatus('saved'), 500);
    }
  }
}

// ===== ROOM ACTIONS =====
function addRoom(floorId) {
  for (const building of state.hotel.buildings) {
    const floor = building.floors?.find(f => f.id === floorId);
    if (floor) {
      const roomNumber = (floor.rooms?.length || 0) + 101;
      const newRoom = {
        id: generateId('room'),
        roomNumber: String(roomNumber),
        surface: 'CARPET',
        active: true,
        cleaningFrequency: 183,
        lastCleaned: Date.now()
      };
      
      if (!floor.rooms) floor.rooms = [];
      floor.rooms.push(newRoom);
      
      updateSaveStatus('saving');
      renderAll();
      showToast(`Room ${roomNumber} added`, 'success');
      setTimeout(() => updateSaveStatus('saved'), 500);
      break;
    }
  }
}

function startEditRoom(roomId) {
  state.editing = { roomId };
  renderAll();
}

function saveRoomNumber(roomId, newNumber) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room && newNumber.trim()) {
        room.roomNumber = newNumber.trim();
        break;
      }
    }
  }
}

function saveRoomSurface(roomId, surface) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room) {
        room.surface = surface;
        updateSaveStatus('saving');
        setTimeout(() => updateSaveStatus('saved'), 300);
        break;
      }
    }
  }
}

function saveRoomFrequency(roomId, frequency) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room) {
        room.cleaningFrequency = parseInt(frequency);
        updateSaveStatus('saving');
        setTimeout(() => updateSaveStatus('saved'), 300);
        break;
      }
    }
  }
}

function saveRoomEdit(roomId) {
  updateSaveStatus('saving');
  state.editing = {};
  renderAll();
  showToast('Room updated', 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

function deleteRoom(roomId) {
  if (confirm('Delete this room?')) {
    for (const building of state.hotel.buildings) {
      for (const floor of building.floors || []) {
        if (floor.rooms) {
          floor.rooms = floor.rooms.filter(r => r.id !== roomId);
          updateSaveStatus('saving');
          state.editing = {};
          renderAll();
          showToast('Room deleted', 'success');
          setTimeout(() => updateSaveStatus('saved'), 500);
          return;
        }
      }
    }
  }
}

function toggleRoomStatus(roomId) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room) {
        room.active = !room.active;
        updateSaveStatus('saving');
        renderAll();
        showToast(`Room ${room.active ? 'activated' : 'deactivated'}`, 'success');
        setTimeout(() => updateSaveStatus('saved'), 500);
        return;
      }
    }
  }
}

function markAsCleaned(roomId) {
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const room = floor.rooms?.find(r => r.id === roomId);
      if (room) {
        room.lastCleaned = Date.now();
        updateSaveStatus('saving');
        renderAll();
        showToast('Room marked as cleaned', 'success');
        setTimeout(() => updateSaveStatus('saved'), 500);
        return;
      }
    }
  }
}

// ===== SPACE ACTIONS =====
function startAddSpace(buildingId) {
  const building = state.hotel.buildings.find(b => b.id === buildingId);
  if (building?.floors?.[0]) {
    startAddSpaceToFloor(building.floors[0].id);
  }
}

function startAddSpaceToFloor(floorId) {
  for (const building of state.hotel.buildings) {
    const floor = building.floors?.find(f => f.id === floorId);
    if (floor) {
      const newSpace = {
        id: generateId('space'),
        name: 'New Space',
        type: 'CORRIDOR',
        sqft: 500,
        cleaningFrequency: 183
      };
      
      if (!floor.spaces) floor.spaces = [];
      floor.spaces.push(newSpace);
      
      state.editing = { spaceId: newSpace.id };
      updateSaveStatus('saving');
      renderAll();
      setTimeout(() => updateSaveStatus('saved'), 500);
      break;
    }
  }
}

function startEditSpace(spaceId) {
  state.editing = { spaceId };
  renderAll();
}

function saveSpaceEdit(spaceId) {
  const spaceEl = document.querySelector(`[data-space-id="${spaceId}"]`);
  const nameInput = spaceEl.querySelector('input[type="text"]');
  const typeSelect = spaceEl.querySelector('select');
  const sqftInput = spaceEl.querySelector('input[type="number"]');
  
  for (const building of state.hotel.buildings) {
    for (const floor of building.floors || []) {
      const space = floor.spaces?.find(s => s.id === spaceId);
      if (space) {
        space.name = nameInput.value.trim() || 'Unnamed Space';
        space.type = typeSelect.value;
        space.sqft = sqftInput.value ? parseInt(sqftInput.value) : undefined;
        break;
      }
    }
  }
  
  updateSaveStatus('saving');
  state.editing = {};
  renderAll();
  showToast('Space updated', 'success');
  setTimeout(() => updateSaveStatus('saved'), 500);
}

function deleteSpace(spaceId) {
  if (confirm('Delete this space?')) {
    for (const building of state.hotel.buildings) {
      for (const floor of building.floors || []) {
        if (floor.spaces) {
          floor.spaces = floor.spaces.filter(s => s.id !== spaceId);
          updateSaveStatus('saving');
          state.editing = {};
          renderAll();
          showToast('Space deleted', 'success');
          setTimeout(() => updateSaveStatus('saved'), 500);
          return;
        }
      }
    }
  }
}

// ===== BULK ROOMS MODAL =====
function openBulkModal(floorId) {
  bulkModalData.floorId = floorId;
  bulkModalData.startRoomNumber = '';
  bulkModalData.count = 20;
  bulkModalData.surface = 'TILE';
  bulkModalData.frequency = 183;
  
  document.getElementById('bulkStartRoom').value = '';
  document.getElementById('bulkCount').value = '20';
  document.getElementById('bulkSurface').value = 'TILE';
  document.getElementById('bulkFrequency').value = '183';
  
  updateBulkPreview();
  document.getElementById('bulkModal').style.display = 'flex';
}

function closeBulkModal() {
  document.getElementById('bulkModal').style.display = 'none';
}

function adjustBulkCount(delta) {
  const input = document.getElementById('bulkCount');
  let value = parseInt(input.value) + delta;
  value = Math.max(1, Math.min(100, value));
  input.value = value;
  bulkModalData.count = value;
  updateBulkPreview();
}

function updateBulkPreview() {
  const preview = document.getElementById('bulkPreview');
  const startRoom = document.getElementById('bulkStartRoom').value.trim();
  const count = parseInt(document.getElementById('bulkCount').value) || 20;
  const surface = document.getElementById('bulkSurface').value;
  const frequency = parseInt(document.getElementById('bulkFrequency').value) || 183;
  
  if (!startRoom) {
    preview.innerHTML = '<div class="hint">Enter a starting room number to see preview</div>';
    return;
  }
  
  const match = startRoom.match(/^(.*?)(\d+)$/);
  if (!match) {
    preview.innerHTML = '<div class="hint" style="color: #ef4444;">Invalid format. Must end with digits (ex: 101, A101)</div>';
    return;
  }
  
  const prefix = match[1] || '';
  const digits = match[2] || '';
  const pad = digits.length;
  const startNum = parseInt(digits);
  
  if (isNaN(startNum)) {
    preview.innerHTML = '<div class="hint" style="color: #ef4444;">Invalid number</div>';
    return;
  }
  
  const lastNum = startNum + count - 1;
  const lastRoom = `${prefix}${String(lastNum).padStart(pad, '0')}`;
  const frequencyText = frequency === 183 ? '6 months' : frequency === 365 ? '1 year' : frequency === 90 ? '3 months' : `${frequency} days`;
  
  preview.innerHTML = `
    <div style="font-weight: 700; color: #1e293b; margin-bottom: 8px; font-size: 15px;">Preview:</div>
    <div style="font-size: 20px; font-weight: 900; color: #2d5af1; margin-bottom: 8px;">
      ${startRoom} → ${lastRoom}
    </div>
    <div style="color: #64748b; font-size: 14px; line-height: 1.5;">
      <div>${count} rooms total</div>
      <div>Surface: ${surface}</div>
      <div>Cleaning: Every ${frequencyText}</div>
    </div>
  `;
}

function createBulkRooms() {
  const startRoom = document.getElementById('bulkStartRoom').value.trim();
  const count = parseInt(document.getElementById('bulkCount').value);
  const surface = document.getElementById('bulkSurface').value;
  const frequency = parseInt(document.getElementById('bulkFrequency').value);
  
  if (!startRoom) {
    showToast('Please enter a starting room number', 'error');
    return;
  }
  
  const match = startRoom.match(/^(.*?)(\d+)$/);
  if (!match) {
    showToast('Invalid format. Must end with digits (ex: 101, A101)', 'error');
    return;
  }
  
  const prefix = match[1] || '';
  const digits = match[2] || '';
  const pad = digits.length;
  let startNum = parseInt(digits);
  
  if (isNaN(startNum)) {
    showToast('Invalid starting number', 'error');
    return;
  }
  
  // Find the floor and add rooms
  for (const building of state.hotel.buildings) {
    const floor = building.floors?.find(f => f.id === bulkModalData.floorId);
    if (floor) {
      if (!floor.rooms) floor.rooms = [];
      
      for (let i = 0; i < count; i++) {
        const roomNumber = `${prefix}${String(startNum + i).padStart(pad, '0')}`;
        floor.rooms.push({
          id: generateId('room'),
          roomNumber,
          surface,
          active: true,
          cleaningFrequency: frequency,
          lastCleaned: Date.now()
        });
      }
      
      updateSaveStatus('saving');
      closeBulkModal();
      renderAll();
      showToast(`Created ${count} rooms successfully`, 'success');
      setTimeout(() => updateSaveStatus('saved'), 500);
      break;
    }
  }
}

// ===== QUICK SETUP =====
function toggleQuickSetup() {
  const panel = document.getElementById('quickSetupPanel');
  panel.classList.toggle('open');
}

function adjustSetupValue(field, delta) {
  const input = document.getElementById(`setup${field.charAt(0).toUpperCase() + field.slice(1)}`);
  let value = parseInt(input.value) + delta;
  
  const limits = {
    buildings: [1, 5],
    floorsPerBuilding: [1, 10],
    roomsPerFloor: [1, 50]
  };
  
  if (limits[field]) {
    value = Math.max(limits[field][0], Math.min(limits[field][1], value));
  }
  
  input.value = value;
  updateSetupPreview();
}

function updateSurfacePreview() {
  const carpetEl = document.getElementById('setupCarpet');
  const tileEl = document.getElementById('setupTile');
  const otherEl = document.getElementById('setupOther');
  if (!carpetEl || !tileEl || !otherEl) return;

  const carpet = carpetEl.checked;
  const tile = tileEl.checked;
  const other = otherEl.checked;
  
  const surfaces = [];
  if (carpet) surfaces.push('Carpet');
  if (tile) surfaces.push('Tile');
  if (other) surfaces.push('Other');
  
  let text = 'No surface selected';
  if (surfaces.length === 1) text = surfaces[0];
  else if (surfaces.length > 1) text = `Mix: ${surfaces.join(' + ')}`;
  
  document.getElementById('surfacePreview').textContent = text;
  updateSetupPreview();
}

function updateSetupPreview() {
  const buildingsEl = document.getElementById('setupBuildings');
  const floorsEl = document.getElementById('setupFloorsPerBuilding');
  const roomsEl = document.getElementById('setupRoomsPerFloor');
  const startRoomEl = document.getElementById('setupStartRoom');
  const previewEl = document.getElementById('setupPreview');
  const detailsEl = document.getElementById('setupDetails');
  if (!buildingsEl || !floorsEl || !roomsEl || !startRoomEl || !previewEl || !detailsEl) return;

  const buildings = parseInt(buildingsEl.value);
  const floorsPerBuilding = parseInt(floorsEl.value);
  const roomsPerFloor = parseInt(roomsEl.value);
  const startRoom = startRoomEl.value;
  const totalRooms = buildings * floorsPerBuilding * roomsPerFloor;
  
  // Get selected surfaces
  const carpet = document.getElementById('setupCarpet')?.checked;
  const tile = document.getElementById('setupTile')?.checked;
  const other = document.getElementById('setupOther')?.checked;
  const surfaceCount = (carpet ? 1 : 0) + (tile ? 1 : 0) + (other ? 1 : 0);
  
  // Get frequency
  const frequency = parseInt(document.querySelector('input[name="frequency"]:checked').value);
  const frequencyText = frequency === 183 ? '6 months' : frequency === 365 ? '1 year' : frequency === 90 ? '3 months' : `${frequency} days`;
  
  previewEl.innerHTML = `
    <strong>Preview:</strong> ${buildings} building(s) × ${floorsPerBuilding} floors × ${roomsPerFloor} rooms = 
    <span style="color: #2d5af1; font-weight: 800;">${totalRooms}</span> total rooms
  `;
  
  detailsEl.innerHTML = `
    <div>• Surface types: ${carpet ? 'Carpet ' : ''}${tile ? 'Tile ' : ''}${other ? 'Other ' : ''}</div>
    <div>• Cleaning frequency: ${frequencyText}</div>
    <div>• Start room: ${startRoom || '101'}</div>
    <div>• All rooms will be created as Active</div>
  `;
}

function generateStructure() {
  const buildings = parseInt(document.getElementById('setupBuildings').value);
  const floorsPerBuilding = parseInt(document.getElementById('setupFloorsPerBuilding').value);
  const roomsPerFloor = parseInt(document.getElementById('setupRoomsPerFloor').value);
  const startRoom = document.getElementById('setupStartRoom').value;
  const frequency = parseInt(document.querySelector('input[name="frequency"]:checked').value);
  
  // Get selected surfaces
  const carpet = document.getElementById('setupCarpet').checked;
  const tile = document.getElementById('setupTile').checked;
  const other = document.getElementById('setupOther').checked;
  
  if (!carpet && !tile && !other) {
    showToast('Please select at least one surface type', 'error');
    return;
  }
  
  // Clear existing structure
  state.hotel.buildings = [];
  
  updateSaveStatus('saving');
  
  // Surface distribution
  const surfaces = [];
  if (carpet) surfaces.push('CARPET');
  if (tile) surfaces.push('TILE');
  if (other) surfaces.push('OTHER');
  
  // Generate new structure
  for (let b = 0; b < buildings; b++) {
    const buildingLetter = String.fromCharCode(65 + b);
    const building = {
      id: generateId('building'),
      name: `Building ${buildingLetter}`,
      notes: '',
      floors: []
    };
    
    for (let f = 0; f < floorsPerBuilding; f++) {
      const floor = {
        id: generateId('floor'),
        nameOrNumber: String(f + 1),
        sortOrder: f + 1,
        rooms: [],
        spaces: []
      };
      
      // Generate rooms
      for (let r = 0; r < roomsPerFloor; r++) {
        const roomNumber = buildingLetter === 'A' && startRoom ? 
          `${String(f + 1)}${String(r + parseInt(startRoom.slice(-2)) || 1).toString().padStart(2, '0')}` :
          `${buildingLetter}${f + 1}${String(r + 1).padStart(2, '0')}`;
        
        // Distribute surfaces evenly
        const surface = surfaces[Math.floor((r % surfaces.length))];
        
        floor.rooms.push({
          id: generateId('room'),
          roomNumber,
          surface,
          active: true,
          cleaningFrequency: frequency,
          lastCleaned: Date.now() - Math.floor(Math.random() * frequency) * 24 * 60 * 60 * 1000
        });
      }
      
      // Intentionally do NOT auto-create corridor/spaces in quick setup.
      // If needed, spaces (corridors, lobby, etc.) can be added manually later.
      
      building.floors.push(floor);
    }
    
    state.hotel.buildings.push(building);
  }
  
  toggleQuickSetup();
  renderAll();
  showToast(`Generated ${buildings} buildings with ${floorsPerBuilding * roomsPerFloor * buildings} total rooms`, 'success');
  setTimeout(() => updateSaveStatus('saved'), 1000);
}

// ===== EXPORT =====
function exportData() {
  const data = {
    hotel: state.hotel,
    exportedAt: new Date().toISOString(),
    summary: {
      buildings: state.hotel.buildings.length,
      floors: state.hotel.buildings.reduce((total, b) => total + (b.floors?.length || 0), 0),
      rooms: state.hotel.buildings.reduce((total, b) => 
        total + (b.floors?.reduce((fTotal, f) => fTotal + (f.rooms?.length || 0), 0) || 0), 0),
      spaces: state.hotel.buildings.reduce((total, b) => 
        total + (b.floors?.reduce((fTotal, f) => fTotal + (f.spaces?.length || 0), 0) || 0), 0)
    }
  };
  
  const dataStr = JSON.stringify(data, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `hotel-config-${new Date().toISOString().split('T')[0]}.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
  
  showToast('Setup exported as JSON', 'success');
}

// ===== INITIALIZATION =====
async function init() {
  await ensureAppDataInitialized();
  initSyncStatusUI();
  // Seed demo data if requested
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' && window.HMP_DEMO?.ensureDemoHotel) {
      window.HMP_DEMO.ensureDemoHotel();
    }
  } catch {}
  const hasConfig = !!document.getElementById('buildingsContainer');
  const hasSetup = !!document.getElementById('setupBuildings');
  const hasBulk = !!document.getElementById('bulkStartRoom');

  if (hasConfig) {
    renderAll();
    updateSetupPreview();
    updateSurfacePreview();
  }
  updateHotelSelector();
  initContractForm();
  initPlanning();
  initSettings();
  initAgendaPage();
  initHotelWizard();
  renderHotelDashboard();
  initHotelIncidents();
  initHotelTasksManager();
  initTaskView();
  initHotelStaff();
  initStaffTasks();
  initReportsPage();

  initDemoTour();
  
  // Add event listeners
  const hotelSelect = document.getElementById('hotelSelect');
  if (hotelSelect) {
    hotelSelect.addEventListener('change', (e) => onHotelSelected(e.target.value));
  }
  if (hasBulk) {
    document.getElementById('bulkStartRoom').addEventListener('input', updateBulkPreview);
    document.getElementById('bulkCount').addEventListener('input', function() {
      bulkModalData.count = parseInt(this.value) || 20;
      updateBulkPreview();
    });
    document.getElementById('bulkSurface').addEventListener('change', function() {
      bulkModalData.surface = this.value;
      updateBulkPreview();
    });
    document.getElementById('bulkFrequency').addEventListener('input', updateBulkPreview);
  }
  
  // Setup inputs
  if (hasSetup) {
    ['setupBuildings', 'setupFloorsPerBuilding', 'setupRoomsPerFloor', 'setupStartRoom'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateSetupPreview);
    });
  }
  
  // Surface checkboxes
  if (hasSetup) {
    ['setupCarpet', 'setupTile', 'setupOther'].forEach(id => {
      document.getElementById(id).addEventListener('change', updateSurfacePreview);
    });
  }
  
  // Frequency radios
  if (hasSetup) {
    document.querySelectorAll('input[name="frequency"]').forEach(radio => {
      radio.addEventListener('change', updateSetupPreview);
    });
  }
  
  console.log('Hotel Layout Pro V2 initialized!');
}

// ===== SYNC STATUS UI (shadow mode) =====
function initSyncStatusUI() {
  if (!window.HMP_DB?.getMigrationMode) return;
  const mode = window.HMP_DB.getMigrationMode();
  if (!mode || mode === 'LOCAL_ONLY') return;

  if (document.getElementById('fecoSyncBadge')) return;

  const badge = document.createElement('div');
  badge.id = 'fecoSyncBadge';
  badge.style.position = 'fixed';
  badge.style.right = '14px';
  badge.style.bottom = '14px';
  badge.style.zIndex = '9999';
  badge.style.background = 'rgba(15,23,42,0.92)';
  badge.style.color = '#e2e8f0';
  badge.style.border = '1px solid rgba(148,163,184,0.25)';
  badge.style.borderRadius = '12px';
  badge.style.padding = '10px 12px';
  badge.style.minWidth = '240px';
  badge.style.boxShadow = '0 10px 28px rgba(0,0,0,0.25)';
  badge.style.backdropFilter = 'blur(8px)';
  badge.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  badge.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>
        <div style="font-weight:800; font-size:12px; letter-spacing:0.02em;">SYNC</div>
        <div id="fecoSyncText" style="font-size:12px; color:#cbd5e1;">${mode}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="fecoSyncNow" type="button" style="background:#0ea5e9; border:0; color:white; padding:8px 10px; border-radius:10px; font-weight:800; cursor:pointer; font-size:12px;">Sync</button>
        <button id="fecoLoginBtn" type="button" style="background:transparent; border:1px solid rgba(148,163,184,0.35); color:#e2e8f0; padding:8px 10px; border-radius:10px; font-weight:800; cursor:pointer; font-size:12px;">Login</button>
        <button id="fecoSyncClose" type="button" style="background:transparent; border:1px solid rgba(148,163,184,0.35); color:#e2e8f0; padding:8px 10px; border-radius:10px; font-weight:800; cursor:pointer; font-size:12px;">Hide</button>
      </div>
    </div>
    <div id="fecoSyncDetail" style="margin-top:8px; font-size:12px; color:#94a3b8;"></div>
  `;

  document.body.appendChild(badge);
  const text = badge.querySelector('#fecoSyncText');
  const detail = badge.querySelector('#fecoSyncDetail');
  const btn = badge.querySelector('#fecoSyncNow');
  const loginBtn = badge.querySelector('#fecoLoginBtn');
  const close = badge.querySelector('#fecoSyncClose');

  const setLine = (primary, secondary = '') => {
    if (text) text.textContent = primary;
    if (detail) detail.textContent = secondary;
  };

  setLine(`${mode} · waiting`, '');

  close?.addEventListener('click', () => {
    badge.style.display = 'none';
  });

  loginBtn?.addEventListener('click', async () => {
    await fecoEnsureLogin();
  });

  btn?.addEventListener('click', async () => {
    try {
      const m = window.HMP_DB.getMigrationMode();
      if (m === 'DOUBLE_WRITE' || m === 'API_ONLY') {
        const r = await window.HMP_DB.apiPushLocalStorage();
        if (r?.status === 401) {
          await fecoEnsureLogin();
        }
      } else {
        const r = await window.HMP_DB.apiPullLocalStorage();
        if (r?.status === 401) {
          await fecoEnsureLogin();
        }
        // After pull, update in-memory state from new localStorage
        const activeHotel = window.HMP_DB.getActiveHotel();
        if (activeHotel) state.hotel = deepClone(activeHotel);
        updateHotelSelector();
        renderAll?.();
      }
    } catch (e) {
      setLine(`${mode} · error`, String(e?.message || e));
    }
  });

  window.addEventListener('feco:sync', (ev) => {
    const d = ev?.detail || {};
    if (d.kind === 'pull') {
      if (d.state === 'start') return setLine(`${mode} · pulling`, '');
      if (d.state === 'ok') return setLine(`${mode} · pulled`, d.keptLocal ? 'Kept local changes (newer than API)' : '');
      if (d.state === 'fail') return setLine(`${mode} · pull failed`, d.status ? `HTTP ${d.status}` : (d.error || ''));
    }
    if (d.kind === 'push') {
      if (d.state === 'start') return setLine(`${mode} · syncing`, '');
      if (d.state === 'ok') return setLine(`${mode} · synced`, d.summary ? 'Saved to backend' : '');
      if (d.state === 'fail') return setLine(`${mode} · sync failed`, d.status ? `HTTP ${d.status} · ${d.error || ''}` : (d.error || ''));
    }
    if (d.kind === 'auth') {
      if (d.ok) return setLine(`${mode} · logged in`, '');
      return setLine(`${mode} · login failed`, d.error || '');
    }
  });
}

// ===== LOGIN UI (no prompts) =====
function fecoMountLoginModal() {
  if (document.getElementById('fecoLoginModal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'fecoLoginModal';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(15,23,42,0.55)';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '10000';

  overlay.innerHTML = `
    <div style="width:min(520px, 92vw); background:white; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 24px 60px rgba(0,0,0,0.25); padding:18px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div>
          <div style="font-weight:900; font-size:16px; color:#0f172a;">Sign in to sync</div>
          <div style="color:#64748b; font-size:13px; margin-top:4px;">Connect to the backend API to load/save data.</div>
        </div>
        <button id="fecoLoginClose" type="button" style="background:transparent; border:0; font-size:20px; line-height:1; cursor:pointer; color:#64748b;">×</button>
      </div>

      <div style="margin-top:14px; display:grid; gap:10px;">
        <div>
          <div style="font-size:12px; font-weight:800; color:#334155; margin-bottom:6px;">Email</div>
          <input id="fecoLoginEmail" type="email" autocomplete="username" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #cbd5e1; outline:none;" placeholder="you@domain.com"/>
        </div>
        <div>
          <div style="font-size:12px; font-weight:800; color:#334155; margin-bottom:6px;">Password</div>
          <input id="fecoLoginPassword" type="password" autocomplete="current-password" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #cbd5e1; outline:none;" placeholder="••••••••"/>
        </div>
        <div id="fecoLoginError" style="display:none; color:#b91c1c; font-size:12px;"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
          <button id="fecoLoginLogout" type="button" style="background:transparent; border:1px solid #cbd5e1; color:#0f172a; padding:10px 12px; border-radius:12px; font-weight:900; cursor:pointer;">Logout</button>
          <button id="fecoLoginSubmit" type="button" style="background:#0ea5e9; border:0; color:white; padding:10px 12px; border-radius:12px; font-weight:900; cursor:pointer;">Login</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#fecoLoginClose');
  closeBtn?.addEventListener('click', () => (overlay.style.display = 'none'));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  const emailEl = overlay.querySelector('#fecoLoginEmail');
  const pwEl = overlay.querySelector('#fecoLoginPassword');
  const errEl = overlay.querySelector('#fecoLoginError');
  const submit = overlay.querySelector('#fecoLoginSubmit');
  const logout = overlay.querySelector('#fecoLoginLogout');

  logout?.addEventListener('click', async () => {
    try {
      await window.HMP_DB.apiLogout?.();
      if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
      }
    } catch {}
  });

  submit?.addEventListener('click', async () => {
    try {
      const email = (emailEl?.value || '').trim();
      const password = pwEl?.value || '';
      if (!email || !password) {
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = 'Email and password are required.';
        }
        return;
      }
      localStorage.setItem('feco.lastEmail', email);
      submit.disabled = true;
      await window.HMP_DB.apiLogin(email, password);
      overlay.style.display = 'none';
      // Pull right away after login.
      await window.HMP_DB.apiPullLocalStorage?.();
      await fecoRefreshMe();
      const activeHotel = window.HMP_DB.getActiveHotel?.();
      if (activeHotel) state.hotel = deepClone(activeHotel);
      updateHotelSelector?.();
    } catch (e) {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = String(e?.message || e);
      }
    } finally {
      if (submit) submit.disabled = false;
      if (pwEl) pwEl.value = '';
    }
  });
}

async function fecoEnsureLogin() {
  fecoMountLoginModal();
  const overlay = document.getElementById('fecoLoginModal');
  if (!overlay) return;
  const email = localStorage.getItem('feco.lastEmail') || '';
  const emailEl = overlay.querySelector('#fecoLoginEmail');
  if (emailEl && !emailEl.value) emailEl.value = email;
  overlay.style.display = 'flex';
}

function fecoApiBase() {
  const cfg = window.FECO || {};
  return (cfg.API_BASE || localStorage.getItem('feco.apiBase') || 'http://localhost:3001')
    .toString()
    .trim()
    .replace(/\/+$/, '');
}

function fecoRenderEmptyState() {
  const app = document.querySelector('.app-container') || document.body;
  if (!app || !window.HMP_DB?.getHotels) return;

  const mode = window.HMP_DB?.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';
  const hotels = window.HMP_DB.getHotels() || [];
  const token = (localStorage.getItem('feco.accessToken') || '').trim();
  const shouldShow = hotels.length === 0;

  let el = document.getElementById('fecoEmptyState');
  if (!shouldShow) {
    if (el) el.remove();
    return;
  }

  if (el) return;

  el = document.createElement('div');
  el.id = 'fecoEmptyState';
  el.style.cssText = 'margin:14px 18px 0; padding:14px; border:1px solid rgba(8,20,26,.14); background:rgba(255,255,255,.86); border-radius:16px; display:flex; gap:12px; align-items:flex-start;';
  el.innerHTML = `
    <div style="width:36px;height:36px;border-radius:14px;display:grid;place-items:center;background:rgba(11,107,85,.12);border:1px solid rgba(11,107,85,.18);color:#0b6b55;">
      <i class="fa-solid fa-circle-info"></i>
    </div>
    <div style="flex:1;">
      <div style="font-weight:950;letter-spacing:-.01em;">Platform not initialized yet</div>
      <div style="margin-top:6px; color:rgba(8,20,26,.70); font-weight:750; line-height:1.35;">
        ${mode !== 'LOCAL_ONLY'
          ? 'Login to load your hotels from the server, or watch the guided tour.'
          : 'Create a hotel in Setup, or watch the guided tour.'
        }
      </div>
      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn-secondary btn-hotel" id="fecoEmptyLoginBtn" type="button" style="${mode !== 'LOCAL_ONLY' && !token ? '' : 'display:none;'}">
          <i class="fa-solid fa-right-to-bracket"></i> Login
        </button>
        <a class="btn-primary" href="demo_platform.html" style="text-decoration:none;">
          <i class="fa-solid fa-play"></i> Watch the tour
        </a>
      </div>
    </div>
  `;

  const host = document.querySelector('.top-actions') || app;
  host.insertAdjacentElement('afterend', el);
  el.querySelector('#fecoEmptyLoginBtn')?.addEventListener('click', () => fecoEnsureLogin());
}

function fecoRenderAuthBadge(me) {
  let container = document.getElementById('fecoAuthBadge');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fecoAuthBadge';
    container.style.cssText = 'margin-left:auto; display:flex; align-items:center; gap:8px; font-size:12px; opacity:0.92;';
    const host =
      document.querySelector('.top-actions') ||
      document.querySelector('.planning-toolbar') ||
      document.querySelector('.header');

    if (host) {
      host.appendChild(container);
    } else {
      // Fallback: some pages don't have a header/toolbars; keep auth entry point always visible.
      container.style.cssText +=
        '; position:fixed; top:12px; right:12px; z-index:9999; padding:8px 10px; border-radius:12px;' +
        ' background:rgba(255,255,255,.92); border:1px solid rgba(8,20,26,.14); box-shadow:0 10px 30px rgba(0,0,0,.10);';
      document.body.appendChild(container);
    }
  }
  if (!container) return;

  const role = me?.role ? String(me.role) : '';
  const scopeHotelId = me?.hotelScopeId ? String(me.hotelScopeId) : '';
  const mode = window.HMP_DB?.getMigrationMode ? window.HMP_DB.getMigrationMode() : 'LOCAL_ONLY';

  if (!role) {
    if (!mode || mode === 'LOCAL_ONLY') {
      container.innerHTML = `
        <span>Local mode</span>
        <button class="btn-secondary" id="fecoEnableSyncBtn" type="button">Enable sync</button>
        <button class="btn-secondary" id="fecoAuthLoginBtn" type="button">Login</button>
      `;
      container.querySelector('#fecoEnableSyncBtn')?.addEventListener('click', () => {
        try {
          localStorage.setItem('feco.mode', 'DOUBLE_WRITE');
        } catch {}
        window.location.reload();
      });
      container.querySelector('#fecoAuthLoginBtn')?.addEventListener('click', () => {
        try {
          localStorage.setItem('feco.mode', 'DOUBLE_WRITE');
        } catch {}
        fecoEnsureLogin();
      });
      return;
    }
    container.innerHTML = `
      <span>Not logged in</span>
      <button class="btn-secondary" id="fecoAuthLoginBtn" type="button">Login</button>
    `;
    container.querySelector('#fecoAuthLoginBtn')?.addEventListener('click', () => fecoEnsureLogin());
    return;
  }

  let scopeLabel = '';
  if (scopeHotelId && window.HMP_DB?.getHotels) {
    const hotel = window.HMP_DB.getHotel?.(scopeHotelId) || window.HMP_DB.getHotels().find(h => h.id === scopeHotelId);
    scopeLabel = hotel?.name ? ` • ${hotel.name}` : '';
  }
  container.textContent = `Logged in as: ${role}${scopeLabel}`;

  // If scoped, prevent accidental hotel switching from the UI.
  if (scopeHotelId && window.HMP_DB?.setActiveHotelId) {
    try {
      window.HMP_DB.setActiveHotelId(scopeHotelId);
    } catch {}
    const select = document.getElementById('hotelSelect');
    if (select) select.disabled = true;
    document.querySelectorAll('.btn-hotel').forEach((el) => {
      el.style.display = 'none';
    });
  }
}

async function fecoRefreshMe() {
  const token = (localStorage.getItem('feco.accessToken') || '').trim();
  if (!token) return null;
  const apiBase = fecoApiBase();
  try {
    const res = await fetch(`${apiBase}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include'
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const me = body?.user || null;
    window.FECO_ME = me;
    fecoRenderAuthBadge(me);
    return me;
  } catch {
    return null;
  }
}

function initDemoTour() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return;

  const page = window.location.pathname.split('/').pop() || '';

  const overlay = document.createElement('div');
  overlay.className = 'demo-tour-overlay';
  overlay.style.display = 'none';

  const focus = document.createElement('div');
  focus.className = 'demo-tour-focus';
  focus.style.display = 'none';

  const card = document.createElement('div');
  card.className = 'demo-tour-card';
  card.style.display = 'none';
  card.innerHTML = `
    <h4><i class="fas fa-play-circle"></i> <span id="demoTourTitle">Demo</span></h4>
    <p id="demoTourText"></p>
    <div class="demo-tour-actions">
      <button class="btn-secondary" id="demoTourExit" type="button">Exit</button>
      <button class="btn-primary" id="demoTourNext" type="button">Next</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(focus);
  document.body.appendChild(card);

  const titleEl = card.querySelector('#demoTourTitle');
  const textEl = card.querySelector('#demoTourText');
  const nextBtn = card.querySelector('#demoTourNext');
  const exitBtn = card.querySelector('#demoTourExit');

  const stepsByPage = {
    'hotel_dashboard.html': [
      {
        title: 'Welcome',
        text: 'This quick tour shows: 1) request a cleaning, 2) assign tasks to staff.',
        target: '.planning-header'
      },
      {
        title: 'Request cleaning',
        text: 'We’ll open the cleaning wizard and select rooms with one click.',
        target: 'a.btn-primary[href="hotel_reservation.html"]',
        action: () => { window.location.href = 'hotel_reservation.html?demo=1'; }
      }
    ],
    'hotel_reservation.html': [
      {
        title: 'Default surface',
        text: 'Choose Carpet / Tile / Both as a default for this cleaning.',
        target: '#wizardSurfaceDefault',
        action: () => {
          const el = document.getElementById('wizardSurfaceDefault');
          if (el) el.value = 'BOTH';
          el?.dispatchEvent(new Event('change'));
        }
      },
      {
        title: 'Quick select',
        text: 'We select “Due now” rooms automatically.',
        target: '#wizardDueNow',
        action: () => document.getElementById('wizardDueNow')?.click()
      },
      {
        title: 'Per-room override',
        text: 'For one specific room, we switch surface (CT / T / C) and add a note.',
        target: '.room-square .room-surface-btn',
        action: () => {
          const surfaceBtn = document.querySelector('.room-square .room-surface-btn');
          surfaceBtn?.click();
          const noteBtn = document.querySelector('.room-square button[data-note-room-id]');
          noteBtn?.click();
          setTimeout(() => {
            const modal = document.getElementById('wizardNoteModal');
            const text = modal?.querySelector('#wizardNoteText');
            if (text) text.value = 'Demo note: focus on stains near entry.';
            modal?.querySelector('#wizardRoomSurfaceTile')?.click();
            modal?.querySelector('#wizardNoteSave')?.click();
          }, 250);
        }
      },
      {
        title: 'Next',
        text: 'We pick a date/time, then confirm.',
        target: '#wizardNextBtn',
        action: () => {
          document.getElementById('wizardNextBtn')?.click();
          setTimeout(() => {
            const date = new Date();
            date.setDate(date.getDate() + 1);
            const iso = date.toISOString().split('T')[0];
            const dateEl = document.getElementById('wizardDate');
            if (dateEl) dateEl.value = iso;
            const start = document.getElementById('wizardStart');
            if (start) start.value = start.value || '08:00';
            document.getElementById('wizardNextBtn')?.click();
          }, 300);
        }
      },
      {
        title: 'Done',
        text: 'Reservation is created. Next: tasks.',
        target: '#wizardLink',
        action: () => { window.location.href = 'hotel_tasks.html?demo=1'; }
      }
    ],
    'hotel_tasks.html': [
      {
        title: 'Create tasks',
        text: 'We create a task for staff and assign it.',
        target: '#chooseTaskTargetsBtn',
        action: () => document.getElementById('chooseTaskTargetsBtn')?.click()
      },
      {
        title: 'Pick rooms',
        text: 'Select a few rooms/areas, then confirm.',
        target: '#taskTargetList',
        action: () => {
          const list = document.getElementById('taskTargetList');
          const first = list?.querySelector('input[type="checkbox"][data-task-room]') || null;
          const second = list?.querySelectorAll('input[type="checkbox"][data-task-room]')?.[1] || null;
          first && (first.checked = true, first.dispatchEvent(new Event('change')));
          second && (second.checked = true, second.dispatchEvent(new Event('change')));
          document.getElementById('confirmTaskTargetsBtn')?.click();
        }
      },
      {
        title: 'Assign + schedule',
        text: 'Pick a staff member and a date/time, then create the task.',
        target: '#createTaskBtn',
        action: () => {
          const assignee = document.getElementById('taskAssignee');
          if (assignee && assignee.options.length > 1) assignee.selectedIndex = 1;
          const mode = document.getElementById('taskScheduleMode');
          if (mode) mode.value = 'EXACT', mode.dispatchEvent(new Event('change'));
          const date = new Date(); date.setDate(date.getDate() + 2);
          const iso = date.toISOString().split('T')[0];
          const dateEl = document.getElementById('taskDate');
          if (dateEl) dateEl.value = iso;
          const timeEl = document.getElementById('taskTime');
          if (timeEl) timeEl.value = timeEl.value || '10:00';
          const desc = document.getElementById('taskDescription');
          if (desc) desc.value = 'Demo task: check remote batteries.';
          document.getElementById('createTaskBtn')?.click();
        }
      },
      {
        title: 'End',
        text: 'That’s the core workflow. You can exit demo now.',
        target: '#taskList',
        action: () => {}
      }
    ]
  };

  const steps = stepsByPage[page] || [];
  if (!steps.length) return;

  let idx = 0;

  function locateTarget(selector) {
    if (!selector) return null;
    return document.querySelector(selector);
  }

  function positionFor(targetEl) {
    overlay.style.display = 'block';
    card.style.display = 'block';
    focus.style.display = targetEl ? 'block' : 'none';

    if (!targetEl) {
      focus.style.display = 'none';
      card.style.left = '16px';
      card.style.bottom = '16px';
      card.style.top = 'auto';
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const pad = 8;
    focus.style.left = `${Math.max(0, rect.left - pad)}px`;
    focus.style.top = `${Math.max(0, rect.top - pad)}px`;
    focus.style.width = `${Math.min(window.innerWidth, rect.width + pad * 2)}px`;
    focus.style.height = `${Math.min(window.innerHeight, rect.height + pad * 2)}px`;

    const preferredTop = rect.bottom + 12;
    const preferBelow = preferredTop + 180 < window.innerHeight;
    const top = preferBelow ? preferredTop : Math.max(16, rect.top - 12 - 180);
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - card.offsetWidth - 16);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.bottom = 'auto';
  }

  function renderStep() {
    const step = steps[idx];
    if (!step) return;
    if (titleEl) titleEl.textContent = step.title || 'Demo';
    if (textEl) textEl.textContent = step.text || '';
    nextBtn.textContent = idx === steps.length - 1 ? 'Finish' : 'Next';
    const targetEl = locateTarget(step.target);
    positionFor(targetEl);
  }

  function exitDemo() {
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    url.searchParams.delete('tour');
    url.searchParams.delete('step');
    window.location.href = url.toString();
  }

  exitBtn.addEventListener('click', exitDemo);
  nextBtn.addEventListener('click', () => {
    const step = steps[idx];
    step?.action?.();
    if (idx < steps.length - 1) {
      idx += 1;
      setTimeout(renderStep, 250);
    } else {
      exitDemo();
    }
  });

  window.addEventListener('resize', () => setTimeout(renderStep, 0));

  renderStep();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
