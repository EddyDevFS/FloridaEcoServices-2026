// ============================================
// NAVIGATION GLOBALE - Hotel Maintenance Pro
// ============================================

class GlobalNavigation {
  constructor() {
    this.userType = this.detectUserType();
    this.basePath = this.computeBasePath();
    this.init();
  }
  
  computeBasePath() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const maintenanceIndex = segments.lastIndexOf('MAINTENANCE_PRO');
    if (maintenanceIndex === -1) return '.';
    const section = segments[maintenanceIndex + 1];
    if (section === 'DASHBOARD' || section === 'CONTRACTS' || section === 'HOTEL') return '..';
    return '.';
  }
  
  detectUserType() {
    // In production, based on login. For MVP:
    const url = window.location.pathname;
    if (url.includes('hotel')) return 'HOTEL';
    return 'PROVIDER'; // You, the service provider
  }
  
  init() {
    this.renderNavigation();
    this.setupEventListeners();
  }
  
  renderNavigation() {
    const base = this.basePath;
    const navHTML = `
      <nav class="global-nav">
        <div class="nav-brand">
          <i class="fas fa-hotel"></i>
          <span>Hotel<span class="brand-accent">Maintenance</span>Pro</span>
        </div>
        
        <div class="nav-links">
          ${this.userType === 'PROVIDER' ? `
            <a href="${base}/DASHBOARD/dashboard-pro.html" class="nav-link">
              <i class="fas fa-chart-line"></i>
              <span>My Business</span>
            </a>
            <a href="${base}/CONTRACTS/contracts.html" class="nav-link">
              <i class="fas fa-file-contract"></i>
              <span>My Contracts</span>
            </a>
            <a href="${base}/config.html" class="nav-link">
              <i class="fas fa-cog"></i>
              <span>Setup</span>
            </a>
          ` : `
            <a href="${base}/dashboard-hotel.html" class="nav-link">
              <i class="fas fa-home"></i>
              <span>My Hotel</span>
            </a>
            <a href="${base}/report-issue.html" class="nav-link">
              <i class="fas fa-plus-circle"></i>
              <span>Report an Issue</span>
            </a>
            <a href="${base}/calendar-hotel.html" class="nav-link">
              <i class="fas fa-calendar"></i>
              <span>Calendar</span>
            </a>
          `}
        </div>
        
        <div class="nav-user">
          <span class="user-badge">
            <i class="fas fa-user"></i>
            ${this.userType === 'PROVIDER' ? 'Provider' : 'Hotel'}
          </span>
        </div>
      </nav>
    `;
    
    // Insert navigation at the top of the body
    document.body.insertAdjacentHTML('afterbegin', navHTML);
  }
  
  setupEventListeners() {
    // Navigation active
    setTimeout(() => {
      const currentPage = window.location.pathname.split('/').pop();
      document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.endsWith(`/${currentPage}`) || href === currentPage) {
          link.classList.add('active');
        }
      });
    }, 100);
  }
}

// Initialisation automatique
document.addEventListener('DOMContentLoaded', () => {
  window.GlobalNav = new GlobalNavigation();
});
