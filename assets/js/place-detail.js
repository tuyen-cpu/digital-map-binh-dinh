import { api } from "./core/api.js?v=vnpt-16";
import { CATEGORY_META } from "./core/categories.js";

const byId = id => document.getElementById(id);
let detail = null;
let panoramaViewer = null;

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return showError("Thiếu mã địa điểm trong đường dẫn.");
  try {
    detail = await api(`/api/places/${encodeURIComponent(id)}`);
    render(detail);
    byId("detailLoading").hidden = true;
    byId("detailContent").hidden = false;
    bind();
  } catch (error) {
    showError(error.status === 404 ? "Không tìm thấy địa điểm hoặc địa điểm chưa được công khai." : error.message);
  }
}

function render({ place, images = [], panoramas = [], article }) {
  document.title = `${place.name} - Bản đồ số Phường Bình Định`;
  byId("detailCategory").textContent = CATEGORY_META[place.category]?.title || place.category;
  byId("detailName").textContent = place.name;
  byId("detailAddress").textContent = place.address || "Phường Bình Định";
  byId("detailMeta").innerHTML = `<span>${escapeHtml(place.note || "Địa điểm")}</span>${images.length ? `<span>${images.length} hình ảnh</span>` : ""}${panoramas.length ? `<span>${panoramas.length} ảnh 360°</span>` : ""}`;

  const cover = images.find(x => x.isCover) || images[0];
  if (cover) {
    byId("heroImage").src = cover.url;
    byId("heroImage").alt = cover.altText || `Ảnh ${place.name}`;
  } else {
    byId("heroImageWrap").classList.add("no-image");
    byId("heroImage").hidden = true;
    byId("heroImageWrap").textContent = "Chưa có ảnh địa điểm";
  }

  const actions = [];
  if (place.phone) actions.push(`<a href="tel:${escapeHtml(place.phone)}">Gọi điện</a>`);
  if (place.website) actions.push(`<a href="${escapeHtml(place.website)}" target="_blank" rel="noopener">Website ↗</a>`);
  byId("detailActions").innerHTML = actions.join("");

  if (images.length) {
    byId("gallerySection").hidden = false;
    byId("detailGallery").innerHTML = images.map(img => `<button type="button" data-image="${escapeHtml(img.id)}"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.altText || img.caption || `Ảnh ${place.name}`)}" loading="lazy" /><span>${escapeHtml(img.caption || "Xem ảnh")}</span></button>`).join("");
  }

  if (article) {
    byId("articleTitle").textContent = article.title || place.name;
    byId("articleSummary").textContent = article.summary || "";
    byId("articleSummary").hidden = !article.summary;
    byId("articleContent").textContent = article.content || "";
    byId("articleContent").hidden = !article.content;
    if (article.externalUrl) {
      byId("externalArticleLink").href = article.externalUrl;
      byId("externalArticleLink").hidden = false;
    }
  } else {
    byId("articleSummary").hidden = true;
    byId("articleContent").hidden = true;
    byId("noArticle").hidden = false;
  }

  byId("infoAddress").textContent = place.address || "Chưa cập nhật";
  byId("infoPhone").textContent = place.phone || "Chưa cập nhật";
  byId("phoneInfo").hidden = !place.phone;
  if (place.website) byId("infoWebsite").innerHTML = `<a href="${escapeHtml(place.website)}" target="_blank" rel="noopener">Mở website ↗</a>`;
  else byId("websiteInfo").hidden = true;
  byId("infoHours").textContent = place.openingHours || "";
  byId("hoursInfo").hidden = !place.openingHours;
  byId("infoPrice").textContent = place.priceRange || "";
  byId("priceInfo").hidden = !place.priceRange;
  byId("infoCoords").textContent = hasCoords(place) ? `${Number(place.lat).toFixed(6)}, ${Number(place.lng).toFixed(6)}` : "Đang cập nhật";

  byId("routeToButton").href = hasCoords(place) ? `?routeTo=${encodeURIComponent(place.id)}` : "/";
  byId("routeToButton").classList.toggle("disabled", !hasCoords(place));
  byId("show360Button").disabled = panoramas.length === 0;
  if (!hasCoords(place) && !panoramas.length) byId("locationStatus").textContent = "Thông tin vị trí và không gian 360° đang được cập nhật.";
  else if (!hasCoords(place)) byId("locationStatus").textContent = "Địa điểm chưa xác định vị trí nên chưa thể dẫn đường.";
  else if (!panoramas.length) byId("locationStatus").textContent = "Không gian 360° của địa điểm đang được cập nhật.";
  else byId("locationStatus").textContent = "Có thể xem đường đi hoặc khám phá không gian 360°.";
}

function bind() {
  byId("detailGallery").addEventListener("click", event => {
    const button = event.target.closest("[data-image]");
    if (!button) return;
    const image = detail.images.find(x => x.id === button.dataset.image);
    if (!image) return;
    byId("lightboxImage").src = image.url;
    byId("lightboxImage").alt = image.altText || image.caption || detail.place.name;
    byId("lightboxCaption").textContent = image.caption || "";
    byId("imageLightbox").showModal();
  });
  byId("closeLightbox").addEventListener("click", () => byId("imageLightbox").close());
  byId("imageLightbox").addEventListener("click", event => { if (event.target === byId("imageLightbox")) byId("imageLightbox").close(); });
  byId("routeToButton").addEventListener("click", event => {
    if (!hasCoords(detail.place)) event.preventDefault();
  });
  byId("show360Button").addEventListener("click", showPanoramaTour);
  byId("close360Button").addEventListener("click", closePanoramaTour);
}

async function showPanoramaTour() {
  const panoramas = [...(detail.panoramas || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  if (!panoramas.length) return;
  setLocationLoading("Đang mở Tour 360°...");
  try {
    if (!window.pannellum) throw new Error("Không tải được không gian 360°. Vui lòng thử lại sau.");
    byId("detailPanorama").hidden = false;
    panoramaViewer?.destroy?.();
    byId("detailPanorama").replaceChildren();
    panoramaViewer = window.pannellum.viewer("detailPanorama", makePanoramaTourConfig(detail.place, panoramas));
    setTimeout(() => panoramaViewer?.resize?.(), 80);
    byId("locationStatus").textContent = panoramas.length > 1
      ? `Tour 360° có ${panoramas.length} điểm chụp. Dùng hotspot “Đi tiếp / Quay lại” để di chuyển giữa các panorama.`
      : "Đang hiển thị ảnh panorama 360°. Kéo để xoay, cuộn để phóng to/thu nhỏ.";
    byId("show360Button").classList.add("primary");
    byId("show360Button").hidden = true;
    byId("close360Button").hidden = false;
    byId("detailPanorama").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  } catch (error) {
    showLocationError(error.message);
  }
}


function closePanoramaTour() {
  panoramaViewer?.destroy?.();
  panoramaViewer = null;
  byId("detailPanorama").replaceChildren();
  byId("detailPanorama").hidden = true;
  byId("show360Button").hidden = false;
  byId("show360Button").classList.remove("primary");
  byId("close360Button").hidden = true;
  byId("locationStatus").textContent = "Có thể xem đường đi hoặc khám phá không gian 360°.";
}

function makePanoramaTourConfig(place, panoramas) {
  const scenes = {};
  panoramas.forEach((panorama, index) => {
    const hotSpots = [];
    if (index > 0) hotSpots.push({ pitch: -7, yaw: -95, type: "scene", text: "Quay lại", sceneId: panoramas[index - 1].id, targetYaw: "sameAzimuth" });
    if (index < panoramas.length - 1) hotSpots.push({ pitch: -7, yaw: 95, type: "scene", text: "Đi tiếp", sceneId: panoramas[index + 1].id, targetYaw: "sameAzimuth" });
    scenes[panorama.id] = {
      type: "equirectangular",
      panorama: panorama.url,
      title: panorama.title || `${place.name} - 360° ${index + 1}`,
      yaw: Number(panorama.initialYaw || 0),
      pitch: Number(panorama.initialPitch || 0),
      hfov: 110,
      hotSpots
    };
  });
  return {
    default: {
      firstScene: panoramas[0].id,
      author: "Bản đồ số du lịch Phường Bình Định",
      autoLoad: true,
      sceneFadeDuration: 650,
      compass: true
    },
    scenes
  };
}

function setLocationLoading(message) {
  byId("locationStatus").textContent = message;
  byId("locationStatus").classList.remove("error");
}
function showLocationError(message) {
  byId("locationStatus").textContent = message;
  byId("locationStatus").classList.add("error");
}
function showError(message) {
  byId("detailLoading").hidden = true;
  byId("detailError").hidden = false;
  byId("detailError").textContent = message;
}
function hasCoords(p) {
  return p?.lat != null && p?.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}
function escapeHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

init();
