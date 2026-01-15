document.addEventListener('DOMContentLoaded', () => {
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

  // Smooth scroll
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

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Reveal
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

  // Interactive demo (optional)
  const hookDemo = (id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (window.HMP_DEMO?.startDemo) {
        window.HMP_DEMO.startDemo();
        return;
      }
      window.location.href = 'demo_platform.html';
    });
  };
  hookDemo('startInteractiveDemoBtn');
  // heroDemoBtn is now a link to the marketing tour (demo_platform.html).

  // Hero parallax
  const heroVisual = document.querySelector('.hero-visual');
  const floatCards = Array.from(document.querySelectorAll('.float-card'));
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  if (heroVisual && !prefersReduced) {
    let raf = 0;
    let mx = 0;
    let my = 0;

    const onMove = (e) => {
      const rect = heroVisual.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      mx = (x - 0.5) * 18;
      my = (y - 0.5) * 14;

      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        heroVisual.style.transform = `perspective(1000px) rotateY(${mx}deg) rotateX(${-my}deg)`;

        floatCards.forEach((card, i) => {
          const speed = 0.18 + i * 0.08;
          card.style.transform = `translate3d(${mx * speed}px, ${my * speed}px, 40px)`;
        });
      });
    };

    const reset = () => {
      heroVisual.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg)';
      floatCards.forEach((card) => (card.style.transform = 'translate3d(0px,0px,40px)'));
    };

    heroVisual.addEventListener('mousemove', onMove);
    heroVisual.addEventListener('mouseleave', reset);
  }
});
