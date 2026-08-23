/**
 * home.js — Trang chủ Phường Bình Định
 * URL: /trang-chu.html
 */

import { api } from "./core/api.js";
import { CATEGORY_META } from "./core/categories.js";

// ---- Slideshow config ----
const SLIDES = [
  {
    img: "assets/images/places-real/chua-thien-an-1.webp",
    caption: "Chùa Thiên An",
  },
  {
    img: "assets/images/places-real/cong-vien-trung-tam-1.webp",
    caption: "Công viên Trung tâm",
  },
  {
    img: "assets/images/places-real/nha-van-hoa-an-nhon-1.webp",
    caption: "Nhà văn hóa An Nhơn",
  },
  {
    img: "assets/images/places-real/ga-binh-dinh-1.webp",
    caption: "Ga Bình Định",
  },
  {
    img: "assets/images/places-real/cong-vien-nuoc-an-nhon-1.webp",
    caption: "Công viên nước An Nhơn",
  },
  {
    img: "assets/images/places-real/cho-binh-dinh-1.webp",
    caption: "Chợ Bình Định",
  },
];

// ---- Highlight places (hiện tại hardcode id, load chi tiết sau) ----
const HIGHLIGHT_IDS = [
  "chua-thien-an",
  "nha-van-hoa-an-nhon",
  "ozone-drinks-food",
  "khach-san-century",
];

// ---- Slideshow state ----
let currentSlide = 0;
let autoplayTimer = null;
const AUTOPLAY_DELAY = 4500;

// ---- DOM helpers ----
const $ = (id) => document.getElementById(id);

// ---- Init ----
async function init() {
  initSlideshow();
  bindMenu();
  loadHighlights();
  loadCategoryCounts();
}

// ================================================================
// SLIDESHOW
// ================================================================
function initSlideshow() {
  const track = $("heroSlides");
  const dotsWrap = $("heroDots");
  const caption = $("heroCaption");

  if (!track) return;

  // Build slides HTML
  track.innerHTML = SLIDES.map((s, i) =>
    `<div class="hero-slide" aria-hidden="${i !== 0}">
      <img src="${esc(s.img)}" alt="${esc(s.caption)}" loading="${i === 0 ? "eager" : "lazy"}" />
    </div>`
  ).join("");

  // Build dots
  dotsWrap.innerHTML = SLIDES.map((_, i) =>
    `<button class="hero-dot${i === 0 ? " active" : ""}" data-index="${i}" aria-label="Slide ${i + 1}" type="button"></button>`
  ).join("");

  // Dot click
  dotsWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".hero-dot");
    if (btn) goTo(Number(btn.dataset.index));
  });

  // Arrow buttons
  $("heroPrev")?.addEventListener("click", () => goTo(currentSlide - 1));
  $("heroNext")?.addEventListener("click", () => goTo(currentSlide + 1));

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goTo(currentSlide - 1);
    if (e.key === "ArrowRight") goTo(currentSlide + 1);
  });

  // Touch swipe
  let touchStartX = null;
  track.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(currentSlide + (dx < 0 ? 1 : -1));
    touchStartX = null;
  });

  // Pause on hover
  track.addEventListener("mouseenter", () => clearTimeout(autoplayTimer));
  track.addEventListener("mouseleave", scheduleNext);

  startAutoplay();

  function goTo(index) {
    const total = SLIDES.length;
    currentSlide = ((index % total) + total) % total;

    // Move track
    track.style.transform = `translateX(-${currentSlide * 100}%)`;

    // Update aria-hidden
    track.querySelectorAll(".hero-slide").forEach((el, i) =>
      el.setAttribute("aria-hidden", String(i !== currentSlide))
    );

    // Update dots
    dotsWrap.querySelectorAll(".hero-dot").forEach((dot, i) =>
      dot.classList.toggle("active", i === currentSlide)
    );

    // Caption
    if (caption) caption.textContent = SLIDES[currentSlide].caption;

    resetAutoplay();
  }

  function startAutoplay() {
    scheduleNext();
  }

  function scheduleNext() {
    clearTimeout(autoplayTimer);
    autoplayTimer = setTimeout(() => goTo(currentSlide + 1), AUTOPLAY_DELAY);
  }

  function resetAutoplay() {
    clearTimeout(autoplayTimer);
    scheduleNext();
  }

  // Set initial caption
  if (caption) caption.textContent = SLIDES[0].caption;
}

// ================================================================
// HIGHLIGHT PLACES
// ================================================================
async function loadHighlights() {
  const container = $("highlightCards");
  if (!container) return;

  try {
    // Lấy tất cả places rồi filter theo id ưu tiên
    const { items } = await api("/api/places");
    const byId = new Map(items.map((p) => [p.id, p]));

    // Lấy theo HIGHLIGHT_IDS trước, bổ sung ngẫu nhiên nếu thiếu
    let selected = HIGHLIGHT_IDS.map((id) => byId.get(id)).filter(Boolean);
    if (selected.length < 4) {
      const extra = items
        .filter((p) => !HIGHLIGHT_IDS.includes(p.id) && p.coverImage)
        .slice(0, 4 - selected.length);
      selected = [...selected, ...extra];
    }
    selected = selected.slice(0, 4);

    container.innerHTML = selected.map(renderHighlightCard).join("");
  } catch (err) {
    console.error("Không tải được địa điểm nổi bật:", err);
    container.innerHTML = "";
  }
}

function renderHighlightCard(place) {
  const meta = CATEGORY_META[place.category] || { title: place.category, icon: "•" };
  const thumb = place.coverImage
    ? `<img src="${esc(place.coverImage)}" alt="${esc(place.name)}" loading="lazy" />`
    : "";

  return `
    <a class="highlight-card" href="${esc(place.detailUrl)}" aria-label="Xem chi tiết ${esc(place.name)}">
      <div class="highlight-thumb">${thumb}</div>
      <div class="highlight-body">
        <span class="highlight-cat">${esc(meta.icon)} ${esc(meta.title)}</span>
        <span class="highlight-name">${esc(place.name)}</span>
        <span class="highlight-address">${esc(place.address || "Phường Bình Định")}</span>
      </div>
    </a>`;
}

// ================================================================
// CATEGORY COUNTS
// ================================================================
async function loadCategoryCounts() {
  try {
    const { items } = await api("/api/places");
    const counts = {};
    for (const p of items) counts[p.category] = (counts[p.category] || 0) + 1;

    // Cập nhật số đếm vào từng cat-card
    document.querySelectorAll("[data-cat-key]").forEach((el) => {
      const key = el.dataset.catKey;
      const n = counts[key] || 0;
      el.textContent = `${n} địa điểm`;
    });

    // Tổng stat
    const totalEl = $("statTotal");
    if (totalEl) totalEl.textContent = items.length;
  } catch {
    // Bỏ qua lỗi — số đếm không quan trọng
  }
}

// ================================================================
// HAMBURGER MENU
// ================================================================
function bindMenu() {
  const btn = $("menuButton");
  const hdr = document.querySelector(".site-header");
  if (!btn || !hdr) return;

  btn.addEventListener("click", () => {
    const open = hdr.classList.toggle("menu-open");
    btn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!hdr.contains(e.target)) {
      hdr.classList.remove("menu-open");
      btn.setAttribute("aria-expanded", "false");
    }
  });
}

// ================================================================
// UTILITIES
// ================================================================
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Boot ----
init();
