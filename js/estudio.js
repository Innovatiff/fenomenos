/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — estudio.js
   El Estudio de publicación: autenticación con Firebase Auth, creación y
   edición de artículos por secciones (con reordenado arrastrando), portada
   con compresión automática, gestor de etiquetas y vista previa 1:1 con la
   página pública.
   ══════════════════════════════════════════════════════════════════════════ */

import { app } from "./firebase-init.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  renderArticle,
  formatDate,
  toDateValue,
  sanitizeHtml,
  htmlToPlainText,
  HEADING_SIZES,
} from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const DEFAULT_TAGS = [
  "Huracanes",
  "Tiempo severo",
  "Terremotos",
  "Inundaciones",
  "Cambio climático",
  "Pronósticos",
  "Prevención",
  "Educación",
];

const SECTION_META = {
  heading: { label: "Subtítulo", icon: "text-outline" },
  text: { label: "Párrafo", icon: "reader-outline" },
  image: { label: "Imagen", icon: "image-outline" },
  quote: { label: "Cita", icon: "chatbox-ellipses-outline" },
  list: { label: "Lista", icon: "list-outline" },
};

/* Límite práctico de un documento de Firestore (1 MiB) con margen. */
const MAX_DOC_BYTES = 900_000;

/* ── Estado ──────────────────────────────────────────────────────────── */

let tags = [];
let articles = [];
let sections = []; // secciones del artículo abierto en el editor
let editing = null; // {id, status, publishedAt, createdAt} | null (nuevo)
let dirty = false;
let uidSeq = 0;
const uid = () => "s" + Date.now().toString(36) + (uidSeq++).toString(36);

/* ── Helpers de UI ───────────────────────────────────────────────────── */

function toast(message, kind = "ok") {
  const box = document.createElement("div");
  box.className = "toast toast--" + kind;
  const icon = document.createElement("ion-icon");
  icon.setAttribute(
    "name",
    kind === "ok" ? "checkmark-circle-outline" : "alert-circle-outline"
  );
  box.appendChild(icon);
  box.appendChild(document.createTextNode(message));
  $("toasts").appendChild(box);
  setTimeout(() => {
    box.classList.add("is-leaving");
    setTimeout(() => box.remove(), 320);
  }, 3400);
}

let modalAction = null;
function confirmModal(title, text, confirmLabel, onConfirm) {
  $("modal-title").textContent = title;
  $("modal-text").textContent = text;
  $("modal-confirm").textContent = confirmLabel;
  modalAction = onConfirm;
  $("modal").hidden = false;
}
function closeModal() {
  $("modal").hidden = true;
  modalAction = null;
}
$("modal-confirm").addEventListener("click", () => {
  const action = modalAction;
  closeModal();
  action && action();
});
document
  .querySelectorAll("[data-modal-close]")
  .forEach((el) => el.addEventListener("click", closeModal));

function busy(btn, isBusy, busyText) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
  btn.disabled = isBusy;
  if (busyText) btn.textContent = isBusy ? busyText : btn.dataset.label;
}

/* ── Compresión de imágenes (a data URL) ─────────────────────────────── */

function compressImage(file, maxSide = 1400, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // los JPEG no tienen transparencia
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}

function kb(dataUrl) {
  return Math.round((dataUrl.length * 3) / 4 / 1024);
}

/* ── Texto enriquecido ───────────────────────────────────────────────── */

const MARK_COLOR = "rgba(255, 176, 32, 0.32)";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* texto plano heredado → HTML de párrafos */
function textToHtml(text) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length) return "<p><br></p>";
  return blocks
    .map((b) => "<p>" + escapeHtml(b).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

function exec(cmd, value = null) {
  document.execCommand("styleWithCSS", false, cmd === "hiliteColor");
  document.execCommand(cmd, false, value);
}

const ALIGN_ICONS = {
  justifyLeft:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 3.5h12M2 8h8M2 12.5h10"/></svg>',
  justifyCenter:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 3.5h12M4 8h8M3 12.5h10"/></svg>',
  justifyRight:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 3.5h12M6 8h8M4 12.5h10"/></svg>',
};

/* Barra de formato: actúa sobre el texto seleccionado del editable */
function buildRichToolbar(editable) {
  const bar = document.createElement("div");
  bar.className = "rtb";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Formato de texto");

  /* que los clics no roben la selección del editable */
  bar.addEventListener("mousedown", (e) => e.preventDefault());

  const groups = [
    [
      { label: "<b>B</b>", title: "Negrita", run: () => exec("bold") },
      { label: "<i>I</i>", title: "Cursiva", run: () => exec("italic") },
      { label: "<u>U</u>", title: "Subrayado", run: () => exec("underline") },
      {
        label: '<span class="rtb__mark">A</span>',
        title: "Marcador",
        run: () => exec("hiliteColor", MARK_COLOR),
      },
    ],
    [
      { label: ALIGN_ICONS.justifyLeft, title: "Alinear al inicio", run: () => exec("justifyLeft") },
      { label: ALIGN_ICONS.justifyCenter, title: "Centrar", run: () => exec("justifyCenter") },
      { label: ALIGN_ICONS.justifyRight, title: "Alinear al final", run: () => exec("justifyRight") },
    ],
    [
      {
        label: '<span class="rtb__clear">T<small>×</small></span>',
        title: "Quitar formato",
        run: () => exec("removeFormat"),
      },
    ],
  ];

  groups.forEach((group, gi) => {
    if (gi) {
      const sep = document.createElement("span");
      sep.className = "rtb__sep";
      bar.appendChild(sep);
    }
    group.forEach((btn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rtb__btn";
      b.title = btn.title;
      b.innerHTML = btn.label; // etiquetas propias, no datos del artículo
      b.addEventListener("click", () => {
        editable.focus();
        btn.run();
        editable.dispatchEvent(new Event("input", { bubbles: true }));
      });
      bar.appendChild(b);
    });
  });

  return bar;
}

/* comportamiento común de todos los editables: pegado limpio y, en los de
   una sola línea, sin saltos de línea */
function wireEditable(ed) {
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    let clean = html
      ? sanitizeHtml(html)
      : escapeHtml(text).replace(/\n/g, "<br>");
    if (ed.classList.contains("rich-editor--single")) {
      clean = clean.replace(/<br\s*\/?>/gi, " ");
    }
    document.execCommand("insertHTML", false, clean);
  });
  if (ed.classList.contains("rich-editor--single")) {
    ed.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
  }
}

/* editable genérico para las secciones */
function buildEditable({ field, html, placeholder, single = false }) {
  const ed = document.createElement("div");
  ed.className =
    "field__input rich-editor" + (single ? " rich-editor--single" : "");
  ed.contentEditable = "true";
  ed.dataset.field = field;
  ed.dataset.placeholder = placeholder;
  ed.innerHTML = sanitizeHtml(html || "");
  wireEditable(ed);
  return ed;
}

/* editable + barra de formato, envueltos */
function richField(editable) {
  const wrap = document.createElement("div");
  wrap.className = "rich-field";
  wrap.appendChild(buildRichToolbar(editable));
  wrap.appendChild(editable);
  return wrap;
}

/* Los elementos de la lista son los bloques (líneas) del editable */
function listItemsFromEditable(ed) {
  const items = [];
  let buf = "";
  const flush = () => {
    const html = sanitizeHtml(buf);
    if (htmlToPlainText(html).trim()) items.push(html);
    buf = "";
  };
  ed.childNodes.forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === "DIV" || n.tagName === "P")) {
      flush();
      buf = n.innerHTML;
      flush();
    } else if (n.nodeType === Node.ELEMENT_NODE && n.tagName === "BR") {
      flush();
    } else {
      buf += n.nodeType === Node.TEXT_NODE ? escapeHtml(n.nodeValue) : n.outerHTML;
    }
  });
  flush();
  return items;
}

function listEditableContent(section) {
  const items =
    Array.isArray(section.itemsHtml) && section.itemsHtml.length
      ? section.itemsHtml
      : (section.items || []).filter((s) => String(s).trim()).map(escapeHtml);
  return items.map((h) => "<div>" + sanitizeHtml(h) + "</div>").join("");
}

/* ── Autenticación ───────────────────────────────────────────────────── */

onAuthStateChanged(auth, (user) => {
  $("view-boot").hidden = true;
  if (user) {
    $("view-login").hidden = true;
    $("view-app").hidden = false;
    $("studio-user").textContent = user.email || "";
    loadEverything();
  } else {
    $("view-app").hidden = true;
    $("view-login").hidden = false;
  }
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = $("login-error");
  errorBox.textContent = "";
  const submit = $("login-submit");
  busy(submit, true, "Entrando…");
  try {
    await signInWithEmailAndPassword(
      auth,
      $("login-email").value.trim(),
      $("login-password").value
    );
  } catch (err) {
    const code = err && err.code ? String(err.code) : "";
    errorBox.textContent =
      code.includes("invalid-credential") ||
      code.includes("wrong-password") ||
      code.includes("user-not-found")
        ? "Correo o contraseña incorrectos."
        : code.includes("too-many-requests")
          ? "Demasiados intentos. Espera unos minutos e intenta de nuevo."
          : "No se pudo iniciar sesión. Revisa tu conexión.";
  } finally {
    busy(submit, false);
  }
});

$("btn-signout").addEventListener("click", () => signOut(auth));

/* ── Pestañas ────────────────────────────────────────────────────────── */

/* Dos pestañas fijas (Artículos, Etiquetas). La de Editor está oculta y
   solo aparece cuando se abre un artículo (editar o nuevo). */
const tabs = document.querySelectorAll(".seg__btn");
function showPanel(panelId) {
  if (panelId === "panel-editor") $("tab-editor").hidden = false;
  tabs.forEach((t) =>
    t.classList.toggle("is-active", t.dataset.panel === panelId)
  );
  ["panel-list", "panel-editor", "panel-tags"].forEach((id) => {
    $(id).hidden = id !== panelId;
  });
}
tabs.forEach((tab) =>
  tab.addEventListener("click", () => showPanel(tab.dataset.panel))
);

/* ── Carga inicial ───────────────────────────────────────────────────── */

async function loadEverything() {
  await Promise.all([loadTags(), loadArticles()]);
  if (!editing) resetEditor();
}

/* ── Etiquetas ───────────────────────────────────────────────────────── */

async function loadTags() {
  try {
    const snap = await getDoc(doc(db, "meta", "tags"));
    const list = snap.exists() ? snap.data().list : null;
    tags = Array.isArray(list) && list.length ? list : [...DEFAULT_TAGS];
  } catch (_) {
    tags = [...DEFAULT_TAGS];
  }
  renderTags();
  fillTagSelect();
}

async function saveTags() {
  try {
    await setDoc(doc(db, "meta", "tags"), { list: tags });
  } catch (err) {
    console.error(err);
    toast("No se pudieron guardar las etiquetas.", "error");
  }
}

function renderTags() {
  const list = $("tag-list");
  list.textContent = "";
  if (!tags.length) {
    const li = document.createElement("li");
    li.className = "taglist__empty";
    li.textContent = "No hay etiquetas. Añade la primera arriba.";
    list.appendChild(li);
    return;
  }
  tags.forEach((tag) => {
    const li = document.createElement("li");
    li.className = "taglist__item";

    const icon = document.createElement("ion-icon");
    icon.setAttribute("name", "pricetag-outline");
    li.appendChild(icon);
    li.appendChild(document.createTextNode(tag));

    const del = document.createElement("button");
    del.className = "icon-btn icon-btn--danger";
    del.title = "Eliminar etiqueta";
    const delIcon = document.createElement("ion-icon");
    delIcon.setAttribute("name", "trash-outline");
    del.appendChild(delIcon);
    del.addEventListener("click", () => {
      confirmModal(
        "¿Eliminar etiqueta?",
        `«${tag}» dejará de aparecer en el desplegable del editor. Los artículos que ya la usan la conservan.`,
        "Eliminar",
        async () => {
          tags = tags.filter((t) => t !== tag);
          renderTags();
          fillTagSelect();
          await saveTags();
          toast("Etiqueta eliminada.");
        }
      );
    });
    li.appendChild(del);
    list.appendChild(li);
  });
}

$("tag-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("tag-input");
  const value = input.value.trim();
  if (!value) return;
  if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
    toast("Esa etiqueta ya existe.", "error");
    return;
  }
  tags.push(value);
  input.value = "";
  renderTags();
  fillTagSelect();
  await saveTags();
  toast("Etiqueta añadida.");
});

function fillTagSelect() {
  const select = $("f-tag");
  const current = select.value;
  select.textContent = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— Sin etiqueta —";
  select.appendChild(none);

  const options = [...tags];
  if (current && !options.includes(current)) options.unshift(current);
  options.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });
  select.value = options.includes(current) ? current : "";
}

/* ── Listado de artículos ────────────────────────────────────────────── */

async function loadArticles() {
  let docs;
  try {
    const snap = await getDocs(
      query(collection(db, "articles"), orderBy("updatedAt", "desc"))
    );
    docs = snap.docs;
  } catch (_) {
    const snap = await getDocs(collection(db, "articles"));
    docs = snap.docs;
  }
  articles = docs.map((d) => ({ id: d.id, ...d.data() }));
  renderList();
}

function renderList() {
  const list = $("articles-list");
  list.textContent = "";

  const published = articles.filter((a) => a.status === "published").length;
  $("list-summary").textContent = articles.length
    ? `${articles.length} en total · ${published} publicado${published === 1 ? "" : "s"} · ${articles.length - published} en borrador`
    : "";
  $("list-empty").hidden = articles.length > 0;

  articles.forEach((article) => {
    const item = document.createElement("div");
    item.className = "aitem";

    const thumb = document.createElement("span");
    thumb.className = "aitem__thumb";
    if (article.cover) {
      const img = document.createElement("img");
      img.src = article.cover;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      const icon = document.createElement("ion-icon");
      icon.setAttribute("name", "newspaper-outline");
      thumb.appendChild(icon);
    }
    item.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "aitem__body";
    const title = document.createElement("span");
    title.className = "aitem__title";
    title.textContent = article.title || "Sin título";
    body.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "aitem__meta";
    const status = document.createElement("span");
    status.className =
      "badge " +
      (article.status === "published" ? "badge--published" : "badge--draft");
    status.textContent =
      article.status === "published" ? "Publicado" : "Borrador";
    meta.appendChild(status);
    if (article.tag) {
      const tagBadge = document.createElement("span");
      tagBadge.className = "badge badge--tag";
      tagBadge.textContent = article.tag;
      meta.appendChild(tagBadge);
    }
    const when = formatDate(article.updatedAt || article.createdAt);
    if (when) {
      const date = document.createElement("span");
      date.textContent = "Actualizado: " + when;
      meta.appendChild(date);
    }
    body.appendChild(meta);
    item.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "aitem__actions";
    actions.appendChild(
      iconButton("create-outline", "Editar", "", () => openEditor(article))
    );
    actions.appendChild(
      iconButton(
        article.status === "published"
          ? "cloud-offline-outline"
          : "cloud-upload-outline",
        article.status === "published" ? "Pasar a borrador" : "Publicar",
        "icon-btn--go",
        () => togglePublish(article)
      )
    );
    if (article.status === "published") {
      const view = document.createElement("a");
      view.className = "icon-btn";
      view.href = "articulo.html?id=" + encodeURIComponent(article.id);
      view.target = "_blank";
      view.rel = "noopener";
      view.title = "Ver publicado";
      const icon = document.createElement("ion-icon");
      icon.setAttribute("name", "open-outline");
      view.appendChild(icon);
      actions.appendChild(view);
    }
    actions.appendChild(
      iconButton("trash-outline", "Eliminar", "icon-btn--danger", () =>
        confirmModal(
          "¿Eliminar artículo?",
          `«${article.title || "Sin título"}» se eliminará de forma permanente. Esta acción no se puede deshacer.`,
          "Eliminar",
          () => removeArticle(article)
        )
      )
    );
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function iconButton(iconName, title, extraClass, onClick) {
  const btn = document.createElement("button");
  btn.className = ("icon-btn " + (extraClass || "")).trim();
  btn.title = title;
  const icon = document.createElement("ion-icon");
  icon.setAttribute("name", iconName);
  btn.appendChild(icon);
  btn.addEventListener("click", onClick);
  return btn;
}

async function togglePublish(article) {
  const publishing = article.status !== "published";
  try {
    const patch = {
      status: publishing ? "published" : "draft",
      updatedAt: serverTimestamp(),
    };
    if (publishing && !article.publishedAt) patch.publishedAt = serverTimestamp();
    await updateDoc(doc(db, "articles", article.id), patch);
    toast(publishing ? "Artículo publicado." : "Artículo pasado a borrador.");
    await loadArticles();
    if (editing && editing.id === article.id) {
      editing.status = patch.status;
      updateEditorStatus();
    }
  } catch (err) {
    console.error(err);
    toast("No se pudo cambiar el estado.", "error");
  }
}

async function removeArticle(article) {
  try {
    await deleteDoc(doc(db, "articles", article.id));
    toast("Artículo eliminado.");
    if (editing && editing.id === article.id) resetEditor();
    await loadArticles();
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar el artículo.", "error");
  }
}

/* ── Editor: estado y campos base ────────────────────────────────────── */

$("btn-new").addEventListener("click", () => {
  resetEditor();
  showPanel("panel-editor");
});
$("btn-back-list").addEventListener("click", () => showPanel("panel-list"));

function resetEditor() {
  editing = null;
  sections = [];
  dirty = false;
  setRichField("f-title", "");
  setRichField("f-excerpt", "");
  setRichField("f-footer", "");
  $("f-cover-url").value = "";
  setCover("");
  fillTagSelect();
  $("f-tag").value = "";
  $("editor-title").textContent = "Nuevo artículo";
  renderSectionsEditor();
  updateEditorStatus();
}

function openEditor(article) {
  editing = {
    id: article.id,
    status: article.status,
    publishedAt: article.publishedAt || null,
    createdAt: article.createdAt || null,
  };
  sections = (article.sections || []).map((s) => ({ ...s, uid: uid() }));
  dirty = false;
  setRichField("f-title", article.titleHtml, article.title);
  setRichField("f-excerpt", article.excerptHtml, article.excerpt);
  setRichField("f-footer", article.footerHtml, article.footer);
  fillTagSelect();
  $("f-tag").value = article.tag || "";
  if (article.tag && $("f-tag").value !== article.tag) {
    // etiqueta que ya no está en la lista: consérvala como opción
    const opt = document.createElement("option");
    opt.value = article.tag;
    opt.textContent = article.tag;
    $("f-tag").appendChild(opt);
    $("f-tag").value = article.tag;
  }
  const isUrl = article.cover && !String(article.cover).startsWith("data:");
  $("f-cover-url").value = isUrl ? article.cover : "";
  setCover(article.cover || "");
  $("editor-title").textContent = "Editar artículo";
  renderSectionsEditor();
  updateEditorStatus();
  showPanel("panel-editor");
}

/* Caja de revisión: vista previa en vivo junto al formulario */
let liveTimer;
function updateLivePreview() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    renderArticle($("live-root"), {
      ...collectArticle(),
      publishedAt: (editing && toDateValue(editing.publishedAt)) || new Date(),
    });
  }, 250);
}

function updateEditorStatus() {
  updateLivePreview();
  const el = $("editor-status");
  if (!editing) {
    el.textContent = "Borrador sin guardar";
  } else if (editing.status === "published") {
    el.textContent = dirty
      ? "Publicado · hay cambios sin guardar"
      : "Publicado";
  } else {
    el.textContent = dirty ? "Borrador · hay cambios sin guardar" : "Borrador";
  }
  $("btn-publish").innerHTML = "";
  const icon = document.createElement("ion-icon");
  icon.setAttribute("name", "cloud-upload-outline");
  $("btn-publish").appendChild(icon);
  $("btn-publish").appendChild(
    document.createTextNode(
      editing && editing.status === "published"
        ? " Guardar y publicar"
        : " Publicar"
    )
  );
}

["f-title", "f-excerpt", "f-footer", "f-tag", "f-cover-url"].forEach((id) => {
  $(id).addEventListener("input", () => {
    dirty = true;
    updateEditorStatus();
  });
});

/* Campos enriquecidos fijos (título, resumen, pie): barra de formato +
   comportamiento de editable */
["f-title", "f-excerpt", "f-footer"].forEach((id) => {
  const ed = $(id);
  wireEditable(ed);
  ed.parentElement.insertBefore(buildRichToolbar(ed), ed);
});

function setRichField(id, html, plainFallback) {
  let content = "";
  if (html != null) content = html;
  else if (plainFallback)
    content = $(id).classList.contains("rich-editor--single")
      ? escapeHtml(plainFallback)
      : textToHtml(plainFallback);
  $(id).innerHTML = sanitizeHtml(content);
}
function richFieldValue(id) {
  const html = sanitizeHtml($(id).innerHTML);
  return { html, plain: htmlToPlainText(html).trim() };
}

/* Portada */

let coverData = ""; // vacío | URL | data URL

function setCover(value) {
  coverData = value || "";
  const hasImage = Boolean(coverData);
  $("cover-preview").hidden = !hasImage;
  $("cover-img").src = hasImage ? coverData : "";
  $("cover-hint").textContent = coverData.startsWith("data:")
    ? `Imagen guardada dentro del artículo (${kb(coverData)} KB, comprimida).`
    : "Las imágenes subidas se comprimen automáticamente.";
}

$("f-cover-url").addEventListener("change", () => {
  const url = $("f-cover-url").value.trim();
  if (url) setCover(url);
});

$("f-cover-file").addEventListener("change", async () => {
  const file = $("f-cover-file").files[0];
  if (!file) return;
  try {
    const dataUrl = await compressImage(file);
    $("f-cover-url").value = "";
    setCover(dataUrl);
    dirty = true;
    updateEditorStatus();
  } catch (_) {
    toast("No se pudo procesar la imagen.", "error");
  }
  $("f-cover-file").value = "";
});

$("cover-remove").addEventListener("click", () => {
  $("f-cover-url").value = "";
  setCover("");
  dirty = true;
  updateEditorStatus();
});

/* ── Editor: constructor de secciones ────────────────────────────────── */

const sectionsList = $("sections-list");

$("section-adders").addEventListener("click", (e) => {
  const btn = e.target.closest(".adder");
  if (!btn) return;
  const type = btn.dataset.type;
  const base = { uid: uid(), type };
  if (type === "heading") Object.assign(base, { text: "", size: "md" });
  if (type === "text") base.html = "";
  if (type === "quote") Object.assign(base, { text: "", cite: "" });
  if (type === "image") Object.assign(base, { src: "", caption: "" });
  if (type === "list") base.items = [];
  sections.push(base);
  dirty = true;
  renderSectionsEditor();
  updateEditorStatus();
  const card = sectionsList.querySelector(`[data-uid="${base.uid}"]`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = card.querySelector("input, textarea");
    input && input.focus();
  }
});

function fieldBlock(labelText, control) {
  const label = document.createElement("label");
  label.className = "field";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = labelText;
  label.appendChild(span);
  label.appendChild(control);
  return label;
}

function makeInput(section, field, placeholder, tag = "input", rows = 3) {
  const input = document.createElement(tag);
  input.className = "field__input";
  if (tag === "textarea") input.rows = rows;
  input.placeholder = placeholder;
  input.dataset.field = field;
  input.value =
    field === "items" ? (section.items || []).join("\n") : section[field] || "";
  return input;
}

function buildSectionCard(section, index) {
  const meta = SECTION_META[section.type] || { label: section.type, icon: "cube-outline" };
  const card = document.createElement("div");
  card.className = "scard";
  card.dataset.uid = section.uid;

  /* barra superior */
  const bar = document.createElement("div");
  bar.className = "scard__bar";

  const handle = document.createElement("span");
  handle.className = "scard__handle";
  handle.title = "Arrastra para reordenar";
  const handleIcon = document.createElement("ion-icon");
  handleIcon.setAttribute("name", "reorder-three-outline");
  handle.appendChild(handleIcon);
  bar.appendChild(handle);

  const type = document.createElement("span");
  type.className = "scard__type";
  const typeIcon = document.createElement("ion-icon");
  typeIcon.setAttribute("name", meta.icon);
  type.appendChild(typeIcon);
  type.appendChild(document.createTextNode(meta.label));
  bar.appendChild(type);

  const tools = document.createElement("div");
  tools.className = "scard__tools";
  tools.appendChild(
    iconButton("chevron-up-outline", "Subir", "", () => moveSection(index, -1))
  );
  tools.appendChild(
    iconButton("chevron-down-outline", "Bajar", "", () => moveSection(index, 1))
  );
  tools.appendChild(
    iconButton("trash-outline", "Eliminar sección", "icon-btn--danger", () => {
      sections = sections.filter((s) => s.uid !== section.uid);
      dirty = true;
      renderSectionsEditor();
      updateEditorStatus();
    })
  );
  bar.appendChild(tools);
  card.appendChild(bar);

  /* cuerpo según el tipo */
  const body = document.createElement("div");
  body.className = "scard__body";

  if (section.type === "heading") {
    const row = document.createElement("div");
    row.className = "scard__row";

    const editable = buildEditable({
      field: "html",
      html: section.html != null ? section.html : escapeHtml(section.text || ""),
      placeholder: "Ej.: ¿Qué hacer durante el evento?",
      single: true,
    });
    row.appendChild(fieldBlock("Texto del subtítulo", richField(editable)));

    const sizeWrap = document.createElement("div");
    sizeWrap.className = "field__select-wrap";
    const sizeSelect = document.createElement("select");
    sizeSelect.className = "field__input";
    sizeSelect.dataset.field = "size";
    HEADING_SIZES.forEach(({ key, label }) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label;
      sizeSelect.appendChild(opt);
    });
    sizeSelect.value = section.size || "md";
    sizeWrap.appendChild(sizeSelect);
    const chevron = document.createElement("ion-icon");
    chevron.setAttribute("name", "chevron-down-outline");
    sizeWrap.appendChild(chevron);
    row.appendChild(fieldBlock("Tamaño", sizeWrap));

    body.appendChild(row);
  }

  if (section.type === "text") {
    const editable = buildEditable({
      field: "html",
      html: section.html != null ? section.html : textToHtml(section.text),
      placeholder: "Escribe el contenido…",
    });
    body.appendChild(
      fieldBlock("Texto — selecciona y aplica formato", richField(editable))
    );
  }

  if (section.type === "quote") {
    const editable = buildEditable({
      field: "html",
      html: section.html != null ? section.html : textToHtml(section.text),
      placeholder: "Texto de la cita…",
    });
    body.appendChild(fieldBlock("Cita", richField(editable)));
    body.appendChild(
      fieldBlock("Autor o fuente (opcional)", makeInput(section, "cite", "Ej.: Centro Nacional de Huracanes"))
    );
  }

  if (section.type === "list") {
    const editable = buildEditable({
      field: "itemsHtml",
      html: listEditableContent(section),
      placeholder: "Un elemento por línea…",
    });
    body.appendChild(
      fieldBlock("Elementos de la lista (uno por línea)", richField(editable))
    );
  }

  if (section.type === "image") {
    if (section.src) {
      const preview = document.createElement("div");
      preview.className = "scard__img-preview";
      const img = document.createElement("img");
      img.src = section.src;
      img.alt = "";
      preview.appendChild(img);
      body.appendChild(preview);
    }

    const controls = document.createElement("div");
    controls.className = "scard__img-controls";
    const urlInput = makeInput(
      section,
      "src",
      "Pega la URL de una imagen…"
    );
    urlInput.type = "url";
    if (section.src && section.src.startsWith("data:")) urlInput.value = "";
    controls.appendChild(urlInput);

    const or = document.createElement("span");
    or.className = "cover__or";
    or.textContent = "o";
    controls.appendChild(or);

    const uploadLabel = document.createElement("label");
    uploadLabel.className = "btn btn--ghost btn--sm cover__upload";
    const upIcon = document.createElement("ion-icon");
    upIcon.setAttribute("name", "cloud-upload-outline");
    uploadLabel.appendChild(upIcon);
    uploadLabel.appendChild(document.createTextNode(" Subir imagen"));
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        section.src = await compressImage(file, 1200, 0.75);
        dirty = true;
        renderSectionsEditor();
        updateEditorStatus();
      } catch (_) {
        toast("No se pudo procesar la imagen.", "error");
      }
    });
    uploadLabel.appendChild(fileInput);
    controls.appendChild(uploadLabel);
    body.appendChild(controls);

    const captionEditable = buildEditable({
      field: "captionHtml",
      html:
        section.captionHtml != null
          ? section.captionHtml
          : escapeHtml(section.caption || ""),
      placeholder: "Descripción breve de la imagen",
      single: true,
    });
    body.appendChild(
      fieldBlock("Pie de imagen (opcional)", richField(captionEditable))
    );
  }

  card.appendChild(body);

  /* arrastre: solo se activa desde el asa */
  handle.addEventListener("pointerdown", () => {
    card.draggable = true;
  });
  card.addEventListener("dragstart", (e) => {
    if (!card.draggable) {
      e.preventDefault();
      return;
    }
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", section.uid);
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    card.draggable = false;
    syncOrderFromDom();
  });

  return card;
}

function renderSectionsEditor() {
  sectionsList.textContent = "";
  sections.forEach((section, index) =>
    sectionsList.appendChild(buildSectionCard(section, index))
  );
}

function moveSection(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= sections.length) return;
  const [moved] = sections.splice(index, 1);
  sections.splice(target, 0, moved);
  dirty = true;
  renderSectionsEditor();
  updateEditorStatus();
}

/* reordenado visual mientras se arrastra */
sectionsList.addEventListener("dragover", (e) => {
  e.preventDefault();
  const dragging = sectionsList.querySelector(".is-dragging");
  if (!dragging) return;
  const after = getDragAfterElement(e.clientY);
  if (after == null) sectionsList.appendChild(dragging);
  else sectionsList.insertBefore(dragging, after);
});
sectionsList.addEventListener("drop", (e) => e.preventDefault());

function getDragAfterElement(y) {
  const cards = [...sectionsList.querySelectorAll(".scard:not(.is-dragging)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: card };
    }
  }
  return closest.element;
}

function syncOrderFromDom() {
  const order = [...sectionsList.querySelectorAll(".scard")].map(
    (card) => card.dataset.uid
  );
  sections.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
  dirty = true;
  renderSectionsEditor(); // re-sincroniza los índices de los botones ↑/↓
  updateEditorStatus();
}

/* cambios en los campos de las secciones (delegado) */
sectionsList.addEventListener("input", (e) => {
  const fieldEl = e.target.closest("[data-field]");
  const card = e.target.closest(".scard");
  if (!card || !fieldEl) return;
  const field = fieldEl.dataset.field;
  const section = sections.find((s) => s.uid === card.dataset.uid);
  if (!section) return;

  if (field === "html") {
    section.html = sanitizeHtml(fieldEl.innerHTML);
    if (section.type !== "text") {
      section.text = htmlToPlainText(section.html).trim();
    }
  } else if (field === "itemsHtml") {
    section.itemsHtml = listItemsFromEditable(fieldEl);
    section.items = section.itemsHtml.map((h) => htmlToPlainText(h).trim());
  } else if (field === "captionHtml") {
    section.captionHtml = sanitizeHtml(fieldEl.innerHTML);
    section.caption = htmlToPlainText(section.captionHtml).trim();
  } else if (field === "items") {
    section.items = fieldEl.value.split("\n");
  } else {
    section[field] = fieldEl.value;
    if (field === "src") {
      const img = card.querySelector(".scard__img-preview img");
      if (img) img.src = fieldEl.value;
    }
  }
  dirty = true;
  updateEditorStatus();
});

/* al terminar de editar una URL de imagen, muestra la vista previa */
sectionsList.addEventListener(
  "change",
  (e) => {
    if (e.target.dataset.field === "src") renderSectionsEditor();
  },
  true
);

/* ── Guardar / publicar ──────────────────────────────────────────────── */

function collectArticle() {
  const cleanSections = sections
    .map(({ uid: _uid, ...section }) => {
      if (section.type === "list") {
        if (Array.isArray(section.itemsHtml)) {
          section.itemsHtml = section.itemsHtml
            .map((h) => sanitizeHtml(h))
            .filter((h) => htmlToPlainText(h).trim());
          section.items = section.itemsHtml.map((h) =>
            htmlToPlainText(h).trim()
          );
        } else {
          section.items = (section.items || [])
            .map((s) => String(s).trim())
            .filter(Boolean);
        }
      }
      if (section.type === "text") {
        section.html = sanitizeHtml(section.html || "");
        delete section.text; // el HTML pasa a ser la fuente de verdad
      }
      if (section.type === "heading" || section.type === "quote") {
        if (section.html != null) {
          section.html = sanitizeHtml(section.html);
          section.text = htmlToPlainText(section.html).trim();
        }
      }
      if (section.type === "image" && section.captionHtml != null) {
        section.captionHtml = sanitizeHtml(section.captionHtml);
        section.caption = htmlToPlainText(section.captionHtml).trim();
      }
      return section;
    })
    .filter((section) => {
      if (section.type === "image") return Boolean(section.src);
      if (section.type === "list") return section.items.length > 0;
      if (section.type === "text")
        return Boolean(htmlToPlainText(section.html).trim());
      return Boolean(section.text && section.text.trim());
    });

  const urlValue = $("f-cover-url").value.trim();
  const cover = coverData.startsWith("data:") ? coverData : urlValue || coverData;

  const title = richFieldValue("f-title");
  const excerpt = richFieldValue("f-excerpt");
  const footer = richFieldValue("f-footer");

  return {
    title: title.plain,
    titleHtml: title.html,
    tag: $("f-tag").value,
    excerpt: excerpt.plain,
    excerptHtml: excerpt.html,
    cover,
    footer: footer.plain,
    footerHtml: footer.html,
    sections: cleanSections,
  };
}

function validate(data, { publishing }) {
  if (!data.title) {
    toast("El artículo necesita un título.", "error");
    $("f-title").focus();
    return false;
  }
  if (publishing && !data.sections.length) {
    toast("Añade al menos una sección con contenido antes de publicar.", "error");
    return false;
  }
  if (JSON.stringify(data).length > MAX_DOC_BYTES) {
    toast(
      "El artículo pesa demasiado. Usa menos imágenes subidas o imágenes por URL.",
      "error"
    );
    return false;
  }
  return true;
}

async function persist(status, btn, busyText) {
  const data = collectArticle();
  if (!validate(data, { publishing: status === "published" })) return;

  busy(btn, true, busyText);
  try {
    const payload = { ...data, status, updatedAt: serverTimestamp() };

    if (editing) {
      if (status === "published" && !editing.publishedAt) {
        payload.publishedAt = serverTimestamp();
      }
      await updateDoc(doc(db, "articles", editing.id), payload);
      if (payload.publishedAt) editing.publishedAt = payload.publishedAt;
    } else {
      payload.createdAt = serverTimestamp();
      if (status === "published") payload.publishedAt = serverTimestamp();
      const ref = await addDoc(collection(db, "articles"), payload);
      editing = {
        id: ref.id,
        status,
        publishedAt: payload.publishedAt || null,
        createdAt: payload.createdAt,
      };
      $("editor-title").textContent = "Editar artículo";
    }

    editing.status = status;
    dirty = false;
    updateEditorStatus();
    toast(
      status === "published"
        ? "Artículo publicado. Ya está visible en la página de artículos."
        : "Borrador guardado."
    );
    await loadArticles();
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar. Revisa tu conexión y los permisos.", "error");
  } finally {
    busy(btn, false);
  }
}

$("btn-save-draft").addEventListener("click", (e) =>
  persist("draft", e.currentTarget, "Guardando…")
);
$("btn-publish").addEventListener("click", (e) =>
  persist("published", e.currentTarget, "Publicando…")
);

/* aviso al salir con cambios sin guardar */
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ── Vista previa ────────────────────────────────────────────────────── */

$("btn-preview").addEventListener("click", () => {
  const data = collectArticle();
  renderArticle($("preview-root"), {
    ...data,
    publishedAt:
      (editing && toDateValue(editing.publishedAt)) || new Date(),
  });
  $("preview").hidden = false;
  document.body.style.overflow = "hidden";
});

function closePreview() {
  $("preview").hidden = true;
  document.body.style.overflow = "";
}
$("preview-close").addEventListener("click", closePreview);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("preview").hidden) closePreview();
  else if (!$("modal").hidden) closeModal();
});
