const USERS_KEY = "bd_tourism_public_users";
const SESSION_KEY = "bd_tourism_public_session";

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    username: user.username,
    displayName: user.displayName || user.username
  }));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const users = raw ? JSON.parse(raw) : [];
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function registerUser({ displayName, username, password, confirmPassword }) {
  const name = String(displayName || "").trim();
  const account = String(username || "").trim();
  const pass = String(password || "");
  const confirm = String(confirmPassword || "");
  if (!account) throw new Error("Tên tài khoản là bắt buộc.");
  if (!/^[A-Za-z0-9_]{3,32}$/.test(account)) throw new Error("Tên tài khoản chỉ dùng chữ cái, số, dấu _ (3–32 ký tự).");
  if (pass.length < 6) throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  if (pass !== confirm) throw new Error("Xác nhận mật khẩu không khớp.");
  const users = loadUsers();
  if (users.some(user => user.username.toLowerCase() === account.toLowerCase())) {
    throw new Error("Tên tài khoản đã tồn tại.");
  }
  const user = { displayName: name || account, username: account, password: pass, createdAt: new Date().toISOString() };
  users.push(user);
  saveUsers(users);
  setSession(user);
  return user;
}

export function loginUser(username, password) {
  const account = String(username || "").trim();
  const pass = String(password || "");
  const user = loadUsers().find(item => item.username.toLowerCase() === account.toLowerCase());
  if (!user || user.password !== pass) throw new Error("Sai tài khoản hoặc mật khẩu.");
  setSession(user);
  return user;
}
