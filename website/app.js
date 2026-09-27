// Copy buttons + toast
const toast = document.getElementById('toast');
let toastTimer;
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
document.querySelectorAll('[data-copy]').forEach((el) => {
  el.addEventListener('click', async () => {
    const text = el.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied: ${text.slice(0, 48)}${text.length > 48 ? '…' : ''}`);
    } catch {
      showToast(text);
    }
  });
});

// Command tabs
document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    const name = tab.getAttribute('data-tab');
    document.querySelectorAll('.tab-panels [data-panel]').forEach((p) => {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
    if (window.gsap) gsap.fromTo(`[data-panel="${name}"]`, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  });
});

// Typed terminal line
const typed = document.getElementById('typed-line');
const phrases = ['list TODOs in this repo', 'compact this thread', 'review the auth flow'];
let pi = 0, ci = 0, deleting = false;
function tick() {
  if (!typed) return;
  const phrase = phrases[pi % phrases.length];
  ci += deleting ? -1 : 1;
  typed.textContent = phrase.slice(0, ci);
  let delay = deleting ? 30 : 55;
  if (!deleting && ci >= phrase.length) { delay = 1600; deleting = true; }
  else if (deleting && ci <= 0) { deleting = false; pi++; delay = 400; }
  setTimeout(tick, delay);
}
tick();

// FAQ accordion
document.querySelectorAll('.faq-item .faq-q').forEach((btn) => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    if (!item) return;
    const open = item.getAttribute('data-open') === 'true';
    document.querySelectorAll('.faq-item').forEach((el) => {
      el.setAttribute('data-open', 'false');
      el.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
    });
    item.setAttribute('data-open', String(!open));
    btn.setAttribute('aria-expanded', String(!open));
  });
});

// GSAP scroll reveals (video stays fixed fullscreen; content floats over it).
if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
  gsap.utils.toArray('[data-reveal]').forEach((el, i) => {
    gsap.fromTo(el, { opacity: 0, y: 28 }, {
      opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
      delay: (i % 3) * 0.06,
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });
}
