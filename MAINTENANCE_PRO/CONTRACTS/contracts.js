// ============================================
// CONTRACTS LOGIC - Hotel Maintenance Pro
// ============================================

// Init
document.addEventListener('DOMContentLoaded', function() {
    loadContractsPage();
    setupEventListeners();
});

function loadContractsPage() {
    renderContractStats();
    renderContractsList();
    renderUpcomingSessions();
    setupNewContractForm();
}

// Stats
function renderContractStats() {
    const statsContainer = document.getElementById('contractStats');
    const contracts = HotelDB.contracts;
    const revenue = HotelDB.methods.calculateRevenue();
    
    const activeContracts = contracts.filter(c => c.status === 'ACTIVE').length;
    const upcomingSessions = contracts.reduce((total, contract) => {
        return total + (contract.schedule?.filter(s => s.status === 'SCHEDULED' || s.status === 'PENDING').length || 0);
    }, 0);
    
    statsContainer.innerHTML = `
        <div class="stat-card">
            <div class="stat-icon primary">
                <i class="fas fa-file-contract"></i>
            </div>
            <div class="stat-content">
                <h3>${activeContracts}</h3>
                <p>Active contracts</p>
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-icon success">
                <i class="fas fa-calendar-alt"></i>
            </div>
            <div class="stat-content">
                <h3>${upcomingSessions}</h3>
                <p>Upcoming sessions</p>
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-icon warning">
                <i class="fas fa-dollar-sign"></i>
            </div>
            <div class="stat-content">
                <h3>$${revenue.monthly.toLocaleString()}</h3>
                <p>Estimated monthly revenue</p>
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-icon info">
                <i class="fas fa-chart-line"></i>
            </div>
            <div class="stat-content">
                <h3>$${revenue.yearly.toLocaleString()}</h3>
                <p>Estimated yearly revenue</p>
            </div>
        </div>
    `;
}

// Contracts list
function renderContractsList() {
    const container = document.getElementById('contractsList');
    const contracts = HotelDB.contracts;
    
    if (contracts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-file-contract" style="font-size: 48px; color: var(--color-gray-400);"></i>
                <h3>No contracts</h3>
                <p>Create your first client contract.</p>
                <button class="btn btn-primary mt-4" onclick="openNewContractModal()">
                    <i class="fas fa-plus-circle"></i> Create a contract
                </button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = contracts.map(contract => `
        <div class="contract-item">
            <div class="contract-info">
                <div class="contract-icon ${contract.surfaceType.toLowerCase()}">
                    <i class="fas fa-${contract.surfaceType === 'CARPET' ? 'couch' : contract.surfaceType === 'TILE' ? 'square' : 'layer-group'}"></i>
                </div>
                <div class="contract-details">
                    <h4>${contract.hotelName}</h4>
                    <p>
                        <i class="fas fa-${contract.surfaceType === 'CARPET' ? 'couch' : contract.surfaceType === 'TILE' ? 'square' : 'layer-group'}"></i>
                        ${contract.surfaceType === 'CARPET' ? 'Carpet' : contract.surfaceType === 'TILE' ? 'Tile' : 'Carpet + Tile'} 
                        • ${contract.roomsPerSession} rooms/session
                        <span class="badge ${contract.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}">
                            ${contract.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </span>
                    </p>
                    <p>
                        <i class="fas fa-dollar-sign"></i>
                        $${contract.pricePerSession}/session • 
                        <i class="fas fa-calendar"></i>
                        ${contract.frequency === 'MONTHLY' ? 'Monthly' : contract.frequency === 'BIMONTHLY' ? 'Every 2 months' : 'Quarterly'}
                    </p>
                </div>
            </div>
            <div class="contract-actions">
                <button class="btn btn-secondary btn-small" onclick="viewContractDetails('${contract.id}')">
                    <i class="fas fa-eye"></i> View
                </button>
                <button class="btn btn-primary btn-small" onclick="planSession('${contract.id}')">
                    <i class="fas fa-calendar-plus"></i> Schedule
                </button>
            </div>
        </div>
    `).join('');
}

// Upcoming sessions
function renderUpcomingSessions() {
    const container = document.getElementById('upcomingSessions');
    const contracts = HotelDB.contracts;
    const now = new Date();
    
    // Get all sessions in the next 30 days
    let upcomingSessions = [];
    
    contracts.forEach(contract => {
        if (contract.status !== 'ACTIVE' || !contract.schedule) return;
        
        contract.schedule.forEach(session => {
            const sessionDate = new Date(session.date);
            const daysDiff = Math.floor((sessionDate - now) / (1000 * 60 * 60 * 24));
            
            if (daysDiff >= 0 && daysDiff <= 30 && (session.status === 'SCHEDULED' || session.status === 'PENDING')) {
                upcomingSessions.push({
                    ...session,
                    contractId: contract.id,
                    hotelName: contract.hotelName,
                    roomsPerSession: contract.roomsPerSession,
                    pricePerSession: contract.pricePerSession,
                    surfaceType: contract.surfaceType,
                    daysUntil: daysDiff
                });
            }
        });
    });
    
    // Sort by date
    upcomingSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (upcomingSessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar" style="font-size: 48px; color: var(--color-gray-400);"></i>
                <h3>No upcoming sessions</h3>
                <p>Schedule sessions from your contracts.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = upcomingSessions.slice(0, 5).map(session => `
        <div class="session-item ${session.status === 'COMPLETED' ? 'completed' : session.status === 'SCHEDULED' ? 'scheduled' : 'pending'}">
            <div>
                <div class="session-date">
                    ${formatDate(session.date)}
                    <span class="badge ${session.daysUntil === 0 ? 'badge-danger' : session.daysUntil <= 7 ? 'badge-warning' : 'badge-info'}">
                        ${session.daysUntil === 0 ? 'Today' : session.daysUntil === 1 ? 'Tomorrow' : `In ${session.daysUntil} days`}
                    </span>
                </div>
                <div class="session-hotel">${session.hotelName}</div>
                <div class="session-details">
                    ${session.roomsPerSession} rooms • $${session.pricePerSession}
                </div>
            </div>
            <button class="btn btn-primary btn-small" onclick="prepareWorkSheet('${session.contractId}', '${session.date}')">
                <i class="fas fa-clipboard-list"></i> Prepare
            </button>
        </div>
    `).join('');
    
    if (upcomingSessions.length > 5) {
        container.innerHTML += `
            <div class="text-center mt-4">
                <button class="btn btn-secondary" onclick="viewAllSessions()">
                    View all sessions (${upcomingSessions.length})
                </button>
            </div>
        `;
    }
}

// New contract form
function setupNewContractForm() {
    // Default date: today
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nextYearStr = nextYear.toISOString().split('T')[0];
    
    document.getElementById('contractStartDate').value = today;
    document.getElementById('contractEndDate').value = nextYearStr;
    
    // Estimated price
    document.getElementById('contractSurfaceType').addEventListener('change', updatePriceEstimation);
    document.getElementById('contractRoomsPerSession').addEventListener('input', updatePriceEstimation);
    
    updatePriceEstimation();
    updateContractPreview();
}

function updatePriceEstimation() {
    const surfaceType = document.getElementById('contractSurfaceType').value;
    const rooms = parseInt(document.getElementById('contractRoomsPerSession').value) || 0;
    
    const referencePrice = HotelDB.pricing.referencePrices[surfaceType] || 45;
    const estimatedPrice = rooms * referencePrice;
    
    const hint = document.getElementById('priceEstimation');
    hint.textContent = `Estimate: $${estimatedPrice} (${rooms} × $${referencePrice}/room)`;
    
    // Update price field with estimate
    document.getElementById('contractPrice').value = estimatedPrice;
    
    updateContractPreview();
}

function updateContractPreview() {
    const preview = document.getElementById('contractPreview');
    
    const hotelName = document.getElementById('contractHotelName').value || '[Hotel name]';
    const surfaceType = document.getElementById('contractSurfaceType').value;
    const rooms = document.getElementById('contractRoomsPerSession').value || '0';
    const frequency = document.getElementById('contractFrequency').value;
    const price = document.getElementById('contractPrice').value || '0';
    
    preview.innerHTML = `
        <h4>📋 Contract preview</h4>
        <div style="margin-top: 1rem; line-height: 1.6;">
            <div><strong>Hotel:</strong> ${hotelName}</div>
            <div><strong>Flooring:</strong> ${surfaceType === 'CARPET' ? 'Carpet' : surfaceType === 'TILE' ? 'Tile' : 'Carpet + Tile'}</div>
            <div><strong>Rooms per session:</strong> ${rooms}</div>
            <div><strong>Frequency:</strong> ${frequency === 'MONTHLY' ? 'Monthly' : frequency === 'BIMONTHLY' ? 'Every 2 months' : 'Quarterly'}</div>
            <div><strong>Price per session:</strong> $${parseInt(price).toLocaleString()}</div>
        </div>
    `;
}

// New contract modal
function openNewContractModal() {
    document.getElementById('newContractModal').style.display = 'flex';
    updateContractPreview();
}

function closeNewContractModal() {
    document.getElementById('newContractModal').style.display = 'none';
}

function saveNewContract() {
    const contract = {
        hotelName: document.getElementById('contractHotelName').value.trim(),
        surfaceType: document.getElementById('contractSurfaceType').value,
        roomsPerSession: parseInt(document.getElementById('contractRoomsPerSession').value),
        frequency: document.getElementById('contractFrequency').value,
        pricePerSession: parseInt(document.getElementById('contractPrice').value),
        startDate: document.getElementById('contractStartDate').value,
        endDate: document.getElementById('contractEndDate').value,
        notes: document.getElementById('contractNotes').value.trim(),
        status: 'ACTIVE'
    };
    
    // Validation
    if (!contract.hotelName) {
        alert('Please enter the hotel name');
        return;
    }
    
    if (contract.roomsPerSession < 1) {
        alert('Invalid room count');
        return;
    }
    
    if (contract.pricePerSession < 1) {
        alert('Invalid price');
        return;
    }
    
    // Save
    HotelDB.methods.addContract(contract);
    
    // Close modal + reload
    closeNewContractModal();
    loadContractsPage();
    
    // Notification
    showNotification(`Contract created for ${contract.hotelName}`, 'success');
}

// Contract details
function viewContractDetails(contractId) {
    const contract = HotelDB.contracts.find(c => c.id === contractId);
    if (!contract) return;
    
    const modal = document.getElementById('contractDetailModal');
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3><i class="fas fa-file-contract"></i> ${contract.hotelName}</h3>
                <button class="btn-close" onclick="closeModal('contractDetailModal')">×</button>
            </div>
            
            <div class="modal-body">
                <div class="contract-detail-grid">
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">Flooring</div>
                        <div class="contract-detail-value">
                            ${contract.surfaceType === 'CARPET' ? 'Carpet' : contract.surfaceType === 'TILE' ? 'Tile' : 'Carpet + Tile'}
                        </div>
                    </div>
                    
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">Rooms/session</div>
                        <div class="contract-detail-value">${contract.roomsPerSession}</div>
                    </div>
                    
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">Frequency</div>
                        <div class="contract-detail-value">
                            ${contract.frequency === 'MONTHLY' ? 'Monthly' : contract.frequency === 'BIMONTHLY' ? 'Every 2 months' : 'Quarterly'}
                        </div>
                    </div>
                    
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">Price/session</div>
                        <div class="contract-detail-value">$${contract.pricePerSession}</div>
                    </div>
                    
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">Start date</div>
                        <div class="contract-detail-value">${formatDate(contract.startDate)}</div>
                    </div>
                    
                    <div class="contract-detail-item">
                        <div class="contract-detail-label">End date</div>
                        <div class="contract-detail-value">${formatDate(contract.endDate)}</div>
                    </div>
                </div>
                
                ${contract.notes ? `
                    <div class="form-group">
                        <label>Notes</label>
                        <div class="preview-card">${contract.notes}</div>
                    </div>
                ` : ''}
                
                <div class="contract-schedule">
                    <h4><i class="fas fa-calendar"></i> Session schedule</h4>
                    ${contract.schedule ? contract.schedule.map(session => `
                        <div class="schedule-item ${session.status.toLowerCase()}">
                            <div>
                                <strong>${formatDate(session.date)}</strong>
                                <div>${session.status === 'COMPLETED' ? 'Completed' : session.status === 'SCHEDULED' ? 'Scheduled' : 'To schedule'}</div>
                            </div>
                            <div>
                                ${session.status === 'PENDING' ? `
                                    <button class="btn btn-primary btn-small" onclick="planSession('${contract.id}', '${session.date}')">
                                        Schedule
                                    </button>
                                ` : session.status === 'SCHEDULED' ? `
                                    <button class="btn btn-success btn-small" onclick="prepareWorkSheet('${contract.id}', '${session.date}')">
                                        Worksheet
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `).join('') : '<p>No sessions scheduled</p>'}
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-danger" onclick="deleteContract('${contract.id}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
                <button class="btn btn-secondary" onclick="closeModal('contractDetailModal')">
                    Close
                </button>
                <button class="btn btn-primary" onclick="planSession('${contract.id}')">
                    <i class="fas fa-calendar-plus"></i> Schedule a session
                </button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function deleteContract(contractId) {
    if (!confirm('Delete this contract? This action cannot be undone.')) return;
    
    const index = HotelDB.contracts.findIndex(c => c.id === contractId);
    if (index !== -1) {
        HotelDB.contracts.splice(index, 1);
        HotelDB.methods.save();
        
        closeModal('contractDetailModal');
        loadContractsPage();
        
        showNotification('Contract deleted', 'success');
    }
}

function planSession(contractId, specificDate = null) {
    // Redirect to planning (to be implemented)
    alert('Session scheduling - To be implemented');
    // window.location.href = `plan-session.html?contract=${contractId}&date=${specificDate}`;
}

function prepareWorkSheet(contractId, sessionDate) {
    // Redirect to worksheet
    alert('Worksheet generation - To be implemented');
    // window.location.href = `work-sheet.html?contract=${contractId}&date=${sessionDate}`;
}

function viewAllSessions() {
    // Redirect to full calendar
    alert('Full calendar view - To be implemented');
    // window.location.href = 'calendar.html';
}

// Utilities
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showNotification(message, type = 'info') {
    // Notification simple
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? 'var(--color-success)' : type === 'error' ? 'var(--color-danger)' : 'var(--color-info)'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--border-radius-md);
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function setupEventListeners() {
    // Auto-update preview
    const formInputs = ['contractHotelName', 'contractRoomsPerSession', 'contractFrequency', 'contractPrice'];
    formInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', updateContractPreview);
        }
    });
}
