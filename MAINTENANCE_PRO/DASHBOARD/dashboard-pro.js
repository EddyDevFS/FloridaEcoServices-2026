// ============================================
// PROVIDER DASHBOARD - Hotel Maintenance Pro
// ============================================

// Init
document.addEventListener('DOMContentLoaded', function() {
    loadDashboard();
    setupEventListeners();
});

// Load dashboard
function loadDashboard() {
    renderMainStats();
    renderUrgentSessions();
    renderReportedIssues();
    renderUpcomingSessions();
    renderActiveClients();
    renderRevenueChart();
}

// Main stats
function renderMainStats() {
    const container = document.getElementById('mainStats');
    const contracts = HotelDB.contracts;
    const issues = HotelDB.maintenance.issues;
    const revenue = HotelDB.methods.calculateRevenue();
    
    // Sessions in the next 7 days
    const now = new Date();
    const weekFromNow = new Date();
    weekFromNow.setDate(now.getDate() + 7);
    
    const upcomingSessions = contracts.reduce((total, contract) => {
        if (!contract.schedule) return total;
        const sessions = contract.schedule.filter(s => {
            const sessionDate = new Date(s.date);
            return sessionDate >= now && sessionDate <= weekFromNow && 
                   (s.status === 'SCHEDULED' || s.status === 'PENDING');
        });
        return total + sessions.length;
    }, 0);
    
    // Unresolved issues
    const unresolvedIssues = issues.filter(i => i.status !== 'RESOLVED').length;
    
    container.innerHTML = `
        <div class="main-stat-card revenue">
            <div class="main-stat-icon">
                <i class="fas fa-dollar-sign"></i>
            </div>
            <div class="main-stat-value">$${revenue.monthly.toLocaleString()}</div>
            <div class="main-stat-label">Estimated monthly revenue</div>
            <div class="main-stat-change positive">
                <i class="fas fa-arrow-up"></i>
                12% vs last month
            </div>
        </div>
        
        <div class="main-stat-card contracts">
            <div class="main-stat-icon">
                <i class="fas fa-file-contract"></i>
            </div>
            <div class="main-stat-value">${contracts.filter(c => c.status === 'ACTIVE').length}</div>
            <div class="main-stat-label">Active contracts</div>
            <div class="main-stat-change positive">
                <i class="fas fa-plus"></i>
                +2 this month
            </div>
        </div>
        
        <div class="main-stat-card sessions">
            <div class="main-stat-icon">
                <i class="fas fa-calendar-check"></i>
            </div>
            <div class="main-stat-value">${upcomingSessions}</div>
            <div class="main-stat-label">Sessions this week</div>
            <div class="main-stat-change ${upcomingSessions > 5 ? 'positive' : 'negative'}">
                <i class="fas fa-${upcomingSessions > 5 ? 'arrow-up' : 'arrow-down'}"></i>
                ${upcomingSessions > 5 ? 'Busy' : 'Available'}
            </div>
        </div>
        
        <div class="main-stat-card issues">
            <div class="main-stat-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="main-stat-value">${unresolvedIssues}</div>
            <div class="main-stat-label">Open issues</div>
            <div class="main-stat-change ${unresolvedIssues < 5 ? 'positive' : 'negative'}">
                <i class="fas fa-${unresolvedIssues < 5 ? 'arrow-down' : 'arrow-up'}"></i>
                ${unresolvedIssues < 5 ? 'Good' : 'Needs attention'}
            </div>
        </div>
    `;
}

// Urgent sessions (within 48h)
function renderUrgentSessions() {
    const container = document.getElementById('urgentSessions');
    const urgentCount = document.getElementById('urgentCount');
    const contracts = HotelDB.contracts;
    const now = new Date();
    
    let urgentSessions = [];
    let urgentCountValue = 0;
    
    contracts.forEach(contract => {
        if (contract.status !== 'ACTIVE' || !contract.schedule) return;
        
        contract.schedule.forEach(session => {
            const sessionDate = new Date(session.date);
            const hoursDiff = Math.floor((sessionDate - now) / (1000 * 60 * 60));
            
            // Sessions within 48h and not completed
            if (hoursDiff >= 0 && hoursDiff <= 48 && session.status !== 'COMPLETED') {
                urgentSessions.push({
                    ...session,
                    contractId: contract.id,
                    hotelName: contract.hotelName,
                    hoursUntil: hoursDiff,
                    surfaceType: contract.surfaceType
                });
                urgentCountValue++;
            }
        });
    });
    
    urgentCount.textContent = urgentCountValue;
    
    if (urgentSessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 2rem; text-align: center;">
                <i class="fas fa-check-circle" style="font-size: 48px; color: var(--color-success);"></i>
                <h3 style="margin: 1rem 0 0.5rem 0; color: var(--color-gray-700);">No urgent sessions</h3>
                <p style="color: var(--color-gray-500);">All set.</p>
            </div>
        `;
        return;
    }
    
    // Sort by urgency (soonest first)
    urgentSessions.sort((a, b) => a.hoursUntil - b.hoursUntil);
    
    container.innerHTML = urgentSessions.slice(0, 5).map(session => `
        <div class="urgent-session-item">
            <div class="urgent-session-info">
                <h4>${session.hotelName}</h4>
                <div class="urgent-session-details">
                    <span class="badge ${session.hoursUntil < 24 ? 'badge-danger' : 'badge-warning'}">
                        ${session.hoursUntil < 24 ? 'IN 24H' : 'IN 48H'}
                    </span>
                    <span>${formatDate(session.date)}</span>
                    <span>•</span>
                    <span>${session.surfaceType === 'CARPET' ? 'Carpet' : session.surfaceType === 'TILE' ? 'Tile' : 'Carpet + Tile'}</span>
                </div>
            </div>
            <button class="btn btn-danger btn-small" onclick="prepareUrgentSession('${session.contractId}', '${session.date}')">
                <i class="fas fa-play-circle"></i> Prepare
            </button>
        </div>
    `).join('');
}

// Reported issues
function renderReportedIssues() {
    const container = document.getElementById('reportedIssues');
    const issues = HotelDB.maintenance.issues;
    
    // Unresolved issues, sorted by priority
    const unresolvedIssues = issues
        .filter(issue => issue.status !== 'RESOLVED')
        .sort((a, b) => {
            const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    
    if (unresolvedIssues.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 1rem; text-align: center; color: var(--color-gray-500);">
                <i class="fas fa-check-circle"></i>
                No open issues
            </div>
        `;
        return;
    }
    
    container.innerHTML = unresolvedIssues.slice(0, 5).map(issue => {
        const priorityClass = issue.priority === 'URGENT' ? 'urgent' : 
                             issue.priority === 'HIGH' ? 'normal' : 'low';
        
        const typeIcons = {
            LIGHT: '💡',
            STAINS: '🧹',
            LOCK: '🔧',
            PLUMBING: '🚰',
            OTHER: '📝'
        };
        
        return `
            <div class="issue-item ${priorityClass}" onclick="viewIssueDetail('${issue.id}')">
                <div class="issue-info">
                    <h4>${issue.roomNumber} - ${getIssueTypeLabel(issue.type)}</h4>
                    <div class="issue-details">
                        <span>${issue.hotelId || 'Hotel not specified'}</span>
                        <span>•</span>
                        <span>Reported ${formatDateShort(issue.reportedAt)}</span>
                        <span class="badge ${priorityClass === 'urgent' ? 'badge-danger' : priorityClass === 'normal' ? 'badge-warning' : 'badge-success'}">
                            ${issue.priority === 'URGENT' ? 'Urgent' : issue.priority === 'HIGH' ? 'High' : 'Normal'}
                        </span>
                    </div>
                </div>
                <div class="issue-actions">
                    <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); updateIssueStatus('${issue.id}', 'IN_PROGRESS')">
                        <i class="fas fa-play"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Upcoming sessions (next 7 days)
function renderUpcomingSessions() {
    const container = document.getElementById('upcomingSessions');
    const contracts = HotelDB.contracts;
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    
    let upcomingSessions = [];
    
    contracts.forEach(contract => {
        if (contract.status !== 'ACTIVE' || !contract.schedule) return;
        
        contract.schedule.forEach(session => {
            const sessionDate = new Date(session.date);
            if (sessionDate >= now && sessionDate <= nextWeek && 
                (session.status === 'SCHEDULED' || session.status === 'PENDING')) {
                upcomingSessions.push({
                    ...session,
                    contractId: contract.id,
                    hotelName: contract.hotelName,
                    pricePerSession: contract.pricePerSession,
                    roomsPerSession: contract.roomsPerSession,
                    surfaceType: contract.surfaceType,
                    dateObj: sessionDate
                });
            }
        });
    });
    
    // Sort by date
    upcomingSessions.sort((a, b) => a.dateObj - b.dateObj);
    
    if (upcomingSessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 1rem; text-align: center; color: var(--color-gray-500);">
                <i class="fas fa-calendar-plus"></i>
                No sessions scheduled this week
            </div>
        `;
        return;
    }
    
    container.innerHTML = upcomingSessions.slice(0, 4).map(session => {
        const date = session.dateObj;
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        
        return `
            <div class="session-card">
                <div class="session-date">
                    <div class="session-day">${day}</div>
                    <div class="session-month">${month}</div>
                </div>
                <div class="session-content">
                    <h4>${session.hotelName}</h4>
                    <div class="session-details">
                        <span>${session.roomsPerSession} rooms</span>
                        <span>•</span>
                        <span>$${session.pricePerSession}</span>
                        <span>•</span>
                        <span>${session.surfaceType === 'CARPET' ? 'Carpet' : session.surfaceType === 'TILE' ? 'Tile' : 'Carpet + Tile'}</span>
                    </div>
                </div>
                <div class="session-actions">
                    <button class="btn btn-primary btn-small" onclick="prepareWorkSheet('${session.contractId}', '${session.date}')">
                        <i class="fas fa-clipboard-list"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Active clients
function renderActiveClients() {
    const container = document.getElementById('activeClients');
    const countElement = document.getElementById('activeClientsCount');
    const contracts = HotelDB.contracts;
    
    const activeContracts = contracts.filter(c => c.status === 'ACTIVE');
    countElement.textContent = activeContracts.length;
    
    if (activeContracts.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 1rem; text-align: center; color: var(--color-gray-500);">
                <i class="fas fa-user-plus"></i>
                No active clients
            </div>
        `;
        return;
    }
    
    // Sort by revenue (price × frequency)
    const clientsWithRevenue = activeContracts.map(contract => {
        let sessionsPerYear = 0;
        if (contract.frequency === 'MONTHLY') sessionsPerYear = 12;
        else if (contract.frequency === 'BIMONTHLY') sessionsPerYear = 6;
        else if (contract.frequency === 'QUARTERLY') sessionsPerYear = 4;
        
        const yearlyRevenue = contract.pricePerSession * sessionsPerYear;
        
        return {
            ...contract,
            yearlyRevenue,
            initials: contract.hotelName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
        };
    });
    
    // Sort by revenue desc
    clientsWithRevenue.sort((a, b) => b.yearlyRevenue - a.yearlyRevenue);
    
    container.innerHTML = clientsWithRevenue.slice(0, 5).map(client => `
        <div class="client-item">
            <div class="client-avatar">
                ${client.initials}
            </div>
            <div class="client-info">
                <h4>${client.hotelName}</h4>
                <div class="client-details">
                    ${client.roomsPerSession} rooms • 
                    ${client.frequency === 'MONTHLY' ? 'Monthly' : client.frequency === 'BIMONTHLY' ? 'Every 2 months' : 'Quarterly'}
                </div>
            </div>
            <div class="client-revenue">
                $${client.yearlyRevenue.toLocaleString()}
            </div>
        </div>
    `).join('');
}

// Revenue chart
function renderRevenueChart() {
    const ctx = document.getElementById('revenueChartCanvas');
    if (!ctx) return;
    
    // Simulated data for 12 months
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = new Date().getMonth();
    
    // Reorder to start from current month
    const displayedMonths = [];
    const revenueData = [];
    
    for (let i = 11; i >= 0; i--) {
        const monthIndex = (currentMonth - i + 12) % 12;
        displayedMonths.push(months[monthIndex]);
        
        // Simulated data (in production, computed from contracts)
        const baseRevenue = 5000;
        const randomFactor = 0.8 + Math.random() * 0.4;
        revenueData.push(Math.round(baseRevenue * randomFactor));
    }
    
    // Create chart
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayedMonths,
            datasets: [{
                label: 'Monthly revenue ($)',
                data: revenueData,
                borderColor: 'rgb(16, 185, 129)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                pointBackgroundColor: 'rgb(16, 185, 129)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 12,
                    cornerRadius: 6
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Issue details
function viewIssueDetail(issueId) {
    const issue = HotelDB.maintenance.issues.find(i => i.id === issueId);
    if (!issue) return;
    
    const modal = document.getElementById('issueDetailModal');
    modal.innerHTML = `
        <div class="modal" style="max-width: 500px;">
            <div class="modal-header">
                <h3><i class="fas fa-exclamation-circle"></i> Issue #${issue.id.substring(7)}</h3>
                <button class="btn-close" onclick="closeModal('issueDetailModal')">×</button>
            </div>
            
            <div class="modal-body">
                <div class="issue-detail-content">
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Hotel:</div>
                        <div class="issue-detail-value">${issue.hotelId || 'Not specified'}</div>
                    </div>
                    
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Room:</div>
                        <div class="issue-detail-value">${issue.roomNumber || 'Not specified'}</div>
                    </div>
                    
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Type:</div>
                        <div class="issue-detail-value">${getIssueTypeLabel(issue.type)}</div>
                    </div>
                    
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Priority:</div>
                        <div class="issue-detail-value">
                            <span class="badge ${issue.priority === 'URGENT' ? 'badge-danger' : issue.priority === 'HIGH' ? 'badge-warning' : 'badge-info'}">
                                ${issue.priority === 'URGENT' ? 'Urgent' : issue.priority === 'HIGH' ? 'High' : 'Normal'}
                            </span>
                        </div>
                    </div>
                    
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Reported:</div>
                        <div class="issue-detail-value">${formatDateTime(issue.reportedAt)}</div>
                    </div>
                    
                    <div class="issue-detail-row">
                        <div class="issue-detail-label">Status:</div>
                        <div class="issue-detail-value">
                            <span class="badge ${issue.status === 'PENDING' ? 'badge-warning' : issue.status === 'IN_PROGRESS' ? 'badge-info' : 'badge-success'}">
                                ${issue.status === 'PENDING' ? 'Pending' : issue.status === 'IN_PROGRESS' ? 'In progress' : 'Resolved'}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="issue-description">
                    <h4 style="margin-bottom: 0.5rem; color: var(--color-gray-700);">Description:</h4>
                    <p style="color: var(--color-gray-600); line-height: 1.5;">${issue.description || 'No description provided'}</p>
                </div>
                
                <div class="form-group">
                    <label>Update status:</label>
                    <div class="status-selector">
                        <div class="status-option pending ${issue.status === 'PENDING' ? 'selected' : ''}" 
                             onclick="selectStatus('pending', '${issue.id}')">
                            Pending
                        </div>
                        <div class="status-option in-progress ${issue.status === 'IN_PROGRESS' ? 'selected' : ''}" 
                             onclick="selectStatus('in-progress', '${issue.id}')">
                            In progress
                        </div>
                        <div class="status-option resolved ${issue.status === 'RESOLVED' ? 'selected' : ''}" 
                             onclick="selectStatus('resolved', '${issue.id}')">
                            Resolved
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Add a note:</label>
                    <textarea id="issueNote" class="form-textarea" placeholder="Add a note..."></textarea>
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-danger" onclick="deleteIssue('${issue.id}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
                <button class="btn btn-secondary" onclick="closeModal('issueDetailModal')">
                    Cancel
                </button>
                <button class="btn btn-primary" onclick="saveIssueUpdate('${issue.id}')">
                    <i class="fas fa-save"></i> Enregistrer
                </button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
}

function selectStatus(status, issueId) {
    const options = document.querySelectorAll('.status-option');
    options.forEach(opt => opt.classList.remove('selected'));
    
    const selected = document.querySelector(`.status-option.${status}`);
    if (selected) selected.classList.add('selected');
}

function saveIssueUpdate(issueId) {
    const issue = HotelDB.maintenance.issues.find(i => i.id === issueId);
    if (!issue) return;
    
    // Update status
    const selectedOption = document.querySelector('.status-option.selected');
    if (selectedOption) {
        if (selectedOption.classList.contains('pending')) issue.status = 'PENDING';
        else if (selectedOption.classList.contains('in-progress')) issue.status = 'IN_PROGRESS';
        else if (selectedOption.classList.contains('resolved')) {
            issue.status = 'RESOLVED';
            issue.resolvedAt = new Date().toISOString();
        }
    }
    
    // Add note if provided
    const note = document.getElementById('issueNote').value.trim();
    if (note) {
        if (!issue.notes) issue.notes = [];
        issue.notes.push({
            text: note,
            addedAt: new Date().toISOString(),
            addedBy: 'provider'
        });
    }
    
    // Save
    HotelDB.methods.save();
    
    // Reload + close
    loadDashboard();
    closeModal('issueDetailModal');
    
    showNotification('Issue updated', 'success');
}

function deleteIssue(issueId) {
    if (!confirm('Delete this issue?')) return;
    
    const index = HotelDB.maintenance.issues.findIndex(i => i.id === issueId);
    if (index !== -1) {
        HotelDB.maintenance.issues.splice(index, 1);
        HotelDB.methods.save();
        
        closeModal('issueDetailModal');
        loadDashboard();
        
        showNotification('Issue deleted', 'success');
    }
}

function updateIssueStatus(issueId, status) {
    const issue = HotelDB.maintenance.issues.find(i => i.id === issueId);
    if (issue) {
        issue.status = status;
        if (status === 'RESOLVED') {
            issue.resolvedAt = new Date().toISOString();
        }
        HotelDB.methods.save();
        loadDashboard();
        showNotification('Status updated', 'success');
    }
}

// Quick actions
function planSession() {
    if (HotelDB.contracts.length === 0) {
        alert('Create a contract first to schedule a session.');
        location.href = 'contracts.html';
        return;
    }
    
    // Redirect to planning
    alert('Session planning - To be implemented');
    // location.href = 'plan-session.html';
}

function generateInvoice() {
    alert('Invoice generation - To be implemented');
}

function viewReports() {
    alert('Detailed reports - To be implemented');
}

function checkMaintenanceIssues() {
    location.href = 'maintenance.html';
}

function sendReminders() {
    alert('Reminders - To be implemented');
}

function prepareUrgentSession(contractId, date) {
    alert(`Prepare urgent session - Contract: ${contractId}, Date: ${date}`);
    // location.href = `work-sheet.html?contract=${contractId}&date=${date}&urgent=true`;
}

function prepareWorkSheet(contractId, date) {
    alert(`Generate worksheet - Contract: ${contractId}, Date: ${date}`);
    // location.href = `work-sheet.html?contract=${contractId}&date=${date}`;
}

function viewAllIssues() {
    location.href = 'maintenance.html';
}

function viewCalendar() {
    location.href = 'calendar.html';
}

// Utilities
function getIssueTypeLabel(type) {
    const labels = {
        LIGHT: 'Light bulb',
        STAINS: 'Stain / dirt',
        LOCK: 'Lock / door',
        PLUMBING: 'Plumbing',
        OTHER: 'Other'
    };
    return labels[type] || type;
}

function formatDateShort(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short'
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateDashboardPeriod() {
    const period = document.getElementById('periodSelect').value;
    // In an advanced version, we'd filter data by period
    showNotification(`Showing: ${period === 'month' ? 'This month' : period === 'quarter' ? 'This quarter' : 'This year'}`, 'info');
}

function setupEventListeners() {
    // Auto-refresh every 30 seconds
    setInterval(() => {
        // Refresh dynamic data
        renderUrgentSessions();
        renderReportedIssues();
    }, 30000);
}
