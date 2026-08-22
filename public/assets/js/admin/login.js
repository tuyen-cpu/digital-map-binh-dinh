import { api } from "../core/api.js?v=vnpt-16";

const form=document.getElementById("loginForm"),message=document.getElementById("loginMessage");
(async()=>{try{await api("/api/auth/me");location.replace("/admin/dashboard")}catch{}})();
form.addEventListener("submit",async event=>{event.preventDefault();message.textContent="Đang đăng nhập...";message.classList.remove("success");const button=form.querySelector("button[type=submit]");button.disabled=true;try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({username:document.getElementById("username").value.trim(),password:document.getElementById("password").value})});message.textContent="Đăng nhập thành công.";message.classList.add("success");location.replace("/admin/dashboard")}catch(error){message.textContent=error.message||"Đăng nhập thất bại."}finally{button.disabled=false}});
