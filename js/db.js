/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — db.js
   Acceso de solo lectura a Firestore para las páginas públicas.
   ══════════════════════════════════════════════════════════════════════════ */

import { app } from "./firebase-init.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toDateValue } from "./render-article.js";

export const db = getFirestore(app);

/* Solo `where` de igualdad (índice automático); el orden se resuelve aquí,
   así el proyecto no necesita índices compuestos. */
export async function fetchPublished() {
  const snap = await getDocs(
    query(collection(db, "articles"), where("status", "==", "published"))
  );
  const articles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  articles.sort((a, b) => {
    const da = toDateValue(a.publishedAt || a.createdAt)?.getTime() || 0;
    const dbb = toDateValue(b.publishedAt || b.createdAt)?.getTime() || 0;
    return dbb - da;
  });
  return articles;
}

export async function fetchArticle(id) {
  const snap = await getDoc(doc(db, "articles", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/* Reacciones públicas (👍 ❤️ 🔥): incremento atómico sobre el contador.
   Requiere la regla de Firestore que permite actualizar SOLO el campo
   `reactions` de artículos publicados (ver README). */
export async function reactToArticle(id, kind, delta) {
  await updateDoc(doc(db, "articles", id), {
    ["reactions." + kind]: increment(delta),
  });
}

/* Cambia la reacción única del visitante en una sola escritura atómica:
   suma a la nueva y resta de la anterior (cualquiera puede ser null). */
export async function switchReaction(id, addKind, removeKind) {
  const patch = {};
  if (addKind) patch["reactions." + addKind] = increment(1);
  if (removeKind) patch["reactions." + removeKind] = increment(-1);
  if (!Object.keys(patch).length) return;
  await updateDoc(doc(db, "articles", id), patch);
}

/* ── Comentarios ─────────────────────────────────────────────────────────
   Cualquiera puede crear un comentario, pero nace PENDIENTE y solo se ve
   en público cuando el Estudio lo aprueba. Los «me gusta» son un
   incremento atómico del contador (regla de Firestore aparte). */

export async function fetchComments(articleId) {
  const snap = await getDocs(
    query(
      collection(db, "comments"),
      where("articleId", "==", articleId),
      where("status", "==", "approved")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addComment({ articleId, parentId, rootId, depth, name, email, text }) {
  const ref = await addDoc(collection(db, "comments"), {
    articleId,
    parentId: parentId || null,
    rootId: rootId || null,
    depth: depth || 0,
    name,
    email: email || "",
    text,
    likes: 0,
    status: "pending",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function likeComment(id, delta) {
  await updateDoc(doc(db, "comments", id), { likes: increment(delta) });
}

export async function fetchTags() {
  try {
    const snap = await getDoc(doc(db, "meta", "tags"));
    const list = snap.exists() ? snap.data().list : null;
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
