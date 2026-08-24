import { clearSession, getSession } from "./auth/user-auth.js";

function syncAuthNav() {
  const session = getSession();
  document.body.classList.toggle("is-logged-in", Boolean(session));
  const name = session?.displayName || session?.username || "";
  document.querySelectorAll("[data-user-greeting]").forEach(el => {
    el.textContent = session ? `Xin chào, ${name}` : "";
  });
}

document.querySelectorAll("[data-logout]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    clearSession();
    location.reload();
  });
});

syncAuthNav();
