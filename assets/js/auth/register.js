import { getSession, registerUser } from "./user-auth.js";

// if (getSession()) location.replace("trang-chu.html"); 

const form = document.getElementById("registerForm");
const message = document.getElementById("registerMessage");

form.addEventListener("submit", event => {
  event.preventDefault();
  message.textContent = "Đang tạo tài khoản...";
  message.classList.remove("success");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    registerUser({
      displayName: document.getElementById("displayName").value,
      username: document.getElementById("username").value,
      password: document.getElementById("password").value,
      confirmPassword: document.getElementById("confirmPassword").value
    });
    message.textContent = "Tạo tài khoản thành công.";
    message.classList.add("success");
    location.replace("trang-chu.html");
  } catch (error) {
    message.textContent = error.message || "Không thể tạo tài khoản.";
  } finally {
    button.disabled = false;
  }
});
