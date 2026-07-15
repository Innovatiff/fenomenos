/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — article-page.js
   Reader público: carga el artículo indicado en ?id= y lo renderiza con el
   renderizador compartido. Solo se muestran artículos publicados.
   ══════════════════════════════════════════════════════════════════════════ */

import { startAnalytics } from "./firebase-init.js";
import {
  fetchArticle,
  fetchPublished,
  switchReaction,
  fetchComments,
  addComment,
  likeComment,
} from "./db.js";
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

    /* reacciones + comentarios + barra lateral + progreso de lectura */
    buildReactionsBar(article, id);
    initComments(id);
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
   Se interactúa solo dentro del artículo. Hay dos instancias sincronizadas:
   la barra al final del contenido (teléfonos) y la caja de la barra lateral
   (computadoras). Un clic activa la reacción (+1) y otro la retira (−1);
   la elección se recuerda en este navegador. Los contadores solo aparecen
   cuando son mayores que cero. */

const rx = {
  id: null,
  storeKey: null,
  counts: {},
  mine: null, // clave de la ÚNICA reacción del visitante (o null)
  widgets: [], // { key, btn, icon, n } de todas las instancias
};

const iconOf = (key) => REACTIONS.find((r) => r.key === key).icon;

function buildReactionsBar(article, id) {
  rx.id = id;
  rx.storeKey = "fdc-react-" + id;
  try {
    const stored = JSON.parse(localStorage.getItem(rx.storeKey) || "{}");
    /* solo UNA reacción por persona; si había varias guardadas (formato
       antiguo), se conserva la primera */
    rx.mine = REACTIONS.map((r) => r.key).find((k) => stored[k]) || null;
  } catch (_) {
    rx.mine = null;
  }
  REACTIONS.forEach(({ key }) => (rx.counts[key] = reactionCount(article, key)));

  /* barra al final del artículo (visible en teléfonos) */
  root.appendChild(reactionsRow("post-reactions"));

  /* caja de la barra lateral (visible en computadoras) */
  const box = document.getElementById("react-box");
  const side = document.getElementById("react-side");
  if (box && side) {
    box.hidden = false;
    side.appendChild(reactionsRow("aside-reacts__row"));
  }
}

function reactionsRow(className) {
  const bar = document.createElement("div");
  bar.className = className;

  REACTIONS.forEach(({ key, icon, label }) => {
    const on = rx.mine === key;
    const btn = document.createElement("button");
    btn.className = "rbtn rbtn--" + key + (on ? " is-on" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);

    const ic = document.createElement("ion-icon");
    ic.setAttribute("name", on ? icon : icon + "-outline");
    btn.appendChild(ic);

    const n = document.createElement("span");
    n.className = "rbtn__n";
    n.textContent = rx.counts[key] > 0 ? formatCount(rx.counts[key]) : "";
    btn.appendChild(n);

    rx.widgets.push({ key, btn, icon: ic, n });
    btn.addEventListener("click", () => toggleReaction(key));
    bar.appendChild(btn);
  });

  return bar;
}

function paintReaction(key, animate) {
  const on = rx.mine === key;
  const iconName = iconOf(key);
  rx.widgets
    .filter((w) => w.key === key)
    .forEach((w) => {
      w.btn.classList.toggle("is-on", on);
      w.icon.setAttribute("name", on ? iconName : iconName + "-outline");
      w.n.textContent = rx.counts[key] > 0 ? formatCount(rx.counts[key]) : "";
      if (animate && on) {
        w.btn.classList.remove("is-popping");
        void w.btn.offsetWidth; // reinicia la animación
        w.btn.classList.add("is-popping");
      }
    });
}

function persistMine() {
  try {
    localStorage.setItem(
      rx.storeKey,
      JSON.stringify(rx.mine ? { [rx.mine]: true } : {})
    );
  } catch (_) {}
}

/* Una sola reacción por persona: hacer clic en otra la CAMBIA (resta la
   anterior, suma la nueva); hacer clic en la activa la retira. */
async function toggleReaction(key) {
  const prev = rx.mine;
  const removing = prev === key;
  const addKey = removing ? null : key;
  const removeKey = prev;

  /* actualización optimista en TODAS las instancias */
  rx.mine = addKey;
  if (removeKey) rx.counts[removeKey] = Math.max(0, rx.counts[removeKey] - 1);
  if (addKey) rx.counts[addKey] = (rx.counts[addKey] || 0) + 1;
  if (removeKey) paintReaction(removeKey, false);
  if (addKey) paintReaction(addKey, true);
  persistMine();

  try {
    await switchReaction(rx.id, addKey, removeKey);
  } catch (err) {
    /* revertir si el servidor lo rechaza */
    console.error("Reacción no guardada:", err);
    rx.mine = prev;
    if (removeKey) rx.counts[removeKey] += 1;
    if (addKey) rx.counts[addKey] = Math.max(0, rx.counts[addKey] - 1);
    if (removeKey) paintReaction(removeKey, false);
    if (addKey) paintReaction(addKey, false);
    persistMine();
  }
}

/* ══════════════════════════ COMENTARIOS ══════════════════════════════
   Cualquiera comenta desde el portal; el comentario queda EN REVISIÓN
   hasta que el Estudio lo aprueba. Se muestran los 3 hilos con más
   «me gusta» (el comentario propio aprobado va primero para su autor)
   y «Mostrar más» revela el resto. Máximo dos niveles de respuestas. */

const OWN_KEY = "fdc-own-comments"; // { articleId: [{id, ts}] }
const CLIKE_KEY = "fdc-comment-likes"; // { commentId: true }
const PENDING_TTL = 3 * 24 * 60 * 60 * 1000; // placeholder «en revisión»: 3 días
const INITIAL_MAINS = 3;
const MORE_STEP = 5;

let cArticleId = null;
let cMains = []; // hilos principales ordenados
let cByParent = new Map(); // parentId -> respuestas
let cShown = INITIAL_MAINS;
let cReplyTo = null; // comentario al que se responde (o null)

const readStore = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch (_) {
    return {};
  }
};
const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
};

const ownEntries = () => (readStore(OWN_KEY)[cArticleId] || []);
const ownIds = () => new Set(ownEntries().map((e) => e.id));

async function initComments(articleId) {
  cArticleId = articleId;
  document.getElementById("comments").hidden = false;

  document.getElementById("btn-comment").addEventListener("click", () => openCModal(null));
  document
    .querySelectorAll("[data-cmodal-close]")
    .forEach((el) => el.addEventListener("click", closeCModal));
  document.getElementById("cmodal-form").addEventListener("submit", submitComment);
  document.getElementById("c-anon").addEventListener("change", () => {
    const anon = document.getElementById("c-anon").checked;
    const name = document.getElementById("c-name");
    name.disabled = anon;
    if (anon) name.value = "";
  });
  document.getElementById("comments-more").addEventListener("click", () => {
    cShown += MORE_STEP;
    renderComments();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("cmodal").hidden) closeCModal();
  });

  await refreshComments();
}

async function refreshComments() {
  let items = [];
  try {
    items = await fetchComments(cArticleId);
  } catch (err) {
    console.error("No se pudieron cargar los comentarios:", err);
  }

  const own = ownIds();
  cByParent = new Map();
  items.forEach((c) => {
    if (c.parentId) {
      if (!cByParent.has(c.parentId)) cByParent.set(c.parentId, []);
      cByParent.get(c.parentId).push(c);
    }
  });
  cByParent.forEach((list) =>
    list.sort((a, b) => (tsOf(a.createdAt) || 0) - (tsOf(b.createdAt) || 0))
  );

  cMains = items
    .filter((c) => !c.parentId)
    .sort((a, b) => {
      /* prioridad: mi comentario primero, luego los más gustados */
      const mineA = own.has(a.id) ? 1 : 0;
      const mineB = own.has(b.id) ? 1 : 0;
      if (mineA !== mineB) return mineB - mineA;
      const likesA = a.likes || 0;
      const likesB = b.likes || 0;
      if (likesA !== likesB) return likesB - likesA;
      return (tsOf(b.createdAt) || 0) - (tsOf(a.createdAt) || 0);
    });

  /* limpia del almacenamiento local los propios ya aprobados/expirados */
  const approvedIds = new Set(items.map((c) => c.id));
  const store = readStore(OWN_KEY);
  const now = Date.now();
  store[cArticleId] = (store[cArticleId] || []).filter(
    (e) => approvedIds.has(e.id) || now - e.ts < PENDING_TTL
  );
  writeStore(OWN_KEY, store);

  const total = items.length;
  document.getElementById("comments-count").textContent = total
    ? "(" + total + ")"
    : "";

  renderComments();
}

function tsOf(v) {
  if (!v) return 0;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

function renderComments() {
  const list = document.getElementById("comments-list");
  const empty = document.getElementById("comments-empty");
  const more = document.getElementById("comments-more");
  const ownBox = document.getElementById("own-pending");

  /* placeholders «en revisión» del propio visitante */
  ownBox.textContent = "";
  const approvedIds = new Set([...cMains, ...[...cByParent.values()].flat()].map((c) => c.id));
  ownEntries()
    .filter((e) => !approvedIds.has(e.id))
    .forEach((e) => ownBox.appendChild(pendingCard(e)));

  list.textContent = "";
  cMains.slice(0, cShown).forEach((c) => {
    list.appendChild(commentCard(c));
    (cByParent.get(c.id) || []).forEach((r1) => {
      list.appendChild(commentCard(r1));
      (cByParent.get(r1.id) || []).forEach((r2) => list.appendChild(commentCard(r2)));
    });
  });

  empty.hidden = cMains.length > 0 || ownBox.childElementCount > 0;
  more.hidden = cMains.length <= cShown;
}

function initialOf(name) {
  const c = String(name || "A").trim().charAt(0);
  return c ? c.toUpperCase() : "A";
}

function relativeDate(v) {
  const t = tsOf(v);
  if (!t) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return "hace " + mins + " min";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "hace " + hours + " h";
  const days = Math.floor(hours / 24);
  if (days < 30) return "hace " + days + " d";
  return formatDate(v);
}

function pendingCard(entry) {
  const card = document.createElement("div");
  card.className = "comment comment--pending";
  const body = document.createElement("div");
  body.className = "comment__body";
  const head = document.createElement("div");
  head.className = "comment__head";
  const name = document.createElement("strong");
  name.className = "comment__name";
  name.textContent = entry.name || "Tú";
  head.appendChild(name);
  const badge = document.createElement("span");
  badge.className = "comment__review";
  badge.textContent = "En revisión";
  head.appendChild(badge);
  body.appendChild(head);
  const text = document.createElement("p");
  text.className = "comment__text";
  text.textContent = entry.text || "";
  body.appendChild(text);
  card.appendChild(avatarOf(entry.name));
  card.appendChild(body);
  return card;
}

function avatarOf(name) {
  const av = document.createElement("span");
  av.className = "comment__avatar";
  av.textContent = initialOf(name);
  return av;
}

function commentCard(c) {
  const depth = Math.min(c.depth || 0, 2);
  const card = document.createElement("div");
  card.className = "comment" + (depth ? " comment--r" + depth : "");
  card.dataset.id = c.id;

  card.appendChild(avatarOf(c.name));

  const body = document.createElement("div");
  body.className = "comment__body";

  const head = document.createElement("div");
  head.className = "comment__head";
  const name = document.createElement("strong");
  name.className = "comment__name";
  name.textContent = c.name || "Anónimo";
  head.appendChild(name);
  if (ownIds().has(c.id)) {
    const mine = document.createElement("span");
    mine.className = "comment__mine";
    mine.textContent = "Tu comentario";
    head.appendChild(mine);
  }
  const when = document.createElement("span");
  when.className = "comment__date";
  when.textContent = relativeDate(c.createdAt);
  head.appendChild(when);
  body.appendChild(head);

  const text = document.createElement("p");
  text.className = "comment__text";
  text.textContent = c.text || "";
  body.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "comment__actions";

  const liked = Boolean(readStore(CLIKE_KEY)[c.id]);
  let likes = c.likes || 0;
  const likeBtn = document.createElement("button");
  likeBtn.className = "clike" + (liked ? " is-on" : "");
  likeBtn.title = "Me gusta";
  const likeIcon = document.createElement("ion-icon");
  likeIcon.setAttribute("name", liked ? "thumbs-up" : "thumbs-up-outline");
  likeBtn.appendChild(likeIcon);
  const likeN = document.createElement("span");
  likeN.textContent = likes > 0 ? formatCount(likes) : "";
  likeBtn.appendChild(likeN);
  likeBtn.addEventListener("click", async () => {
    const store = readStore(CLIKE_KEY);
    const turningOn = !store[c.id];
    const delta = turningOn ? 1 : -1;
    likes = Math.max(0, likes + delta);
    if (turningOn) store[c.id] = true;
    else delete store[c.id];
    writeStore(CLIKE_KEY, store);
    likeBtn.classList.toggle("is-on", turningOn);
    likeIcon.setAttribute("name", turningOn ? "thumbs-up" : "thumbs-up-outline");
    likeN.textContent = likes > 0 ? formatCount(likes) : "";
    if (turningOn) {
      likeBtn.classList.remove("is-popping");
      void likeBtn.offsetWidth;
      likeBtn.classList.add("is-popping");
    }
    try {
      await likeComment(c.id, delta);
    } catch (err) {
      console.error("No se pudo guardar el me gusta:", err);
    }
  });
  actions.appendChild(likeBtn);

  if (depth < 2) {
    const reply = document.createElement("button");
    reply.className = "creply";
    const rIcon = document.createElement("ion-icon");
    rIcon.setAttribute("name", "arrow-undo-outline");
    reply.appendChild(rIcon);
    reply.appendChild(document.createTextNode("Responder"));
    reply.addEventListener("click", () => openCModal(c));
    actions.appendChild(reply);
  }

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

/* ── Portal ── */

function openCModal(replyTo) {
  cReplyTo = replyTo;
  const modal = document.getElementById("cmodal");
  document.getElementById("cmodal-form").hidden = false;
  document.getElementById("cmodal-done").hidden = true;
  document.getElementById("cmodal-error").textContent = "";
  document.getElementById("c-text").value = "";
  document.getElementById("cmodal-title").textContent = replyTo
    ? "Responde al comentario"
    : "Escribe un comentario";
  const replying = document.getElementById("cmodal-replying");
  if (replyTo) {
    replying.hidden = false;
    replying.textContent =
      "Respondiendo a " + (replyTo.name || "Anónimo") + ": «" +
      String(replyTo.text || "").slice(0, 90) +
      (String(replyTo.text || "").length > 90 ? "…" : "") + "»";
  } else {
    replying.hidden = true;
  }
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById(document.getElementById("c-anon").checked ? "c-text" : "c-name").focus();
}

function closeCModal() {
  document.getElementById("cmodal").hidden = true;
  document.body.style.overflow = "";
}

async function submitComment(e) {
  e.preventDefault();
  const errorBox = document.getElementById("cmodal-error");
  errorBox.textContent = "";

  const anon = document.getElementById("c-anon").checked;
  const name = anon
    ? "Anónimo"
    : document.getElementById("c-name").value.trim() || "Anónimo";
  const email = document.getElementById("c-email").value.trim();
  const text = document.getElementById("c-text").value.trim();

  if (!text) {
    errorBox.textContent = "Escribe tu comentario antes de publicarlo.";
    document.getElementById("c-text").focus();
    return;
  }

  const submit = document.getElementById("cmodal-submit");
  submit.disabled = true;
  submit.textContent = "Publicando…";
  try {
    const id = await addComment({
      articleId: cArticleId,
      parentId: cReplyTo ? cReplyTo.id : null,
      rootId: cReplyTo ? cReplyTo.rootId || cReplyTo.id : null,
      depth: cReplyTo ? Math.min((cReplyTo.depth || 0) + 1, 2) : 0,
      name,
      email,
      text,
    });

    const store = readStore(OWN_KEY);
    store[cArticleId] = [...(store[cArticleId] || []), { id, name, text, ts: Date.now() }];
    writeStore(OWN_KEY, store);

    document.getElementById("cmodal-form").hidden = true;
    document.getElementById("cmodal-done").hidden = false;
    renderComments(); // muestra el placeholder «En revisión»
  } catch (err) {
    console.error("No se pudo enviar el comentario:", err);
    errorBox.textContent =
      "No se pudo enviar el comentario. Revisa tu conexión e intenta de nuevo.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Publicar";
  }
}
