// Guided demo / tour (no backend)
// Used from home (index.html) to seed demo data + from app pages (script.js) to show overlays.

(() => {
  const DEMO_KEY = 'hmp.demo.v1';

  function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensureDemoHotel() {
    if (!window.HMP_DB) return null;
    window.HMP_DB.init();

    const data = window.HMP_DB.getData();
    const marker = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null') || {};
    const existingId = marker.hotelId;
    const existingHotel = existingId ? window.HMP_DB.getHotel(existingId) : null;

    if (existingHotel) {
      window.HMP_DB.setActiveHotelId(existingHotel.id);
      return existingHotel.id;
    }

    const hotel = window.HMP_DB.createHotel('Demo Hotel Miami');
    hotel.contact = { name: 'Front Desk', email: 'frontdesk@demo-hotel.com' };

    const makeRoom = (roomNumber, lastCleanedDaysAgo, cleaningFrequencyDays, surface = 'BOTH') => ({
      id: generateId('room'),
      roomNumber: String(roomNumber),
      active: true,
      surface,
      sqft: 420,
      cleaningFrequency: cleaningFrequencyDays,
      lastCleaned: Date.now() - (lastCleanedDaysAgo * 24 * 60 * 60 * 1000)
    });

    const makeSpace = (name, sqft) => ({
      id: generateId('space'),
      name,
      sqft,
      active: true
    });

    const buildings = [
      { name: 'Building A', floors: ['2', '3'] },
      { name: 'Building B', floors: ['1'] }
    ];

    hotel.buildings = buildings.map((b, idx) => ({
      id: generateId('building'),
      name: b.name,
      notes: '',
      floors: b.floors.map((floorNo, floorIdx) => {
        const base = idx * 200 + floorIdx * 100;
        const rooms = [
          makeRoom(base + 201, 210, 180, 'BOTH'),
          makeRoom(base + 203, 40, 180, 'CARPET'),
          makeRoom(base + 204, 190, 180, 'BOTH'),
          makeRoom(base + 209, 170, 180, 'TILE'),
          makeRoom(base + 210, 185, 180, 'BOTH')
        ];
        const spaces = [
          makeSpace('Main Corridor', 1200),
          makeSpace('Elevator Lobby', 600)
        ];
        return {
          id: generateId('floor'),
          nameOrNumber: floorNo,
          rooms,
          spaces
        };
      })
    }));

    window.HMP_DB.saveHotel(hotel);
    window.HMP_DB.setActiveHotelId(hotel.id);

    const staff = [
      { firstName: 'Maria', lastName: 'Lopez', phone: '+1 305-555-0111' },
      { firstName: 'James', lastName: 'Taylor', phone: '+1 305-555-0133' },
      { firstName: 'Anna', lastName: 'Nguyen', phone: '+1 305-555-0166' }
    ];
    staff.forEach(member => {
      window.HMP_DB.addStaff({ hotelId: hotel.id, ...member, notes: 'Demo' });
    });

    localStorage.setItem(DEMO_KEY, JSON.stringify({ hotelId: hotel.id, createdAt: new Date().toISOString() }));
    return hotel.id;
  }

  function startInteractiveDemo() {
    // Interactive demo is deprecated: the default experience is the guided marketing tour.
    window.location.href = 'demo_platform.html';
  }

  function startDemo() {
    // Default demo is now the marketing-first guided tour (non-interactive).
    window.location.href = 'demo_platform.html';
  }

  window.HMP_DEMO = {
    ensureDemoHotel,
    startDemo,
    startInteractiveDemo
  };
})();
