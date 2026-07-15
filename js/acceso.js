/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — acceso.js
   Puerta de entrada a Fenómenos App: iniciar sesión, crear cuenta o entrar
   como invitado (sesión anónima de Firebase). Estas cuentas NO tienen
   acceso al Estudio: solo a la app.
   ══════════════════════════════════════════════════════════════════════════ */

import { app } from "./firebase-init.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

window.__fdcModuleOk = true;

const auth = getAuth(app);
const $ = (id) => document.getElementById(id);

/* si ya hay sesión, directo a la app */
let navigating = false;
onAuthStateChanged(auth, (user) => {
  if (user && !navigating) {
    navigating = true;
    location.replace("app.html");
  }
});

/* ── Pestañas ── */

function showTab(which) {
  const login = which === "login";
  $("tab-login").classList.toggle("is-active", login);
  $("tab-signup").classList.toggle("is-active", !login);
  $("form-login").hidden = !login;
  $("form-signup").hidden = login;
  $("auth-title").textContent = login ? "Bienvenido de nuevo" : "Crea tu cuenta";
  $("auth-sub").textContent = login
    ? "Inicia sesión para entrar a la app del tiempo."
    : "Guarda tus ajustes y accede desde cualquier dispositivo.";
  $("auth-error").textContent = "";
}
$("tab-login").addEventListener("click", () => showTab("login"));
$("tab-signup").addEventListener("click", () => showTab("signup"));

/* ── Errores en español ── */

function errorMessage(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Correo o contraseña incorrectos.";
  if (code.includes("email-already-in-use"))
    return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (code.includes("invalid-email")) return "Escribe un correo válido.";
  if (code.includes("weak-password"))
    return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("too-many-requests"))
    return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  if (code.includes("operation-not-allowed"))
    return "Este método de acceso no está habilitado.";
  if (code.includes("network-request-failed"))
    return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  return "No se pudo completar el acceso. Intenta de nuevo.";
}

function busy(btn, isBusy, busyText) {
  btn.disabled = isBusy;
  if (!btn.dataset.original) btn.dataset.original = btn.innerHTML;
  if (isBusy) {
    btn.textContent = busyText;
  } else {
    btn.innerHTML = btn.dataset.original;
  }
}

/* ── Iniciar sesión ── */

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").textContent = "";
  const email = $("li-email").value.trim();
  const password = $("li-password").value;
  if (!email || !password) {
    $("auth-error").textContent = "Completa tu correo y tu contraseña.";
    return;
  }
  busy($("li-submit"), true, "Entrando…");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    /* onAuthStateChanged redirige */
  } catch (err) {
    $("auth-error").textContent = errorMessage(err);
    busy($("li-submit"), false);
  }
});

/* ── Crear cuenta ── */

$("form-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").textContent = "";
  const name = $("su-name").value.trim();
  const email = $("su-email").value.trim();
  const password = $("su-password").value;
  if (!name) {
    $("auth-error").textContent = "Escribe tu nombre.";
    return;
  }
  if (!email || !password) {
    $("auth-error").textContent = "Completa tu correo y tu contraseña.";
    return;
  }
  busy($("su-submit"), true, "Creando cuenta…");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
    } catch (_) {}
    location.replace("app.html");
  } catch (err) {
    $("auth-error").textContent = errorMessage(err);
    busy($("su-submit"), false);
  }
});

/* ── Invitado ── */

$("btn-guest").addEventListener("click", async () => {
  $("auth-error").textContent = "";
  busy($("btn-guest"), true, "Entrando como invitado…");
  try {
    await signInAnonymously(auth);
  } catch (err) {
    $("auth-error").textContent =
      err && String(err.code || "").includes("operation-not-allowed")
        ? "El acceso de invitado no está habilitado todavía."
        : errorMessage(err);
    busy($("btn-guest"), false);
  }
});
