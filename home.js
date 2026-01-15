document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const nav = document.getElementById('primaryNav');
  const mobileBtn = document.querySelector('.mobile-menu-btn');

  const setNavOpen = (open) => {
    if (!nav || !mobileBtn) return;
    nav.classList.toggle('is-open', open);
    mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  if (mobileBtn && nav) {
    mobileBtn.addEventListener('click', () => setNavOpen(!nav.classList.contains('is-open')));
    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('is-open')) return;
      if (e.target.closest('.nav-container')) return;
      setNavOpen(false);
    });
  }

  // Smooth scroll for internal anchors
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const target = anchor.getAttribute('href');
      if (!target || target === '#') return;
      const el = document.querySelector(target);
      if (!el) return;
      e.preventDefault();
      setNavOpen(false);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const serviceSelect = document.getElementById('serviceSelect');
  const scrollToContact = () => {
    const contact = document.getElementById('contact');
    if (contact) contact.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const prefillService = (value) => {
    if (serviceSelect && value) {
      const values = Array.from(serviceSelect.options).map((o) => o.value || o.textContent || '');
      const exact = values.find((v) => v === value);
      if (exact) {
        serviceSelect.value = exact;
      } else {
        // Best-effort: match by prefix
        const fallback = values.find((v) => String(v).toLowerCase().includes(String(value).toLowerCase()));
        if (fallback) serviceSelect.value = fallback;
      }
    }
    scrollToContact();
  };

  // Service cards: whole card + internal button
  document.querySelectorAll('[data-prefill]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button') || e.target.closest('input,select,textarea')) return;
      prefillService(el.getAttribute('data-prefill'));
    });
  });
  document.querySelectorAll('.service-card .link-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.service-card');
      prefillService(card?.getAttribute('data-prefill'));
    });
  });
  document.querySelectorAll('button[data-prefill]').forEach((btn) => {
    btn.addEventListener('click', () => prefillService(btn.getAttribute('data-prefill')));
  });

  const quoteForm = document.getElementById('quoteForm');
  if (quoteForm) {
    quoteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(quoteForm);
      const name = String(formData.get('name') || '').trim();
      const phone = String(formData.get('phone') || '').trim();
      const service = String(formData.get('service') || '').trim();
      const location = String(formData.get('location') || '').trim();
      const details = String(formData.get('details') || '').trim();

      const email = 'support@floridaecoservices.com';
      const subject = `Quote request — ${service || 'Cleaning'}`;
      const lines = [
        'Hello Florida Eco Services,',
        '',
        'I would like a quote:',
        `- Name: ${name || '—'}`,
        `- Phone: ${phone || '—'}`,
        `- Service: ${service || '—'}`,
        location ? `- Location: ${location}` : null,
        details ? '' : null,
        details ? details : null,
        '',
        'Thanks!'
      ].filter(Boolean);

      const body = lines.join('\n');
      const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
    });
  }

  // Reveal animations
  const reveals = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }
});
