// ============================================
// HOTEL MAINTENANCE PRO - Central database
// Storage: localStorage (no backend required)
// ============================================

const HotelDB = {
  // VERSION & META
  version: '1.0',
  lastUpdated: new Date().toISOString(),
  
  // 1. EXISTING CONFIGURATION (your current app)
  hotel: {
    id: 'demo-hotel',
    name: 'Demo Hotel',
    buildings: [
      {
        id: 'b1',
        name: 'Main Building',
        floors: [
          {
            id: 'f1',
            nameOrNumber: '1',
            rooms: [
              { id: '101', roomNumber: '101', surface: 'CARPET', lastCleaned: '2024-01-15' },
              { id: '102', roomNumber: '102', surface: 'TILE', lastCleaned: '2024-02-10' }
            ]
          }
        ]
      }
    ]
  },
  
  // 2. CONTRACTS (NEW - your business)
  contracts: [
    {
      id: 'contract-1',
      hotelId: 'grand-paris',
      hotelName: 'Grand Paris Hotel',
      surfaceType: 'CARPET',
      roomsPerSession: 15,
      frequency: 'MONTHLY', // MONTHLY, BIMONTHLY, QUARTERLY
      pricePerSession: 630,
      currency: 'USD',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      status: 'ACTIVE',
      schedule: [
        { date: '2024-03-18', status: 'SCHEDULED' },
        { date: '2024-04-22', status: 'PENDING' }
      ],
      notes: '3-year loyalty contract'
    }
  ],
  
  // 3. MAINTENANCE (NEW - reported issues)
  maintenance: {
    issues: [
      {
        id: 'issue-1',
        contractId: 'contract-1',
        hotelId: 'grand-paris',
        roomId: '205',
        roomNumber: '205',
        type: 'STAINS', // LIGHT, STAINS, LOCK, PLUMBING, OTHER
        description: 'Wine stain near the bed',
        priority: 'SHOW_TO_CLEANER', // SHOW_TO_CLEANER, SCHEDULE, URGENT
        reportedBy: 'hotel',
        reportedAt: '2024-03-15T09:30:00',
        status: 'PENDING', // PENDING, IN_PROGRESS, RESOLVED
        resolvedAt: null
      }
    ],
    
    sessions: [
      {
        id: 'session-1',
        contractId: 'contract-1',
        date: '2024-03-18',
        startTime: '09:00',
        estimatedEndTime: '16:30',
        rooms: ['101', '102', '103', '104', '105'],
        issuesToCheck: ['issue-1'],
        status: 'SCHEDULED', // SCHEDULED, IN_PROGRESS, COMPLETED
        technician: null,
        notes: ''
      }
    ]
  },
  
  // 4. REFERENCE PRICING (for estimates)
  pricing: {
    referencePrices: {
      CARPET: 45,
      TILE: 40,
      BOTH: 65
    },
    
    conditions: {
      minRoomsPerFloor: 3,
      feeIfLess: 35,
      minRoomsPerSession: 10,
      maxRoomsPerSession: 20
    }
  },
  
  // 5. UTILITY METHODS
  methods: {
    // Auto-save
    save() {
      localStorage.setItem('hotel-maintenance-pro', JSON.stringify({
        contracts: this.contracts,
        maintenance: this.maintenance,
        pricing: this.pricing
      }));
      console.log('💾 Data saved');
    },
    
    // Load
    load() {
      const saved = localStorage.getItem('hotel-maintenance-pro');
      if (saved) {
        const data = JSON.parse(saved);
        this.contracts = data.contracts || [];
        this.maintenance = data.maintenance || { issues: [], sessions: [] };
        this.pricing = data.pricing || this.pricing;
      }
    },
    
    // New contract
    addContract(contract) {
      contract.id = 'contract-' + Date.now();
      contract.schedule = this.generateSchedule(contract);
      this.contracts.push(contract);
      this.save();
      return contract.id;
    },
    
    // Generate schedule
    generateSchedule(contract) {
      const schedule = [];
      let date = new Date(contract.startDate);
      
      while (date <= new Date(contract.endDate)) {
        schedule.push({
          date: date.toISOString().split('T')[0],
          status: 'PENDING'
        });
        
        // Next date based on frequency
        if (contract.frequency === 'MONTHLY') {
          date.setMonth(date.getMonth() + 1);
        } else if (contract.frequency === 'BIMONTHLY') {
          date.setMonth(date.getMonth() + 2);
        } else if (contract.frequency === 'QUARTERLY') {
          date.setMonth(date.getMonth() + 3);
        }
      }
      
      return schedule;
    },
    
    // Report issue
    reportIssue(issueData) {
      const issue = {
        id: 'issue-' + Date.now(),
        ...issueData,
        reportedAt: new Date().toISOString(),
        status: 'PENDING'
      };
      
      this.maintenance.issues.push(issue);
      this.save();
      return issue.id;
    },
    
    // Estimated revenue
    calculateRevenue() {
      let monthly = 0;
      let yearly = 0;
      
      this.contracts.forEach(contract => {
        if (contract.status !== 'ACTIVE') return;
        
        let sessionsPerYear = 0;
        if (contract.frequency === 'MONTHLY') sessionsPerYear = 12;
        else if (contract.frequency === 'BIMONTHLY') sessionsPerYear = 6;
        else if (contract.frequency === 'QUARTERLY') sessionsPerYear = 4;
        
        yearly += contract.pricePerSession * sessionsPerYear;
        monthly += contract.pricePerSession * (sessionsPerYear / 12);
      });
      
      return { monthly, yearly };
    }
  }
};

// Initialisation
HotelDB.load();

// Export global
if (typeof window !== 'undefined') {
  window.HotelDB = HotelDB;
}
