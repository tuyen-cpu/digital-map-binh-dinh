import { getSession, loginUser } from "./user-auth.js";

// if (getSession()) location.replace("trang-chu.html");

const form = document.getElementById("loginForm");
const message = document.getElementById("loginMessage");

form.addEventListener("submit", event => {
  event.preventDefault();
  message.textContent = "Đang đăng nhập...";
  message.classList.remove("success");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    loginUser(document.getElementById("username").value, document.getElementById("password").value);
    message.textContent = "Đăng nhập thành công.";
    message.classList.add("success");
    location.replace("trang-chu.html");
  } catch (error) {
    message.textContent = error.message || "Đăng nhập thất bại.";
  } finally {
    button.disabled = false;
  }
});
