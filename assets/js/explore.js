/**
 * explore.js — Trang Khám phá địa điểm
 * URL: /kham-pha-dia-diem.html
 */

import { api } from "./core/api.js";
import { CATEGORY_META } from "./core/categories.js";

const PAGE_SIZE = 12;

const CATEGORIES = [
  { key: "", label: "Tất cả" },
  { key: "dulich",  label: "Du lịch" },
  { key: "luutru",  label: "Lưu trú" },
  { key: "amthuc",  label: "Ẩm thực" },
  { key: "giaitri", label: "Giải trí" },
  { key: "suckhoe", label: "Sức khỏe" },
  { key: "tienich", label: "Tiện ích" },
];

// ---- State ----
let allPlaces      = [];   // toàn bộ danh sách gốc (chưa filter search)
let filteredPlaces = [];   // sau khi filter theo search query
let currentPage    = 1;
let activeCategory = "";
let searchQuery    = "";
let searchTimer    = null;

// ---- DOM helpers ----
const $ = (id) => document.getElementById(id);

const el = {
  grid:       $("exploreGrid"),
  pagination: $("explorePagination"),
  count:      $("exploreCount"),
  loading:    $("exploreLoading"),
  searchInput:$("exploreSearchInput"),
  searchClear:$("exploreSearchClear"),
  tabsWrap:   $("exploreTabs"),
};

// ---- Init ----
async function init() {
  buildTabs();
  bindUI();

  // Đọc query params từ URL nếu có (?category=amthuc&q=cafe)
  const params = new URLSearchParams(location.search);
  const initCat = params.get("category") || "";
  const initQ   = params.get("q") || "";

  if (initCat && CATEGORY_META[initCat]) {
    activeCategory = initCat;
    setActiveTab(initCat);
  }
  if (initQ) {
    searchQuery = initQ;
    el.searchInput.value = initQ;
    el.searchClear.classList.add("visible");
  }

  await loadPlaces();
}

// ---- Build category tabs ----
function buildTabs() {
  el.tabsWrap.innerHTML = CATEGORIES.map(({ key, label }) => {
    const meta = CATEGORY_META[key];
    const icon = meta ? meta.icon + " " : "";
    return `<button
      class="explore-tab${key === activeCategory ? " active" : ""}"
      data-category="${escapeHtml(key)}"
      type="button"
      aria-pressed="${key === activeCategory}"
    >${icon}${escapeHtml(label)}</button>`;
  }).join("");
}

function setActiveTab(category) {
  el.tabsWrap.querySelectorAll(".explore-tab").forEach(btn => {
    const isActive = btn.dataset.category === category;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

// ---- UI events ----
function bindUI() {
  // Category tabs
  el.tabsWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".explore-tab");
    if (!btn) return;
    activeCategory = btn.dataset.category;
    setActiveTab(activeCategory);
    currentPage = 1;
    updateUrl();
    loadPlaces();
  });

  // Search input — debounce 400ms, chỉ filter local không reload API
  el.searchInput.addEventListener("input", () => {
    el.searchClear.classList.toggle("visible", !!el.searchInput.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = el.searchInput.value.trim();
      currentPage = 1;
      updateUrl();
      applySearchAndRender();   // filter local, không gọi API
    }, 400);
  });

  // Clear search
  el.searchClear.addEventListener("click", () => {
    el.searchInput.value = "";
    el.searchClear.classList.remove("visible");
    searchQuery = "";
    currentPage = 1;
    updateUrl();
    applySearchAndRender();
    el.searchInput.focus();
  });

  // Hamburger menu (dùng lại logic từ base.css)
  const menuBtn  = document.getElementById("menuButton");
  const siteHeader = document.querySelector(".site-header");
  if (menuBtn && siteHeader) {
    menuBtn.addEventListener("click", () => {
      const isOpen = siteHeader.classList.toggle("menu-open");
      menuBtn.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (e) => {
      if (!siteHeader.contains(e.target)) {
        siteHeader.classList.remove("menu-open");
        menuBtn.setAttribute("aria-expanded", "false");
      }
    });
  }
}

// ---- Load & render ----
async function loadPlaces() {
  showLoading(true);

  try {
    const qs = new URLSearchParams();
    if (activeCategory) qs.set("category", activeCategory);

    const { items } = await api(`/api/places?${qs}`);
    allPlaces = items || [];   // lưu toàn bộ, chưa filter search
  } catch (err) {
    allPlaces = [];
    console.error("Không tải được danh sách địa điểm:", err);
  }

  showLoading(false);
  applySearchAndRender();
}

// Filter search query trên allPlaces đã có sẵn — không gọi API
function applySearchAndRender() {
  if (!searchQuery) {
    filteredPlaces = allPlaces;
  } else {
    const needle = searchQuery.toLocaleLowerCase("vi");
    filteredPlaces = allPlaces.filter(p =>
      `${p.name} ${p.address || ""} ${p.note || ""}`.toLocaleLowerCase("vi").includes(needle)
    );
  }
  renderPage();
}

function renderPage(scrollToTop = false) {
  const total      = filteredPlaces.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage      = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const items = filteredPlaces.slice(start, start + PAGE_SIZE);

  // Count
  el.count.innerHTML = total > 0
    ? `Hiển thị <strong>${start + 1}–${start + items.length}</strong> trong <strong>${total}</strong> địa điểm`
    : `Không tìm thấy địa điểm nào`;

  // Grid
  if (items.length === 0) {
    el.grid.innerHTML = `
      <div class="explore-empty">
        <strong>Không có kết quả</strong>
        <p>Thử thay đổi từ khóa hoặc chọn danh mục khác.</p>
      </div>`;
  } else {
    el.grid.innerHTML = items.map(renderCard).join("");
  }

  // Pagination
  renderPagination(totalPages);

  // Chỉ scroll lên đầu grid khi user bấm đổi trang, không scroll khi search/filter
  if (scrollToTop) {
    el.grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderCard(place) {
  const meta = CATEGORY_META[place.category] || { title: place.category, icon: "•" };
  const thumb = place.coverImage
    ? `<img src="${escapeHtml(place.coverImage)}" alt="${escapeHtml(place.name)}" loading="lazy" />`
    : `<span class="explore-card-thumb-placeholder" aria-hidden="true">${meta.icon}</span>`;

  const pills = [];
  if (place.openingHours) pills.push(place.openingHours);
  if (place.priceRange)   pills.push(place.priceRange);
  if (place.imageCount)   pills.push(`${place.imageCount} ảnh`);
  if (place.panoramaCount) pills.push(`${place.panoramaCount} ảnh 360°`);

  return `
    <a class="explore-card" href="${escapeHtml(place.detailUrl)}" aria-label="Xem chi tiết ${escapeHtml(place.name)}">
      <div class="explore-card-thumb">${thumb}</div>
      <div class="explore-card-body">
        <span class="explore-card-cat">${meta.icon} ${escapeHtml(meta.title)}</span>
        <h2 class="explore-card-name">${escapeHtml(place.name)}</h2>
        <p class="explore-card-address">${escapeHtml(place.address || "Phường Bình Định")}</p>
        ${place.note ? `<p class="explore-card-note">${escapeHtml(place.note)}</p>` : ""}
        ${pills.length ? `<div class="explore-card-pills">${pills.map(p => `<span class="explore-card-pill">${escapeHtml(p)}</span>`).join("")}</div>` : ""}
      </div>
    </a>`;
}

// ---- Pagination ----
function renderPagination(totalPages) {
  if (totalPages <= 1) {
    el.pagination.innerHTML = "";
    return;
  }

  const pages = buildPageRange(currentPage, totalPages);
  let html = "";

  // Prev button
  html += `<button class="explore-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Trang trước">‹</button>`;

  // Page numbers
  for (const p of pages) {
    if (p === "…") {
      html += `<span class="explore-page-ellipsis">…</span>`;
    } else {
      html += `<button class="explore-page-btn${p === currentPage ? " active" : ""}" data-page="${p}" aria-label="Trang ${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`;
    }
  }

  // Next button
  html += `<button class="explore-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""} aria-label="Trang sau">›</button>`;

  el.pagination.innerHTML = html;

  el.pagination.querySelectorAll(".explore-page-btn:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      const page = Number(btn.dataset.page);
      if (page >= 1 && page <= totalPages && page !== currentPage) {
        currentPage = page;
        updateUrl();
        renderPage(true);
      }
    });
  });
}

/**
 * Tính danh sách trang hiển thị, thu gọn khi nhiều trang.
 * Ví dụ: [1, 2, 3, "…", 8] hoặc [1, "…", 4, 5, 6, "…", 10]
 */
function buildPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total, current]);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  let prev = null;

  for (const p of sorted) {
    if (prev !== null && p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }

  return result;
}

// ---- Loading indicator ----
function showLoading(on) {
  el.loading.style.display = on ? "flex" : "none";
  if (on) {
    el.grid.innerHTML = "";
    el.count.textContent = "";
    el.pagination.innerHTML = "";
  }
}

// ---- URL sync ----
function updateUrl() {
  const params = new URLSearchParams();
  if (activeCategory) params.set("category", activeCategory);
  if (searchQuery)    params.set("q", searchQuery);
  if (currentPage > 1) params.set("page", String(currentPage));
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---- Utilities ----
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Boot ----
init();
