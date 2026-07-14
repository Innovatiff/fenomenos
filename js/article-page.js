/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — article-page.js
   Reader público: carga el artículo indicado en ?id= y lo renderiza con el
   renderizador compartido. Solo se muestran artículos publicados.
   ══════════════════════════════════════════════════════════════════════════ */

import { startAnalytics } from "./firebase-init.js";
import { fetchArticle, fetchPublished, reactToArticle } from "./db.js";
import {
  renderArticle,
  formatDate,
  REACTIONS,
  reactionCount,
  formatCount,
} from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

startAnalytics();

const root = document.getElementById("post-root");

function showState(icon, title, text) {
  root.textContent = "";
  const box = document.createElement("div");
  box.className = "post-state";

  const ic = document.createElement("ion-icon");
  ic.setAttribute("name", icon);
  box.appendChild(ic);

  const strong = document.createElement("strong");
  strong.textContent = title;
  box.appendChild(strong);

  if (text) {
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
  }
  root.appendChild(box);
}

(async () => {
  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    showState(
      "help-circle-outline",
      "Artículo no especificado",
      "El enlace no incluye ningún artículo. Vuelve al listado para elegir uno."
    );
    return;
  }

  try {
    const article = await fetchArticle(id);

    if (!article || article.status !== "published") {
      showState(
        "cloud-offline-outline",
        "Artículo no disponible",
        "Este artículo no existe o todavía no ha sido publicado."
      );
      return;
    }

    renderArticle(root, article);

    document.title = article.title + " | Fenómenos del Caribe";
    if (article.excerpt) {
      const meta = document.getElementById("meta-description");
      if (meta) meta.setAttribute("content", article.excerpt);
    }

    /* reacciones + barra lateral + progreso de lectura */
    buildReactionsBar(article, id);
    document.getElementById("post-aside").hidden = false;
    buildToc();
    buildShare(article);
    buildMore(article, id);
    trackProgress();
  } catch (err) {
    console.error("No se pudo cargar el artículo:", err);
    showState(
      "cloud-offline-outline",
      "No pudimos cargar el artículo",
      "Revisa tu conexión e intenta de nuevo."
    );
  }
})();

/* ── Barra lateral ───────────────────────────────────────────────────── */

/* Índice («En este artículo») con resaltado según el scroll */
function buildToc() {
  const headings = [...root.querySelectorAll(".post__heading")];
  if (!headings.length) return;

  const box = document.getElementById("toc-box");
  const list = document.getElementById("toc-list");
  box.hidden = false;

  const links = headings.map((h) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    list.appendChild(li);
    return a;
  });

  const setActive = (id) =>
    links.forEach((a) =>
      a.classList.toggle("is-active", a.getAttribute("href") === "#" + id)
    );
  setActive(headings[0].id);

  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -65% 0px" }
    );
    headings.forEach((h) => spy.observe(h));
  }
}

/* Botones de compartir */
function buildShare(article) {
  const box = document.getElementById("share-box");
  const wrap = document.getElementById("share-buttons");
  box.hidden = false;

  const url = location.href;
  const title = article.title || "Fenómenos del Caribe";

  const links = [
    {
      icon: "logo-whatsapp",
      label: "WhatsApp",
      href: "https://wa.me/?text=" + encodeURIComponent(title + " " + url),
    },
    {
      icon: "logo-facebook",
      label: "Facebook",
      href:
        "https://www.facebook.com/sharer/sharer.php?u=" +
        encodeURIComponent(url),
    },
    {
      icon: "logo-x",
      label: "X",
      href:
        "https://twitter.com/intent/tweet?text=" +
        encodeURIComponent(title) +
        "&url=" +
        encodeURIComponent(url),
    },
  ];

  links.forEach(({ icon, label, href }) => {
    const a = document.createElement("a");
    a.className = "share__btn";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    const ic = document.createElement("ion-icon");
    ic.setAttribute("name", icon);
    a.appendChild(ic);
    a.appendChild(document.createTextNode(label));
    wrap.appendChild(a);
  });

  const copy = document.createElement("button");
  copy.className = "share__btn";
  const copyIcon = document.createElement("ion-icon");
  copyIcon.setAttribute("name", "link-outline");
  copy.appendChild(copyIcon);
  copy.appendChild(document.createTextNode("Copiar enlace"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.classList.add("share__btn--copied");
      copy.lastChild.textContent = "¡Copiado!";
      setTimeout(() => {
        copy.classList.remove("share__btn--copied");
        copy.lastChild.textContent = "Copiar enlace";
      }, 2000);
    } catch (_) {
      prompt("Copia el enlace:", url);
    }
  });
  wrap.appendChild(copy);
}

/* Otros artículos publicados */
async function buildMore(article, currentId) {
  try {
    const others = (await fetchPublished())
      .filter((a) => a.id !== currentId)
      .slice(0, 4);
    if (!others.length) return;

    const box = document.getElementById("more-box");
    const list = document.getElementById("more-list");
    box.hidden = false;

    others.forEach((a) => {
      const item = document.createElement("a");
      item.className = "aside-more__item";
      item.href = "articulo.html?id=" + encodeURIComponent(a.id);

      const title = document.createElement("span");
      title.className = "aside-more__title";
      title.textContent = a.title || "Sin título";
      item.appendChild(title);

      const meta = document.createElement("span");
      meta.className = "aside-more__meta";
      if (a.tag) {
        const tag = document.createElement("b");
        tag.textContent = a.tag;
        meta.appendChild(tag);
        meta.appendChild(document.createTextNode(" · "));
      }
      meta.appendChild(
        document.createTextNode(formatDate(a.publishedAt || a.createdAt))
      );
      item.appendChild(meta);

      list.appendChild(item);
    });
  } catch (_) {
    /* la barra lateral es opcional: sin «más artículos» si falla */
  }
}

/* Barra de progreso de lectura */
function trackProgress() {
  const bar = document.getElementById("read-progress");
  if (!bar) return;

  const update = () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const pct = total > 0 ? Math.min(100, (scrollY / total) * 100) : 0;
    bar.style.width = pct + "%";
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update, { passive: true });
  update();
}


/* ── Reacciones (👍 ❤️ 🔥) ──────────────────────────────────────────────
   Se interactúa solo aquí, dentro del artículo. Un clic activa la
   reacción (+1) y otro la retira (−1); la elección se recuerda en este
   navegador. Los contadores solo aparecen cuando son mayores que cero. */

function buildReactionsBar(article, id) {
  const storeKey = "fdc-react-" + id;
  let mine;
  try {
    mine = JSON.parse(localStorage.getItem(storeKey) || "{}");
  } catch (_) {
    mine = {};
  }
  const counts = {};
  REACTIONS.forEach(({ key }) => (counts[key] = reactionCount(article, key)));

  const bar = document.createElement("div");
  bar.className = "post-reactions";

  REACTIONS.forEach(({ key, icon, label }) => {
    const btn = document.createElement("button");
    btn.className = "rbtn rbtn--" + key + (mine[key] ? " is-on" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);

    const ic = document.createElement("ion-icon");
    ic.setAttribute("name", mine[key] ? icon : icon + "-outline");
    btn.appendChild(ic);

    const n = document.createElement("span");
    n.className = "rbtn__n";
    n.textContent = counts[key] > 0 ? formatCount(counts[key]) : "";
    btn.appendChild(n);

    btn.addEventListener("click", async () => {
      const turningOn = !mine[key];
      const delta = turningOn ? 1 : -1;

      /* actualización optimista + animación */
      mine[key] = turningOn || undefined;
      if (!turningOn) delete mine[key];
      counts[key] = Math.max(0, counts[key] + delta);
      btn.classList.toggle("is-on", turningOn);
      ic.setAttribute("name", turningOn ? icon : icon + "-outline");
      n.textContent = counts[key] > 0 ? formatCount(counts[key]) : "";
      if (turningOn) {
        btn.classList.remove("is-popping");
        void btn.offsetWidth; // reinicia la animación
        btn.classList.add("is-popping");
      }
      try {
        localStorage.setItem(storeKey, JSON.stringify(mine));
      } catch (_) {}

      try {
        await reactToArticle(id, key, delta);
      } catch (err) {
        /* revertir si el servidor lo rechaza */
        console.error("Reacción no guardada:", err);
        counts[key] = Math.max(0, counts[key] - delta);
        if (turningOn) delete mine[key];
        else mine[key] = true;
        btn.classList.toggle("is-on", !turningOn);
        ic.setAttribute("name", !turningOn ? icon : icon + "-outline");
        n.textContent = counts[key] > 0 ? formatCount(counts[key]) : "";
        try {
          localStorage.setItem(storeKey, JSON.stringify(mine));
        } catch (_) {}
      }
    });

    bar.appendChild(btn);
  });

  root.appendChild(bar);
}
