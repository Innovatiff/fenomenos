/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — script.js
   1. Headline auto-fit    5. Scroll reveals
   2. Hero mesh            6. Alert sign-up form
   3. Header + dropdown    7. Back-to-top
   4. Phone nav dropdown   8. Image fallbacks + year
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const desktop = window.matchMedia("(min-width: 64em)"); // full nav
  const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ─────────────────  1. HEADLINE AUTO-FIT  ─────────────────
     The hero title is meant to run edge to edge, like the original comp.
     Rather than guessing a font size, measure the longest line at a known
     size and scale the whole heading so it fills its column. This holds up
     no matter what the copy is or whether Gugi has finished loading.       */

  const heading = $("#hero-heading");
  const lines = heading ? $$(".hero__heading--line", heading) : [];

  const REF = 100; // measure at 100px…
  const MIN = 24; // …then clamp the result
  const FILL = 0.99; // a hair of breathing room at the edges

  function fitHeading() {
    if (!heading || !lines.length) return;

    const avail = heading.clientWidth;
    if (!avail) return;

    // Also cap by viewport height, so the title never pushes the data strip
    // below the fold on a short laptop.
    const max = Math.min(150, Math.max(56, window.innerHeight * 0.15));

    heading.style.fontSize = REF + "px";
    const widest = Math.max(
      ...lines.map((l) => l.getBoundingClientRect().width)
    );
    if (!widest) return;

    const size = Math.max(MIN, Math.min(max, (REF * avail * FILL) / widest));
    heading.style.fontSize = size + "px";
  }

  fitHeading();
  // Gugi arrives after first paint — refit once the real metrics are known.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitHeading);
  }
  window.addEventListener("load", fitHeading);

  /* ─────────────────  2. HERO MESH  ─────────────────
     Cells are opaque, so the 2px gaps and the semi-transparent "lit" cells
     are what let the moving light streaks bleed through. Building them here
     (instead of hard-coding hundreds of divs) means the mesh fits any screen
     and rebuilds on rotate.                                                */

  const grid = $("#grid");

  function buildGrid() {
    if (!grid) return;

    const cell = desktop.matches ? 70 : 56; // matches the CSS track sizes
    const gap = 2;
    const rect = grid.getBoundingClientRect();
    const cols = Math.ceil(rect.width / (cell + gap));
    const rows = Math.ceil(rect.height / (cell + gap)) + 1;
    const total = Math.min(cols * rows, 800);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const box = document.createElement("div");
      box.className = "background-grid-box";
      if (Math.random() < 0.05) {
        box.classList.add("is-lit");
        box.style.animationDelay = (Math.random() * 6).toFixed(2) + "s";
      }
      frag.appendChild(box);
    }

    grid.replaceChildren(frag);
  }

  buildGrid();

  let lastW = window.innerWidth;
  let resizeTimer;
  window.addEventListener("resize", () => {
    // Ignore the mobile URL bar showing/hiding (height-only changes)
    if (Math.abs(window.innerWidth - lastW) < 40) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      buildGrid();
      fitHeading();
    }, 180);
  });

  /* ─────────────────  3. HEADER + PRODUCTS DROPDOWN  ───────────────── */

  const headerBar = $(".header__container");
  const toTop = $("#to-top");

  function onScroll() {
    const y = window.scrollY;
    headerBar && headerBar.classList.toggle("is-scrolled", y > 24);
    toTop && toTop.classList.toggle("is-visible", y > 700);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const navBox = $(".header__nav--box");
  const trigger = $(".header__nav--products");
  const dropdown = $("#dropdown-datos");
  let closeTimer;

  function openDropdown() {
    clearTimeout(closeTimer);
    dropdown.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeDropdown(delay = 0) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      dropdown.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    }, delay);
  }

  if (navBox && trigger && dropdown) {
    navBox.addEventListener("mouseenter", () => {
      if (desktop.matches) openDropdown();
    });
    navBox.addEventListener("mouseleave", () => {
      if (desktop.matches) closeDropdown(220);
    });

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.classList.contains("hidden") ? openDropdown() : closeDropdown();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dropdown.classList.contains("hidden")) {
        closeDropdown();
        trigger.focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (!navBox.contains(e.target)) closeDropdown();
    });
    dropdown.addEventListener("focusout", (e) => {
      if (!navBox.contains(e.relatedTarget)) closeDropdown();
    });
  }

  /* ─────────────────  4. PHONE NAV DROPDOWN  ───────────────── */

  const burger = $("#burger");
  const mobileNav = $("#mobile-nav");

  function openNav() {
    mobileNav.hidden = false;
    document.body.classList.add("is-locked");
    burger.setAttribute("aria-expanded", "true");
    burger.setAttribute("aria-label", "Cerrar menú");
    requestAnimationFrame(() => mobileNav.classList.add("is-open"));
  }

  function closeNav() {
    mobileNav.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Abrir menú");
    setTimeout(
      () => {
        mobileNav.hidden = true;
      },
      calmMotion.matches ? 0 : 300
    );
  }

  if (burger && mobileNav) {
    burger.addEventListener("click", () => {
      burger.getAttribute("aria-expanded") === "true" ? closeNav() : openNav();
    });

    // Close on navigation, on backdrop tap, on Escape, or when we hit desktop
    $$("a[href]", mobileNav).forEach((link) =>
      link.addEventListener("click", closeNav)
    );
    $$("[data-close]", mobileNav).forEach((el) =>
      el.addEventListener("click", closeNav)
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !mobileNav.hidden) closeNav();
    });
    desktop.addEventListener("change", (e) => {
      if (e.matches && !mobileNav.hidden) closeNav();
    });

    // Accordion
    $$(".mobile-nav__toggle", mobileNav).forEach((btn) => {
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
      });
    });
  }

  /* ─────────────────  5. SCROLL REVEALS  ───────────────── */

  const revealables = $$(".reveal");

  if (calmMotion.matches || !("IntersectionObserver" in window)) {
    revealables.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.style.transitionDelay = Math.min(i * 70, 280) + "ms";
          el.classList.add("is-in");
          io.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    revealables.forEach((el) => io.observe(el));
  }

  /* ─────────────────  6. ALERT SIGN-UP  ───────────────── */

  const form = $("#alerts-form");
  const input = $("#email");
  const msg = $("#alerts-msg");

  if (form && input && msg) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

      if (!valid) {
        input.setAttribute("aria-invalid", "true");
        msg.classList.remove("is-ok");
        msg.textContent =
          "Escribe un correo válido, por ejemplo nombre@correo.com";
        input.focus();
        return;
      }

      // TODO: point this at your list provider (Mailchimp, Brevo, Firebase…)
      input.removeAttribute("aria-invalid");
      msg.classList.add("is-ok");
      msg.textContent = "Listo. Te avisaremos ante condiciones peligrosas.";
      form.reset();
    });

    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      msg.textContent = "";
    });
  }

  /* ─────────────────  7. BACK TO TOP  ───────────────── */

  toTop &&
    toTop.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: calmMotion.matches ? "auto" : "smooth",
      });
    });

  /* ─────────────────  8. IMAGE FALLBACKS + YEAR  ───────────────── */

  $$("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => {
      const icon = document.createElement("ion-icon");
      icon.setAttribute("name", img.dataset.fallback);
      img.replaceWith(icon);
    });
  });

  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();
})();
