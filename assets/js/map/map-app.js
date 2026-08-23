import { api } from "../core/api.js?v=vnpt-16";
import { CATEGORY_META } from "../core/categories.js";
import { loadBoundary, drawBoundary } from "./boundary.js?v=vnpt-16";

const CENTER = [13.8932, 109.0680];

let map, markerLayer, boundaryLayer, boundaryMaskLayer, boundaryGeo, routeLayerGroup, navigationLayerGroup, userLocationLayer;
let selectedCategory = "dulich", showAll = false, allPlaces = [], requestSeq = 0;
let selectedPlace = null, panoramaViewer = null, activeRoute = null;
let navigationWatchId = null, navigationMarker = null, navigationAccuracy = null;
let searchRenderTimer = null;
let detectedLocation = null, journeyOrigin = null, journeyDestination = null, journeyOriginSearchTimer = null, journeyDestinationSearchTimer = null;
let routeShowsOutsideBoundary = false;
const markerById = new Map();

const ids = [
  "categoryTitle","categoryDescription","categoryGrid","resultList","resultCount","showAllButton","refreshCategoryButton","regionDataButton","searchInput","clearSearchButton","zoomInButton","zoomOutButton","locateButton","resetViewButton","boundaryStatus","boundaryStatusText","toast","menuButton","dataState","map","mapPanel","panelDrag","panelContent","mapPanelCloseButton","mapPanelOpenButton","placePreview","closePlacePreview","previewImageWrap","previewImage","previewCategory","previewName","previewAddress","previewDescription","previewFacts","previewDetailLink","previewRouteButton","previewPanoramaButton","panoramaDialog","closePanoramaButton","panoramaTitle","panoramaStatus","panoramaCanvas","routeDialog","closeRouteDialog","routeDestinationName","routeDialogDrag","useCurrentLocationButton","routeOriginInput","searchRouteOriginButton","routeOriginResults","routeDialogStatus","routeSummary","routeSummaryDrag","closeRouteSummary","routeSummaryTitle","routeSummaryOrigin","routeDistance","routeDuration","routeNavigationStatus","toggleRouteSteps","startNavigationButton","routeSteps","journeyDialog","closeJourneyDialog","journeyLocationTitle","journeyLocationText","journeyUseCurrentButton","journeyCurrentLabel","journeyOriginInput","journeySearchOriginButton","journeyOriginResults","journeyDestinationInput","journeyDestinationResults","journeyStatus","journeyExploreButton","journeyStartButton"
];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.toast.classList.remove("show"), 3200);
}

function setDataState(text, loading = false) {
  el.dataState.classList.toggle("loading", loading);
  el.dataState.querySelector("span:last-child").textContent = text;
}

async function init() {
  bindUI();
  initMap();
  await initBoundary();

  const hasRouteRequest = !!new URLSearchParams(location.search).get("routeTo");
  const placesPromise = loadAll();

  // Yêu cầu quyền vị trí ngay khi mở trang; tải dữ liệu địa điểm tiếp tục song song.
  if (!hasRouteRequest) requestInitialLocation();

  await placesPromise;
  if (hasRouteRequest) await openRouteFromQuery();
  else if (el.journeyDialog?.open) renderJourneyDestinations(el.journeyDestinationInput?.value || "");
}

function initMap() {
  if (!window.L) {
    el.map.innerHTML = '<div style="padding:24px">Không tải được bản đồ. Vui lòng thử lại sau.</div>';
    return;
  }
  map = L.map("map", { zoomControl: false, minZoom: 12, maxZoom: 19, maxBoundsViscosity: 1 }).setView(CENTER, 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  routeLayerGroup = L.layerGroup().addTo(map);
  navigationLayerGroup = L.layerGroup().addTo(map);
  userLocationLayer = L.layerGroup().addTo(map);
  map.on("click", () => {
    closeMobileMenu();
    if (!activeRoute && !el.routeDialog?.open && !el.panoramaDialog?.open) {
      hidePlacePreview({ clearSelection: true });
      if (isMobileMap() && mobileSheetState !== "hidden") setMobileSheetState("collapsed");
    }
  });
}

async function initBoundary() {
  try {
    boundaryGeo = await loadBoundary();
    if (map) {
      const result = drawBoundary(map, boundaryGeo);
      boundaryLayer = result.boundaryLayer;
      boundaryMaskLayer = result.maskLayer;
      syncMobileSheetPosition();
      el.boundaryStatus.classList.toggle("ready", !result.isFallback);
      el.boundaryStatusText.textContent = result.isFallback ? "Đang dùng ranh giới dự phòng Phường Bình Định" : "Đã hiển thị ranh giới Phường Bình Định";
    } else {
      el.boundaryStatusText.textContent = "Đã tải dữ liệu ranh giới; bản đồ nền chưa sẵn sàng";
    }
  } catch {
    el.boundaryStatusText.textContent = "Không tải được ranh giới; đang giữ vùng xem mặc định";
  }
}


function geolocationAvailable() {
  return !!navigator.geolocation && (window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1");
}

function requestInitialLocation() {
  if (!geolocationAvailable()) {
    openJourneyAssistant({ message: "Chưa thể lấy vị trí tự động. Bạn có thể nhập điểm xuất phát và chọn nơi muốn đến." });
    return;
  }
  el.locateButton?.classList.add("locating");
  navigator.geolocation.getCurrentPosition(position => {
    el.locateButton?.classList.remove("locating");
    handleDetectedLocation(position, { initial: true });
  }, error => {
    el.locateButton?.classList.remove("locating");
    const message = error.code === 1
      ? "Bạn chưa cấp quyền vị trí. Hãy nhập điểm xuất phát hoặc cho phép định vị trên trình duyệt."
      : "Chưa xác định được vị trí của bạn. Bạn có thể nhập điểm xuất phát để bắt đầu.";
    openJourneyAssistant({ message });
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
}

function handleDetectedLocation(position, { initial = false } = {}) {
  const lat = Number(position?.coords?.latitude), lng = Number(position?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  detectedLocation = { lat, lng, label: "Vị trí hiện tại" };
  const inside = !boundaryGeo || pointInsideBoundary(lat, lng);
  if (inside) {
    setBoundaryRouteMode(false);
    renderUserLocation(detectedLocation);
    if (map) map.flyTo([lat, lng], 16, { duration: isMobileMap() ? .35 : .55 });
    if (isMobileMap()) setMobileSheetState("collapsed");
    el.searchInput.placeholder = "Bạn muốn đi đâu?";
    toast(initial ? "Đã xác định vị trí của bạn. Bạn muốn đi đâu?" : "Đã xác định vị trí hiện tại.");
    return;
  }
  userLocationLayer?.clearLayers();
  openJourneyAssistant({ origin: detectedLocation, outside: true });
}

function renderUserLocation(origin) {
  if (!map || !window.L || !origin) return;
  userLocationLayer?.clearLayers();
  const here = L.latLng(origin.lat, origin.lng);
  L.circle(here, { radius: 35, stroke: false, fillColor: "#00AEEF", fillOpacity: .12 }).addTo(userLocationLayer);
  L.circleMarker(here, { radius: 8, weight: 3, color: "#fff", fillColor: "#00AEEF", fillOpacity: 1 })
    .bindTooltip("Vị trí của bạn", { direction: "top", offset: [0,-8] }).addTo(userLocationLayer);
}

function openJourneyAssistant({ origin = null, outside = false, message = "" } = {}) {
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  closeDialogIfOpen(el.panoramaDialog);
  hidePlacePreview({ clearSelection: true });
  if (activeRoute) clearRoute({ restoreSheet: false });
  if (isMobileMap()) setMobileSheetState("hidden");
  journeyOrigin = origin || null;
  journeyDestination = null;
  el.journeyOriginInput.value = "";
  el.journeyDestinationInput.value = "";
  el.journeyOriginResults.replaceChildren();
  el.journeyDestinationResults.replaceChildren();
  if (origin) {
    el.journeyLocationTitle.textContent = outside ? "Bạn đang ở ngoài Phường Bình Định" : "Đã xác định vị trí của bạn";
    el.journeyLocationText.textContent = outside ? "Bạn vẫn có thể bắt đầu dẫn đường từ vị trí hiện tại đến một địa điểm trong Phường Bình Định." : "Chọn nơi bạn muốn đến để bắt đầu.";
    el.journeyCurrentLabel.textContent = outside ? "Đã lấy vị trí · ngoài Phường Bình Định" : "Đã lấy vị trí hiện tại";
    el.journeyUseCurrentButton.classList.add("selected");
  } else {
    el.journeyLocationTitle.textContent = "Chọn điểm bắt đầu hành trình";
    el.journeyLocationText.textContent = message || "Nhập điểm xuất phát và địa điểm bạn muốn đến.";
    el.journeyCurrentLabel.textContent = geolocationAvailable() ? "Chạm để lấy vị trí của thiết bị" : "Định vị chưa sẵn sàng";
    el.journeyUseCurrentButton.classList.remove("selected");
  }
  el.journeyStatus.textContent = message;
  renderJourneyDestinations("");
  updateJourneyStartButton();
  if (!el.journeyDialog.open) el.journeyDialog.showModal();
}

function updateJourneyStartButton() {
  el.journeyStartButton.disabled = !(journeyOrigin && journeyDestination && hasCoords(journeyDestination));
}

function renderJourneyDestinations(query = "") {
  const q = String(query || "").trim().toLocaleLowerCase("vi");
  const items = allPlaces
    .filter(hasCoords)
    .filter(p => !boundaryGeo || pointInsideBoundary(Number(p.lat), Number(p.lng)))
    .filter(p => !q || `${p.name} ${p.address || ""}`.toLocaleLowerCase("vi").includes(q))
    .slice(0, 7);
  if (!items.length) {
    el.journeyDestinationResults.innerHTML = '<div class="journey-empty">Không tìm thấy địa điểm phù hợp trong Phường Bình Định.</div>';
    return;
  }
  el.journeyDestinationResults.innerHTML = items.map(p => `
    <button type="button" data-journey-destination="${escapeHtml(p.id)}">
      ${p.coverImage ? `<img src="${escapeHtml(p.coverImage)}" alt="" loading="lazy" />` : `<span class="journey-result-pin">⌖</span>`}
      <span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.address || "Phường Bình Định")}</small></span><span>›</span>
    </button>`).join("");
  el.journeyDestinationResults.querySelectorAll("[data-journey-destination]").forEach(button => button.addEventListener("click", () => {
    const place = allPlaces.find(p => p.id === button.dataset.journeyDestination);
    if (!place) return;
    journeyDestination = place;
    el.journeyDestinationInput.value = place.name;
    el.journeyDestinationResults.replaceChildren();
    el.journeyStatus.textContent = `Điểm đến: ${place.name}`;
    updateJourneyStartButton();
  }));
}

async function searchJourneyOrigin() {
  const q = el.journeyOriginInput.value.trim();
  if (q.length < 2) {
    el.journeyStatus.textContent = "Hãy nhập ít nhất 2 ký tự để tìm điểm xuất phát.";
    return;
  }
  el.journeyStatus.textContent = "Đang tìm điểm xuất phát...";
  el.journeyOriginResults.replaceChildren();
  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(q)}&scope=all`);
    const items = data.items || [];
    if (!items.length) {
      el.journeyStatus.textContent = "Không tìm thấy điểm xuất phát. Hãy thử tên đường hoặc địa danh khác.";
      return;
    }
    el.journeyOriginResults.innerHTML = items.map(item => `
      <button type="button" data-journey-origin="${escapeHtml(item.id)}"><span class="journey-result-pin">◎</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.label)}</small></span><span>›</span></button>`).join("");
    const byId = new Map(items.map(item => [item.id, item]));
    el.journeyOriginResults.querySelectorAll("[data-journey-origin]").forEach(button => button.addEventListener("click", () => {
      const item = byId.get(button.dataset.journeyOrigin);
      if (!item) return;
      journeyOrigin = { lat: Number(item.lat), lng: Number(item.lng), label: item.label || item.name };
      el.journeyOriginInput.value = item.label || item.name;
      el.journeyOriginResults.replaceChildren();
      el.journeyUseCurrentButton.classList.remove("selected");
      el.journeyStatus.textContent = "Đã chọn điểm xuất phát.";
      updateJourneyStartButton();
    }));
  } catch (error) {
    el.journeyStatus.textContent = error.message;
  }
}

function useCurrentLocationForJourney() {
  if (detectedLocation) {
    journeyOrigin = { ...detectedLocation };
    el.journeyOriginInput.value = "";
    el.journeyOriginResults.replaceChildren();
    el.journeyUseCurrentButton.classList.add("selected");
    el.journeyCurrentLabel.textContent = pointInsideBoundary(detectedLocation.lat, detectedLocation.lng) ? "Đã lấy vị trí hiện tại" : "Đã lấy vị trí · ngoài Phường Bình Định";
    el.journeyStatus.textContent = "Đã chọn vị trí hiện tại làm điểm xuất phát.";
    updateJourneyStartButton();
    return;
  }
  if (!geolocationAvailable()) {
    el.journeyStatus.textContent = "Không thể sử dụng định vị trên kết nối hiện tại. Hãy nhập điểm xuất phát.";
    return;
  }
  el.journeyCurrentLabel.textContent = "Đang lấy vị trí...";
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
    detectedLocation = { lat, lng, label: "Vị trí hiện tại" };
    journeyOrigin = { ...detectedLocation };
    el.journeyUseCurrentButton.classList.add("selected");
    el.journeyCurrentLabel.textContent = pointInsideBoundary(lat, lng) ? "Đã lấy vị trí hiện tại" : "Đã lấy vị trí · ngoài Phường Bình Định";
    el.journeyStatus.textContent = "Đã chọn vị trí hiện tại làm điểm xuất phát.";
    updateJourneyStartButton();
  }, () => {
    el.journeyCurrentLabel.textContent = "Không lấy được vị trí";
    el.journeyStatus.textContent = "Hãy cấp quyền vị trí hoặc nhập điểm xuất phát.";
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 });
}

async function startJourneyFromAssistant() {
  if (!journeyOrigin) return void (el.journeyStatus.textContent = "Hãy chọn điểm xuất phát.");
  if (!journeyDestination || !hasCoords(journeyDestination)) return void (el.journeyStatus.textContent = "Hãy chọn một địa điểm muốn đến.");
  selectedPlace = journeyDestination;
  closeDialogIfOpen(el.journeyDialog);
  await calculateRoute(journeyOrigin);
}

function setBoundaryRouteMode(showOutside) {
  if (!map || !boundaryLayer) return;
  routeShowsOutsideBoundary = !!showOutside;
  const bounds = boundaryLayer.getBounds();
  if (showOutside) {
    try { map.setMaxBounds([[-85, -180], [85, 180]]); } catch {}
    map.setMinZoom(5);
    if (boundaryMaskLayer && map.hasLayer(boundaryMaskLayer)) map.removeLayer(boundaryMaskLayer);
    return;
  }
  if (boundaryMaskLayer && !map.hasLayer(boundaryMaskLayer)) boundaryMaskLayer.addTo(map);
  if (bounds.isValid()) {
    map.setMaxBounds(bounds.pad(.05));
    map.setMinZoom(Math.max(12, map.getBoundsZoom(bounds, false) - 1));
  }
}

async function selectCategory(category, { refresh = false } = {}) {
  if (!CATEGORY_META[category]) return;
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  closeDialogIfOpen(el.panoramaDialog);
  hidePlacePreview({ clearSelection: true });
  if (activeRoute) clearRoute({ restoreSheet: false });
  selectedCategory = category;
  showAll = false;
  syncCategoryUI();
  const seq = ++requestSeq;
  setDataState("Đang tải dữ liệu...", true);
  try {
    const local = await api(`/api/places?category=${encodeURIComponent(category)}&live=0`);
    if (seq !== requestSeq) return;
    allPlaces = local.items || [];
    render();
    const visible = getVisiblePlaces();
    const mapped = visible.filter(hasCoords).length;
    setDataState(`Đã tải ${visible.length} địa điểm · ${mapped} điểm có tọa độ`, false);
  } catch (error) {
    setDataState("Không tải được dữ liệu", false);
    toast(error.message);
  }
}

async function hydrateLive(category, seq, refresh = false) {
  try {
    const live = await api(`/api/places?category=${encodeURIComponent(category)}&live=1${refresh ? "&refresh=1" : ""}`);
    if (seq !== requestSeq || selectedCategory !== category || showAll) return;
    allPlaces = live.items || [];
    render();
    const visible = getVisiblePlaces();
    const mapped = visible.filter(hasCoords).length;
    setDataState(`Đã tải ${visible.length} địa điểm · ${mapped} điểm có tọa độ`, false);
  } catch {
    if (seq === requestSeq) setDataState(`Đã tải ${allPlaces.length} địa điểm`, false);
  }
}

async function loadAll() {
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  closeDialogIfOpen(el.panoramaDialog);
  hidePlacePreview({ clearSelection: true });
  if (activeRoute) clearRoute({ restoreSheet: false });
  showAll = true;
  requestSeq++;
  document.querySelectorAll(".category-card").forEach(b => b.classList.remove("active"));
  el.categoryTitle.textContent = "Tất cả địa điểm";
  el.categoryDescription.textContent = "Khám phá toàn bộ địa điểm hiện có trên bản đồ.";
  el.showAllButton.textContent = "Quay lại danh mục";
  setDataState("Đang tải tất cả dữ liệu...", true);
  try {
    const results = await Promise.all(Object.keys(CATEGORY_META).map(c => api(`/api/places?category=${c}&live=0`)));
    allPlaces = dedupe(results.flatMap(r => r.items || []));
    render();
    setDataState(`Đã tải ${getVisiblePlaces().length} địa điểm`, false);
  } catch (error) {
    setDataState("Không tải được dữ liệu", false);
    toast(error.message);
  }
}

function syncCategoryUI() {
  document.querySelectorAll(".category-card").forEach(b => b.classList.toggle("active", b.dataset.category === selectedCategory));
  const meta = CATEGORY_META[selectedCategory];
  el.categoryTitle.textContent = meta.title;
  el.categoryDescription.textContent = meta.description;
  el.showAllButton.textContent = "Hiển thị tất cả";
}

function dedupe(items) {
  const m = new Map();
  for (const p of items) {
    const key = p.id || `${p.name}|${p.address}`;
    if (!m.has(key)) m.set(key, p);
  }
  return [...m.values()];
}

function getVisiblePlaces() {
  const q = el.searchInput.value.trim().toLocaleLowerCase("vi");
  return allPlaces
    .filter(p => !hasCoords(p) || !boundaryGeo || pointInsideBoundary(Number(p.lat), Number(p.lng)))
    .filter(p => !q || `${p.name} ${p.address || ""} ${p.note || ""}`.toLocaleLowerCase("vi").includes(q));
}

function render() {
  const items = getVisiblePlaces();
  if (markerLayer) {
    markerLayer.clearLayers();
    markerById.clear();
    for (const p of items) {
      if (!hasCoords(p)) continue;
      const marker = L.marker([Number(p.lat), Number(p.lng)], { icon: markerIcon(p.category) });
      marker.on("click", () => showPlacePreview(p));
      marker.addTo(markerLayer);
      markerById.set(p.id, marker);
    }
  }
  renderList(items);
  el.resultCount.textContent = String(items.length);
  if (selectedPlace && !activeRoute && !items.some(p => p.id === selectedPlace.id)) hidePlacePreview();
}

function renderList(items) {
  if (!items.length) {
    el.resultList.innerHTML = '<div class="empty-results">Chưa có địa điểm phù hợp.</div>';
    return;
  }
  el.resultList.innerHTML = items.map(p => `
    <button class="result-item ${hasCoords(p) ? "" : "no-coordinates"}" type="button" data-place-id="${escapeHtml(p.id)}">
      ${p.coverImage ? `<span class="result-thumb"><img src="${escapeHtml(p.coverImage)}" alt="Ảnh ${escapeHtml(p.name)}" loading="lazy" /></span>` : `<span class="result-pin">${CATEGORY_META[p.category]?.icon || "•"}</span>`}
      <span class="result-copy"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.address || "Phường Bình Định")}</small>${p.note ? `<span class="result-description">${escapeHtml(p.note)}</span>` : ""}<span class="result-meta">${p.openingHours ? `<span class="source-pill">${escapeHtml(p.openingHours)}</span>` : ""}${p.priceRange ? `<span class="source-pill">${escapeHtml(p.priceRange)}</span>` : ""}${Number(p.imageCount || 0) ? `<span class="source-pill">${Number(p.imageCount)} ảnh</span>` : ""}${Number(p.panoramaCount || 0) ? `<span class="source-pill">${Number(p.panoramaCount)} ảnh 360°</span>` : ""}${hasCoords(p) ? "" : '<span class="source-pill">Đang cập nhật vị trí</span>'}</span></span>
      <span class="result-arrow">›</span>
    </button>
  `).join("");
  el.resultList.querySelectorAll("[data-place-id]").forEach(btn => btn.addEventListener("click", () => focusPlace(btn.dataset.placeId)));
}

function markerIcon(category) {
  return L.divIcon({ className: "", html: `<div class="map-marker ${category}"><span>${CATEGORY_META[category]?.icon || "•"}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 34], popupAnchor: [0, -30] });
}

function hasCoords(p) {
  if (p?.lat == null || p?.lng == null || p.lat === "" || p.lng === "") return false;
  const lat = Number(p.lat), lng = Number(p.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function focusPlace(id) {
  const p = allPlaces.find(x => x.id === id);
  if (!p) return;
  showPlacePreview(p);
  if (!hasCoords(p)) return toast("Địa điểm này chưa xác định vị trí trên bản đồ.");
  const marker = markerById.get(id);
  if (!map || !marker) return;
  map.flyTo([Number(p.lat), Number(p.lng)], Math.max(map.getZoom(), 16), { duration: isMobileMap() ? .28 : .55 });
  setTimeout(() => marker.openPopup(), isMobileMap() ? 220 : 420);
}

function showPlacePreview(p) {
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  closeDialogIfOpen(el.panoramaDialog);
  if (activeRoute) clearRoute({ restoreSheet: false });
  selectedPlace = p;
  if (isMobileMap()) setMobileSheetState("collapsed");
  el.previewCategory.textContent = CATEGORY_META[p.category]?.title || p.category || "Địa điểm";
  el.previewName.textContent = p.name || "Địa điểm";
  el.previewAddress.textContent = p.address || "Phường Bình Định";
  el.previewDescription.textContent = p.note || "";
  el.previewDescription.hidden = !p.note;
  const facts = [];
  if (p.openingHours) facts.push(`<span>◷ ${escapeHtml(p.openingHours)}</span>`);
  if (p.priceRange) facts.push(`<span>₫ ${escapeHtml(p.priceRange)}</span>`);
  if (p.phone) facts.push(`<span>☎ ${escapeHtml(p.phone)}</span>`);
  el.previewFacts.innerHTML = facts.join("");
  el.previewFacts.hidden = !facts.length;
  if (p.coverImage) {
    el.previewImage.src = p.coverImage;
    el.previewImage.alt = `Ảnh ${p.name}`;
    el.previewImageWrap.hidden = false;
  } else {
    el.previewImage.removeAttribute("src");
    el.previewImageWrap.hidden = true;
  }
  if (p.detailUrl) {
    el.previewDetailLink.href = p.detailUrl;
    el.previewDetailLink.hidden = false;
  } else {
    el.previewDetailLink.hidden = true;
  }
  el.previewRouteButton.disabled = !hasCoords(p);
  el.previewRouteButton.textContent = hasCoords(p) ? "Dẫn đường" : "Chưa có tọa độ";
  const panoramaCount = Number(p.panoramaCount || 0);
  el.previewPanoramaButton.disabled = panoramaCount < 1;
  el.previewPanoramaButton.textContent = panoramaCount ? `Tour 360° (${panoramaCount})` : "Chưa có 360°";
  el.placePreview.hidden = false;
}

function hidePlacePreview({ clearSelection = true, restoreSheet = false } = {}) {
  if (clearSelection) selectedPlace = null;
  el.placePreview.hidden = true;
  if (restoreSheet && isMobileMap() && mobileSheetState === "hidden") setMobileSheetState("default");
}

function openRoutePlanner() {
  const p = selectedPlace;
  closeMobileMenu();
  closeDialogIfOpen(el.panoramaDialog);
  if (!p || !hasCoords(p)) return toast("Địa điểm này chưa có tọa độ để dẫn đường.");
  el.routeDestinationName.textContent = p.name;
  el.routeOriginInput.value = "";
  el.routeOriginResults.replaceChildren();
  el.routeDialogStatus.textContent = "";
  el.routeDialogStatus.classList.remove("error");
  hidePlacePreview({ clearSelection: false });
  if (isMobileMap()) setMobileSheetState("hidden");
  if (!el.routeDialog.open) {
    el.routeDialog.setAttribute("aria-modal", "false");
    el.routeDialog.show();
  }
  setTimeout(() => el.routeOriginInput.focus({ preventScroll: true }), 80);
}

async function routeFromCurrentLocation() {
  if (detectedLocation) return calculateRoute({ ...detectedLocation });
  if (!geolocationAvailable()) return setRouteDialogError("Không thể lấy vị trí trên kết nối hiện tại. Hãy nhập điểm xuất phát.");
  setRouteDialogBusy("Đang lấy vị trí hiện tại...");
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
    detectedLocation = { lat, lng, label: "Vị trí hiện tại" };
    await calculateRoute({ ...detectedLocation });
  }, error => {
    const message = error.code === 1 ? "Bạn chưa cấp quyền vị trí cho trình duyệt." : "Không lấy được vị trí hiện tại. Hãy thử lại hoặc nhập điểm xuất phát.";
    setRouteDialogError(message);
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

async function searchRouteOrigin() {
  const q = el.routeOriginInput.value.trim();
  if (q.length < 2) return setRouteDialogError("Hãy nhập ít nhất 2 ký tự.");
  setRouteDialogBusy("Đang tìm điểm xuất phát...");
  el.routeOriginResults.replaceChildren();
  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(q)}&scope=all`);
    const items = data.items || [];
    if (!items.length) {
      setRouteDialogIdle("Không tìm thấy điểm xuất phát phù hợp. Hãy thử tên đường hoặc địa danh khác.");
      return;
    }
    setRouteDialogIdle("Chọn đúng điểm xuất phát bên dưới:");
    el.routeOriginResults.innerHTML = items.map(item => `
      <button type="button" data-origin-id="${escapeHtml(item.id)}">
        <span class="route-result-pin">◎</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.label)}</small></span>
        <span>›</span>
      </button>
    `).join("");
    const byId = new Map(items.map(item => [item.id, item]));
    el.routeOriginResults.querySelectorAll("[data-origin-id]").forEach(button => button.addEventListener("click", () => {
      const item = byId.get(button.dataset.originId);
      if (item) calculateRoute({ lat: item.lat, lng: item.lng, label: item.label || item.name });
    }));
  } catch (error) {
    setRouteDialogError(error.message);
  }
}

async function calculateRoute(origin) {
  const destination = selectedPlace;
  if (!destination || !hasCoords(destination)) return setRouteDialogError("Điểm đến chưa có tọa độ.");
  const fromLat = Number(origin.lat), fromLng = Number(origin.lng);
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng)) return setRouteDialogError("Điểm xuất phát không hợp lệ.");
  if (boundaryGeo && !pointInsideBoundary(Number(destination.lat), Number(destination.lng))) return setRouteDialogError("Điểm đến nằm ngoài phạm vi Phường Bình Định.");

  setRouteDialogBusy("Đang tính tuyến đường...");
  try {
    const data = await api(`/api/route?fromLat=${encodeURIComponent(fromLat)}&fromLng=${encodeURIComponent(fromLng)}&toLat=${encodeURIComponent(destination.lat)}&toLng=${encodeURIComponent(destination.lng)}`);
    stopNavigation();
    activeRoute = { data, origin: { ...origin, lat: fromLat, lng: fromLng }, destination };
    drawRoute(activeRoute);
    renderRouteSummary(activeRoute);
    closeDialogIfOpen(el.routeDialog);
    hidePlacePreview({ clearSelection: true });
    if (isMobileMap()) setMobileSheetState("hidden");
    toast("Đã tạo tuyến đường trên bản đồ.");
  } catch (error) {
    setRouteDialogError(error.message);
  }
}

function drawRoute(routeState) {
  if (!map || !window.L) return;
  const originOutside = !!(boundaryGeo && !pointInsideBoundary(Number(routeState.origin.lat), Number(routeState.origin.lng)));
  setBoundaryRouteMode(originOutside);
  routeLayerGroup?.clearLayers();
  const coords = routeState.data?.geometry?.coordinates || [];
  const latLngs = coords.map(([lng, lat]) => [Number(lat), Number(lng)]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!latLngs.length) return;

  const line = L.polyline(latLngs, { color: "#0068B5", weight: 7, opacity: .92, lineCap: "round", lineJoin: "round" }).addTo(routeLayerGroup);
  L.polyline(latLngs, { color: "#ffffff", weight: 3, opacity: .75, lineCap: "round", lineJoin: "round" }).addTo(routeLayerGroup);
  L.circleMarker([routeState.origin.lat, routeState.origin.lng], { radius: 8, weight: 3, color: "#ffffff", fillColor: "#00AEEF", fillOpacity: 1 }).bindTooltip("Điểm xuất phát").addTo(routeLayerGroup);
  L.circleMarker([Number(routeState.destination.lat), Number(routeState.destination.lng)], { radius: 9, weight: 3, color: "#ffffff", fillColor: "#0068B5", fillOpacity: 1 }).bindTooltip(routeState.destination.name || "Điểm đến").addTo(routeLayerGroup);
  map.fitBounds(line.getBounds(), { padding: [55, 55], maxZoom: 17, animate: true, duration: .6 });
}

function renderRouteSummary(routeState) {
  const { data, origin, destination } = routeState;
  el.routeSummaryTitle.textContent = destination.name || "Điểm đến";
  el.routeSummaryOrigin.textContent = `Từ: ${origin.label || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}`;
  el.routeDistance.textContent = formatDistance(data.distanceMeters);
  el.routeDuration.textContent = formatDuration(data.durationSeconds);
  el.routeSteps.hidden = true;
  el.toggleRouteSteps.textContent = "Xem từng chặng";
  const steps = (data.steps || []).filter(step => step.instruction);
  el.routeSteps.innerHTML = steps.map(step => `<li><span>${escapeHtml(step.instruction)}</span><small>${formatDistance(step.distanceMeters)}</small></li>`).join("");
  el.routeNavigationStatus.hidden = true;
  el.routeNavigationStatus.textContent = "";
  el.startNavigationButton.textContent = "Theo dõi vị trí";
  el.routeSummary.hidden = false;
  if (isMobileMap()) setMobileSheetState("hidden");
  requestAnimationFrame(() => resetRouteSummarySheet());
}

function clearRoute({ restoreSheet = true } = {}) {
  stopNavigation();
  activeRoute = null;
  routeLayerGroup?.clearLayers();
  el.routeSummary.hidden = true;
  resetRouteSummarySheet();
  setBoundaryRouteMode(false);
  if (restoreSheet && isMobileMap()) setMobileSheetState("default");
}

function setRouteDialogBusy(message) {
  el.routeDialogStatus.textContent = message;
  el.routeDialogStatus.classList.remove("error");
  el.useCurrentLocationButton.disabled = true;
  el.searchRouteOriginButton.disabled = true;
  setTimeout(() => {
    if (!el.routeDialog.open) return;
    el.useCurrentLocationButton.disabled = false;
    el.searchRouteOriginButton.disabled = false;
  }, 12000);
}

function setRouteDialogIdle(message = "") {
  el.routeDialogStatus.textContent = message;
  el.routeDialogStatus.classList.remove("error");
  el.useCurrentLocationButton.disabled = false;
  el.searchRouteOriginButton.disabled = false;
}

function setRouteDialogError(message) {
  el.routeDialogStatus.textContent = message;
  el.routeDialogStatus.classList.add("error");
  el.useCurrentLocationButton.disabled = false;
  el.searchRouteOriginButton.disabled = false;
}

async function openRouteFromQuery() {
  const id = new URLSearchParams(location.search).get("routeTo");
  if (!id) return false;
  try {
    const detail = await api(`/api/places/${encodeURIComponent(id)}`);
    const place = detail.place;
    if (!place || !hasCoords(place)) { toast("Địa điểm cần dẫn đường chưa có tọa độ."); return false; }
    if (CATEGORY_META[place.category] && place.category !== selectedCategory) await selectCategory(place.category);
    showPlacePreview(place);
    if (map) map.flyTo([Number(place.lat), Number(place.lng)], 16, { duration: .5 });
    openRoutePlanner();
    return true;
  } catch (error) {
    toast(error.message || "Không mở được địa điểm cần dẫn đường.");
    return false;
  }
}

async function openPanoramaTour() {
  const p = selectedPlace;
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  if (activeRoute) clearRoute({ restoreSheet: false });
  if (!p) return;
  el.panoramaTitle.textContent = `Tour 360° · ${p.name}`;
  el.panoramaStatus.textContent = "Đang tải không gian 360°...";
  el.panoramaStatus.hidden = false;
  el.panoramaCanvas.replaceChildren();
  hidePlacePreview({ clearSelection: false });
  if (isMobileMap()) setMobileSheetState("hidden");
  if (!el.panoramaDialog.open) el.panoramaDialog.showModal();
  try {
    const detail = await api(`/api/places/${encodeURIComponent(p.id)}`);
    const panoramas = [...(detail.panoramas || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    if (!panoramas.length) {
      el.panoramaStatus.textContent = "Không gian 360° của địa điểm đang được cập nhật.";
      return;
    }
    if (!window.pannellum) throw new Error("Không tải được không gian 360°. Vui lòng thử lại sau.");
    panoramaViewer?.destroy?.();
    panoramaViewer = window.pannellum.viewer("panoramaCanvas", makePanoramaTourConfig(p, panoramas));
    el.panoramaStatus.hidden = true;
    setTimeout(() => panoramaViewer?.resize?.(), 80);
  } catch (error) {
    el.panoramaStatus.hidden = false;
    el.panoramaStatus.textContent = error.message;
  }
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

function resetView() {
  if (!map) return;
  closeMobileMenu();
  closeDialogIfOpen(el.routeDialog);
  closeDialogIfOpen(el.panoramaDialog);
  hidePlacePreview({ clearSelection: true });
  clearRoute();
  if (boundaryLayer) map.fitBounds(boundaryLayer.getBounds().pad(.025), { animate: true, duration: .55, padding: [25, 25] });
  else map.setView(CENTER, 14);
}

function showRegionData() {
  if (!map) return toast("Bản đồ nền chưa sẵn sàng.");
  const within = getVisiblePlaces().filter(p => hasCoords(p) && map.getBounds().contains([Number(p.lat), Number(p.lng)]));
  toast(`Có ${within.length} địa điểm trong khu vực đang xem.`);
}

function locate() {
  if (!geolocationAvailable()) return toast("Không thể sử dụng định vị trên kết nối hiện tại.");
  el.locateButton?.classList.add("locating");
  navigator.geolocation.getCurrentPosition(pos => {
    el.locateButton?.classList.remove("locating");
    handleDetectedLocation(pos, { initial: false });
  }, () => {
    el.locateButton?.classList.remove("locating");
    toast("Không lấy được vị trí. Hãy cấp quyền định vị.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
}

function pointInsideBoundary(lat, lng) {
  const geometry = boundaryGeo?.geometry;
  if (!geometry || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const pointInRing = ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  };
  const pointInPolygon = polygon => {
    if (!polygon?.[0]?.length || !pointInRing(polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) if (pointInRing(polygon[i])) return false;
    return true;
  };
  if (geometry.type === "Polygon") return pointInPolygon(geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some(pointInPolygon);
  return false;
}

const MOBILE_MAP_BREAKPOINT = 980;
let mobileSheetState = "default";
let sheetFrame = 0;
let pendingSheetHeight = null;

function isMobileMap() {
  return window.innerWidth <= MOBILE_MAP_BREAKPOINT;
}

function getViewportHeight() {
  return Math.max(360, Math.round(window.visualViewport?.height || window.innerHeight || 720));
}

function getMobileSheetSnaps() {
  const vh = getViewportHeight();
  const collapsed = Math.max(104, Math.min(126, vh * .15));
  const normal = Math.max(220, Math.min(300, vh * .34));
  const expanded = Math.max(normal + 100, Math.min(vh * .76, vh - 82));
  return { collapsed, default: normal, expanded };
}

function commitMobileSheetHeight(px, state = mobileSheetState) {
  if (!el.mapPanel || !isMobileMap()) return;
  const snaps = getMobileSheetSnaps();
  const max = snaps.expanded;
  const height = Math.max(68, Math.min(max, Number(px) || snaps.default));
  el.mapPanel.style.setProperty("--sheet-height", `${Math.round(height)}px`);
  document.querySelector(".map-shell")?.style.setProperty("--mobile-sheet-height", state === "hidden" ? "0px" : `${Math.round(height)}px`);
}

function setMobileSheetHeight(px, state = mobileSheetState) {
  if (!isMobileMap()) return;
  pendingSheetHeight = { px, state };
  if (sheetFrame) return;
  sheetFrame = requestAnimationFrame(() => {
    sheetFrame = 0;
    const next = pendingSheetHeight;
    pendingSheetHeight = null;
    if (next) commitMobileSheetHeight(next.px, next.state);
  });
}

function setMobileSheetState(state = "default") {
  if (!el.mapPanel) return;
  mobileSheetState = state;
  el.mapPanel.dataset.sheetState = state;
  const hidden = state === "hidden";
  el.mapPanel.classList.toggle("sheet-hidden", hidden);
  if (el.mapPanelOpenButton) el.mapPanelOpenButton.hidden = !hidden;
  if (!isMobileMap()) {
    el.mapPanel.style.removeProperty("--sheet-height");
    document.querySelector(".map-shell")?.style.removeProperty("--mobile-sheet-height");
    return;
  }
  if (hidden) {
    document.querySelector(".map-shell")?.style.setProperty("--mobile-sheet-height", "0px");
    return;
  }
  const snaps = getMobileSheetSnaps();
  setMobileSheetHeight(snaps[state] || snaps.default, state);
}

function syncMobileSheetPosition() {
  if (!el.mapPanel) return;
  if (!isMobileMap()) return setMobileSheetState("default");
  setMobileSheetState(mobileSheetState || "default");
}

function bindMobileSheet() {
  if (!el.panelDrag || !el.mapPanel) return;
  let startY = 0;
  let startHeight = 0;
  let moved = false;
  let lastY = 0;

  const finish = event => {
    if (!el.panelDrag.hasPointerCapture?.(event.pointerId)) return;
    el.panelDrag.releasePointerCapture(event.pointerId);
    el.mapPanel.classList.remove("dragging");
    const current = el.mapPanel.getBoundingClientRect().height;
    const snaps = getMobileSheetSnaps();
    const downward = event.clientY - startY;
    if (downward > 115 && current < snaps.collapsed + 45) {
      setMobileSheetState("hidden");
      return;
    }
    if (!moved) {
      setMobileSheetState(mobileSheetState === "expanded" ? "default" : "expanded");
      return;
    }
    const choices = [
      ["collapsed", snaps.collapsed],
      ["default", snaps.default],
      ["expanded", snaps.expanded]
    ];
    choices.sort((a, b) => Math.abs(a[1] - current) - Math.abs(b[1] - current));
    setMobileSheetState(choices[0][0]);
  };

  el.panelDrag.addEventListener("pointerdown", event => {
    if (!isMobileMap()) return;
    startY = lastY = event.clientY;
    startHeight = el.mapPanel.getBoundingClientRect().height;
    moved = false;
    el.panelDrag.setPointerCapture(event.pointerId);
    el.mapPanel.classList.add("dragging");
  });
  el.panelDrag.addEventListener("pointermove", event => {
    if (!el.panelDrag.hasPointerCapture?.(event.pointerId) || !isMobileMap()) return;
    const delta = startY - event.clientY;
    lastY = event.clientY;
    if (Math.abs(delta) > 4) moved = true;
    setMobileSheetHeight(startHeight + delta, "dragging");
  });
  el.panelDrag.addEventListener("pointerup", finish);
  el.panelDrag.addEventListener("pointercancel", finish);
  setMobileSheetState("default");
}

// Drag-to-dismiss cho routeDialog trên mobile
// Bottom-sheet drag cho routeDialog trên mobile
// Trạng thái: "expanded" (full) ↔ "collapsed" (chỉ còn handle nhô lên ở đáy)
// Kéo lên từ collapsed → expanded; kéo xuống từ expanded → collapsed
function bindRouteDialogDrag() {
  const handle = el.routeDialogDrag;
  const dialog = el.routeDialog;
  if (!handle || !dialog) return;

  // Chiều cao phần nhô lên khi collapsed (chỉ drag handle)
  const PEEK_HEIGHT = 48;
  // Ngưỡng delta để snap (px)
  const SNAP_THRESHOLD = 60;

  let routeSheetState = "expanded"; // "expanded" | "collapsed"
  let startY = 0;
  let startTranslate = 0;
  let moved = false;

  // Tính translateY tương ứng với từng trạng thái
  const getTranslateForState = state => {
    if (state === "expanded") return 0;
    // collapsed: trượt xuống sao cho chỉ còn PEEK_HEIGHT nhô lên
    return dialog.getBoundingClientRect().height - PEEK_HEIGHT;
  };

  const snapTo = (state, animate = true) => {
    routeSheetState = state;
    const y = getTranslateForState(state);
    if (animate) {
      dialog.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
    } else {
      dialog.style.transition = "none";
    }
    dialog.style.transform = `translateY(${y}px)`;
    if (state === "collapsed") {
      dialog.classList.add("dragging-dismiss");
      dialog.classList.add("route-collapsed");
    } else {
      dialog.classList.remove("dragging-dismiss");
      dialog.classList.remove("route-collapsed");
    }
    // Cập nhật aria để screen reader biết trạng thái
    handle.setAttribute("aria-label", state === "expanded" ? "Thu nhỏ hộp dẫn đường" : "Mở rộng hộp dẫn đường");
  };

  const finish = event => {
    if (!handle.hasPointerCapture?.(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);

    const delta = event.clientY - startY;

    if (!moved) {
      // Tap đơn → toggle
      snapTo(routeSheetState === "expanded" ? "collapsed" : "expanded");
      return;
    }

    // Snap dựa theo hướng kéo và ngưỡng
    if (routeSheetState === "expanded" && delta > SNAP_THRESHOLD) {
      snapTo("collapsed");
    } else if (routeSheetState === "collapsed" && delta < -SNAP_THRESHOLD) {
      snapTo("expanded");
    } else {
      // Chưa đủ ngưỡng → snap về trạng thái cũ
      snapTo(routeSheetState);
    }
  };

  handle.addEventListener("pointerdown", event => {
    if (window.innerWidth > 980) return;
    startY = event.clientY;
    moved = false;
    // Đọc translate hiện tại làm điểm bắt đầu
    const m = new DOMMatrix(getComputedStyle(dialog).transform);
    startTranslate = m.m42; // translateY
    dialog.classList.add("dragging-dismiss");
    dialog.style.transition = "none";
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", event => {
    if (!handle.hasPointerCapture?.(event.pointerId) || window.innerWidth > 980) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 4) moved = true;

    const dialogH = dialog.getBoundingClientRect().height;
    const maxDown = dialogH - PEEK_HEIGHT; // không cho trượt thấp hơn collapsed
    const newY = Math.min(maxDown, Math.max(-6, startTranslate + delta));
    dialog.style.transform = `translateY(${newY}px)`;
  });

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", event => {
    if (!handle.hasPointerCapture?.(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    snapTo(routeSheetState); // snap về trạng thái hiện tại
  });

  // Khi dialog mở: luôn bắt đầu ở expanded
  dialog.addEventListener("close", () => {
    routeSheetState = "expanded";
    dialog.style.transform = "";
    dialog.style.transition = "";
    dialog.classList.remove("dragging-dismiss");
    dialog.classList.remove("route-collapsed");
  });
}

let resetRouteSummarySheet = () => {};

function bindRouteSummaryDrag() {
  const handle = el.routeSummaryDrag;
  const sheet = el.routeSummary;
  if (!handle || !sheet) return;

  const PEEK_HEIGHT = 48;
  const SNAP_THRESHOLD = 60;

  let sheetState = "expanded";
  let startY = 0;
  let startTranslate = 0;
  let moved = false;

  const getTranslateForState = state => {
    if (state === "expanded") return 0;
    return Math.max(0, sheet.getBoundingClientRect().height - PEEK_HEIGHT);
  };

  const snapTo = (state, animate = true) => {
    sheetState = state;
    const y = isMobileMap() ? getTranslateForState(state) : 0;
    sheet.style.transition = animate ? "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)" : "none";
    sheet.style.transform = y ? `translateY(${y}px)` : "";
    sheet.classList.toggle("dragging-dismiss", state === "collapsed" && isMobileMap());
    sheet.classList.toggle("route-summary-collapsed", state === "collapsed" && isMobileMap());
    handle.setAttribute("aria-label", state === "expanded" ? "Thu nhỏ bảng dẫn đường" : "Mở rộng bảng dẫn đường");
  };

  resetRouteSummarySheet = () => {
    sheetState = "expanded";
    sheet.style.transform = "";
    sheet.style.transition = "";
    sheet.classList.remove("dragging-dismiss", "route-summary-collapsed");
    handle.setAttribute("aria-label", "Thu nhỏ bảng dẫn đường");
  };

  const finish = event => {
    if (!handle.hasPointerCapture?.(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    if (!isMobileMap()) return resetRouteSummarySheet();

    const delta = event.clientY - startY;
    if (!moved) {
      snapTo(sheetState === "expanded" ? "collapsed" : "expanded");
      return;
    }
    if (sheetState === "expanded" && delta > SNAP_THRESHOLD) snapTo("collapsed");
    else if (sheetState === "collapsed" && delta < -SNAP_THRESHOLD) snapTo("expanded");
    else snapTo(sheetState);
  };

  handle.addEventListener("pointerdown", event => {
    if (!isMobileMap() || sheet.hidden) return;
    startY = event.clientY;
    moved = false;
    const m = new DOMMatrix(getComputedStyle(sheet).transform);
    startTranslate = m.m42;
    sheet.classList.add("dragging-dismiss");
    sheet.style.transition = "none";
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", event => {
    if (!handle.hasPointerCapture?.(event.pointerId) || !isMobileMap()) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 4) moved = true;
    const maxDown = Math.max(0, sheet.getBoundingClientRect().height - PEEK_HEIGHT);
    sheet.style.transform = `translateY(${Math.min(maxDown, Math.max(-6, startTranslate + delta))}px)`;
  });

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", event => {
    if (!handle.hasPointerCapture?.(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    snapTo(sheetState);
  });

  window.addEventListener("resize", () => {
    if (!isMobileMap()) resetRouteSummarySheet();
  }, { passive: true });
}

function closeMobileMenu() {
  const header = document.querySelector(".site-header");
  header?.classList.remove("menu-open");
  el.menuButton?.setAttribute("aria-expanded", "false");
}

function closeDialogIfOpen(dialog) {
  if (dialog?.open) dialog.close();
}

function bindDialogBackdropClose(dialog) {
  dialog?.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
}

function startNavigation() {
  if (!activeRoute) return toast("Hãy tạo tuyến đường trước.");
  if (!navigator.geolocation) return toast("Trình duyệt không hỗ trợ định vị.");
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return toast("Cần kết nối HTTPS để theo dõi vị trí.");
  el.startNavigationButton.textContent = "Dừng theo dõi";
  el.routeNavigationStatus.hidden = false;
  el.routeNavigationStatus.textContent = "Đang xác định vị trí của bạn...";
  navigationWatchId = navigator.geolocation.watchPosition(updateNavigationPosition, () => {
    el.routeNavigationStatus.hidden = false;
    el.routeNavigationStatus.textContent = "Không cập nhật được vị trí. Hãy kiểm tra quyền định vị.";
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
}

function stopNavigation() {
  if (navigationWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(navigationWatchId);
  navigationWatchId = null;
  navigationLayerGroup?.clearLayers();
  navigationMarker = null;
  navigationAccuracy = null;
  if (el.startNavigationButton) el.startNavigationButton.textContent = "Theo dõi vị trí";
  if (el.routeNavigationStatus) {
    el.routeNavigationStatus.hidden = true;
    el.routeNavigationStatus.textContent = "";
  }
}

function updateNavigationPosition(pos) {
  if (!activeRoute || !map || !window.L) return;
  const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const here = L.latLng(lat, lng);
  navigationLayerGroup?.clearLayers();
  navigationAccuracy = L.circle(here, { radius: Math.max(8, Number(pos.coords.accuracy || 0)), stroke: false, fillColor: "#00AEEF", fillOpacity: .12 }).addTo(navigationLayerGroup);
  navigationMarker = L.circleMarker(here, { radius: 8, weight: 3, color: "#fff", fillColor: "#00AEEF", fillOpacity: 1 }).addTo(navigationLayerGroup);
  map.panTo(here, { animate: true, duration: .35 });
  const next = findNearestRouteStep(lat, lng, activeRoute.data?.steps || []);
  const remaining = haversineMeters(lat, lng, Number(activeRoute.destination.lat), Number(activeRoute.destination.lng));
  el.routeNavigationStatus.hidden = false;
  el.routeNavigationStatus.innerHTML = `<strong>${escapeHtml(next?.instruction || "Tiếp tục theo tuyến trên bản đồ")}</strong><span>Còn khoảng ${escapeHtml(formatDistance(remaining))} đến điểm đến</span>`;
}

function findNearestRouteStep(lat, lng, steps) {
  let best = null;
  let bestDistance = Infinity;
  for (const step of steps) {
    const location = step?.maneuver?.location;
    if (!Array.isArray(location) || location.length < 2) continue;
    const distance = haversineMeters(lat, lng, Number(location[1]), Number(location[0]));
    if (distance < bestDistance) { bestDistance = distance; best = step; }
  }
  return best;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = value => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(value) {
  const meters = Number(value || 0);
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

function formatDuration(value) {
  const minutes = Math.max(1, Math.round(Number(value || 0) / 60));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

function bindUI() {
  el.categoryGrid.addEventListener("click", e => { const b = e.target.closest(".category-card"); if (b) selectCategory(b.dataset.category); });
  el.showAllButton.addEventListener("click", () => showAll ? selectCategory(selectedCategory) : loadAll());
  el.refreshCategoryButton.addEventListener("click", () => { if (showAll) return toast("Hãy chọn một danh mục trước khi làm mới dữ liệu."); selectCategory(selectedCategory, { refresh: true }); });
  el.regionDataButton.addEventListener("click", showRegionData);
  el.zoomInButton.addEventListener("click", () => map?.zoomIn());
  el.zoomOutButton.addEventListener("click", () => map?.zoomOut());
  el.locateButton.addEventListener("click", locate);
  el.resetViewButton.addEventListener("click", resetView);
  el.closePlacePreview.addEventListener("click", () => { hidePlacePreview({ clearSelection: true }); if (isMobileMap()) setMobileSheetState("default"); });
  el.previewRouteButton.addEventListener("click", openRoutePlanner);
  el.previewPanoramaButton.addEventListener("click", openPanoramaTour);
  el.closePanoramaButton.addEventListener("click", () => closeDialogIfOpen(el.panoramaDialog));
  el.panoramaDialog.addEventListener("close", () => {
    panoramaViewer?.destroy?.();
    panoramaViewer = null;
    el.panoramaCanvas.replaceChildren();
    if (isMobileMap() && !activeRoute) setMobileSheetState("default");
  });
  bindDialogBackdropClose(el.panoramaDialog);
  el.closeRouteDialog.addEventListener("click", () => closeDialogIfOpen(el.routeDialog));
  el.useCurrentLocationButton.addEventListener("click", routeFromCurrentLocation);
  el.searchRouteOriginButton.addEventListener("click", searchRouteOrigin);
  el.routeOriginInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchRouteOrigin(); } });
  el.routeDialog.addEventListener("close", () => {
    el.useCurrentLocationButton.disabled = false;
    el.searchRouteOriginButton.disabled = false;
    if (isMobileMap() && !activeRoute) setMobileSheetState("default");
  });
  el.closeJourneyDialog?.addEventListener("click", () => closeDialogIfOpen(el.journeyDialog));
  el.journeyUseCurrentButton?.addEventListener("click", useCurrentLocationForJourney);
  el.journeySearchOriginButton?.addEventListener("click", searchJourneyOrigin);
  el.journeyOriginInput?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchJourneyOrigin(); } });
  el.journeyOriginInput?.addEventListener("input", () => {
    journeyOrigin = null;
    el.journeyUseCurrentButton?.classList.remove("selected");
    updateJourneyStartButton();
    clearTimeout(journeyOriginSearchTimer);
    const q = el.journeyOriginInput.value.trim();
    if (q.length >= 3) journeyOriginSearchTimer = setTimeout(searchJourneyOrigin, 420);
    else el.journeyOriginResults?.replaceChildren();
  });
  el.journeyDestinationInput?.addEventListener("input", () => {
    journeyDestination = null;
    updateJourneyStartButton();
    clearTimeout(journeyDestinationSearchTimer);
    journeyDestinationSearchTimer = setTimeout(() => renderJourneyDestinations(el.journeyDestinationInput.value), 120);
  });
  el.journeyDestinationInput?.addEventListener("focus", () => renderJourneyDestinations(el.journeyDestinationInput.value));
  el.journeyStartButton?.addEventListener("click", startJourneyFromAssistant);
  el.journeyExploreButton?.addEventListener("click", () => {
    closeDialogIfOpen(el.journeyDialog);
    setBoundaryRouteMode(false);
    if (boundaryLayer && map) map.fitBounds(boundaryLayer.getBounds().pad(.025), { animate: true, duration: .4, padding: [20,20] });
    if (isMobileMap()) setMobileSheetState("default");
  });
  el.journeyDialog?.addEventListener("close", () => {
    if (isMobileMap() && !activeRoute) setMobileSheetState("default");
  });
  bindDialogBackdropClose(el.journeyDialog);
  el.closeRouteSummary.addEventListener("click", clearRoute);
  el.toggleRouteSteps.addEventListener("click", () => {
    const nextHidden = !el.routeSteps.hidden;
    el.routeSteps.hidden = nextHidden;
    el.toggleRouteSteps.textContent = nextHidden ? "Xem từng chặng" : "Ẩn từng chặng";
  });
  el.startNavigationButton.addEventListener("click", () => navigationWatchId == null ? startNavigation() : stopNavigation());
  bindMobileSheet();
  bindRouteDialogDrag();
  bindRouteSummaryDrag();
  el.mapPanelCloseButton?.addEventListener("click", () => setMobileSheetState("hidden"));
  el.mapPanelOpenButton?.addEventListener("click", () => {
    closeMobileMenu();
    closeDialogIfOpen(el.routeDialog);
    closeDialogIfOpen(el.panoramaDialog);
    hidePlacePreview({ clearSelection: true });
    if (activeRoute) clearRoute({ restoreSheet: false });
    setMobileSheetState("default");
  });
  window.addEventListener("resize", syncMobileSheetPosition, { passive: true });
  window.visualViewport?.addEventListener("resize", syncMobileSheetPosition, { passive: true });
  el.searchInput.addEventListener("input", () => {
    el.clearSearchButton.classList.toggle("visible", !!el.searchInput.value);
    clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(render, 120);
  });
  el.clearSearchButton.addEventListener("click", () => { el.searchInput.value = ""; el.clearSearchButton.classList.remove("visible"); render(); el.searchInput.focus(); });
  el.menuButton.addEventListener("click", event => {
    event.stopPropagation();
    const expanded = el.menuButton.getAttribute("aria-expanded") === "true";
    el.menuButton.setAttribute("aria-expanded", String(!expanded));
    document.querySelector(".site-header")?.classList.toggle("menu-open", !expanded);
  });
  document.querySelectorAll(".main-nav a").forEach(link => link.addEventListener("click", closeMobileMenu));
  document.addEventListener("click", event => {
    const header = document.querySelector(".site-header");
    if (header?.classList.contains("menu-open") && !header.contains(event.target)) closeMobileMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeMobileMenu();
    if (el.routeDialog?.open || el.panoramaDialog?.open) return;
    if (!el.routeSummary.hidden) return clearRoute();
    if (!el.placePreview.hidden) { hidePlacePreview({ clearSelection: true }); if (isMobileMap()) setMobileSheetState("default"); }
  });
}

function escapeHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

init();
