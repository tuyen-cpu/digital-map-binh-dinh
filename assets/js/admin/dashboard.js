import { api } from "../core/api.js?v=vnpt-16";
import { CATEGORY_META } from "../core/categories.js";

const DEFAULT_CENTER = [13.892, 109.063];
let places = [];
let placeMap = null;
let placeMarker = null;
let boundaryLayer = null;
let currentDetail = null;
let maxImageMb = 8;
let maxPanoramaMb = 20;
const byId = id => document.getElementById(id);
const tableBody = byId("placeTableBody");
const dialog = byId("placeDialog");
const form = byId("placeForm");

async function init() {
  try {
    const [me, mapConfig] = await Promise.all([api("/api/auth/me"), api("/api/map-config").catch(() => ({}))]);
    byId("adminUsername").textContent = me.user.username;
    maxImageMb = Number(mapConfig.maxImageMb || 8);
    maxPanoramaMb = Number(mapConfig.maxPanoramaMb || 20);
    byId("imageLimitText").textContent = `Tối đa ${maxImageMb}MB/ảnh`;
    byId("panoramaLimitText").textContent = `Tối đa ${maxPanoramaMb}MB/ảnh 360`;
  } catch {
    location.replace("/admin");
    return;
  }
  bind();
  await loadPlaces();
}

async function loadPlaces() {
  try {
    const data = await api("/api/admin/places");
    places = data.items || [];
    render();
  } catch (error) {
    if (error.status === 401) return location.replace("/admin");
    alert(error.message);
  }
}

function render() {
  const q = byId("adminSearch").value.trim().toLocaleLowerCase("vi");
  const cat = byId("categoryFilter").value;
  const filtered = places.filter(p =>
    (!cat || p.category === cat) &&
    (!q || `${p.name} ${p.address || ""} ${p.note || ""}`.toLocaleLowerCase("vi").includes(q))
  );

  tableBody.innerHTML = filtered.map(p => `
    <tr>
      <td data-label="Tên"><strong>${esc(p.name)}</strong><small>${esc(p.note || "")}</small></td>
      <td data-label="Danh mục"><span class="badge">${esc(CATEGORY_META[p.category]?.title || p.category)}</span></td>
      <td data-label="Địa chỉ">${esc(p.address || "-")}</td>
      <td data-label="Tọa độ">${hasCoords(p) ? `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` : "-"}</td>
      <td data-label="Nội dung"><div class="content-badges"><span class="source-badge">${Number(p.imageCount || 0)} ảnh</span><span class="source-badge ${Number(p.panoramaCount || 0) ? "has-content" : ""}">${Number(p.panoramaCount || 0)} ảnh 360</span><span class="source-badge ${p.hasArticle ? "has-content" : ""}">${p.hasArticle ? "Có bài viết" : "Chưa có bài"}</span></div></td>
      <td data-label="Trạng thái"><span class="badge ${p.status === "draft" ? "draft" : "published"}">${p.status === "draft" ? "Ẩn" : "Hiển thị"}</span></td>
      <td data-label="Thao tác"><button class="edit-button" data-edit="${esc(p.id)}" type="button">Sửa / nội dung</button></td>
    </tr>
  `).join("");

  byId("tableEmpty").hidden = filtered.length > 0;
  tableBody.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => openEdit(button.dataset.edit)));
  byId("statTotal").textContent = places.length;
  byId("statFood").textContent = places.filter(p => p.category === "amthuc").length;
  byId("statMapped").textContent = places.filter(hasCoords).length;
  byId("statArticle").textContent = places.filter(p => p.hasArticle).length;
}

function hasCoords(place) {
  if (place?.lat === "" || place?.lng === "" || place?.lat == null || place?.lng == null) return false;
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function openNew() {
  currentDetail = null;
  byId("dialogTitle").textContent = "Thêm địa điểm";
  form.reset();
  byId("placeId").value = "";
  byId("placeStatus").value = "published";
  byId("deletePlaceButton").hidden = true;
  byId("placeContentEditor").hidden = true;
  resetContentEditor();
  resetMessage();
  dialog.showModal();
  await ensurePlaceMap();
  setMapCoordinates(null, null, { fitDefault: true });
}

async function openEdit(id) {
  const p = places.find(x => x.id === id);
  if (!p) return;
  fillPlaceForm(p);
  byId("dialogTitle").textContent = "Chỉnh sửa địa điểm";
  byId("deletePlaceButton").hidden = false;
  resetMessage();
  dialog.showModal();
  await ensurePlaceMap();
  setMapCoordinates(p.lat, p.lng, { fitDefault: !hasCoords(p) });
  await loadPlaceContent(id);
}

function fillPlaceForm(p) {
  byId("placeId").value = p.id;
  byId("placeName").value = p.name || "";
  byId("placeCategory").value = p.category;
  byId("placeStatus").value = p.status || "published";
  byId("placeAddress").value = p.address || "";
  byId("placeLat").value = hasCoords(p) ? p.lat : "";
  byId("placeLng").value = hasCoords(p) ? p.lng : "";
  byId("placeNote").value = p.note || "";
  byId("placePhone").value = p.phone || "";
  byId("placeWebsite").value = p.website || "";
  byId("placeOpeningHours").value = p.openingHours || "";
  byId("placePriceRange").value = p.priceRange || "";
}

function payload() {
  return {
    name: byId("placeName").value.trim(),
    category: byId("placeCategory").value,
    status: byId("placeStatus").value,
    address: byId("placeAddress").value.trim(),
    lat: byId("placeLat").value.trim(),
    lng: byId("placeLng").value.trim(),
    note: byId("placeNote").value.trim(),
    phone: byId("placePhone").value.trim(),
    website: byId("placeWebsite").value.trim(),
    openingHours: byId("placeOpeningHours").value.trim(),
    priceRange: byId("placePriceRange").value.trim()
  };
}

async function savePlace(event) {
  event.preventDefault();
  const id = byId("placeId").value;
  const message = byId("placeFormMessage");
  const submit = form.querySelector('button[type="submit"]');
  message.classList.remove("success");
  message.textContent = "Đang lưu...";
  submit.disabled = true;
  try {
    const result = await api(id ? `/api/admin/places/${encodeURIComponent(id)}` : "/api/admin/places", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload())
    });
    const saved = result.item;
    byId("placeId").value = saved.id;
    byId("deletePlaceButton").hidden = false;
    byId("dialogTitle").textContent = "Chỉnh sửa địa điểm";
    message.textContent = id ? "Đã cập nhật địa điểm." : "Đã tạo địa điểm.";
    message.classList.add("success");
    await loadPlaces();
    await loadPlaceContent(saved.id);
  } catch (error) {
    message.textContent = error.message;
    message.classList.remove("success");
  } finally {
    submit.disabled = false;
  }
}

async function loadPlaceContent(id) {
  try {
    currentDetail = await api(`/api/admin/places/${encodeURIComponent(id)}`);
    byId("placeContentEditor").hidden = false;
    byId("detailPreviewLink").href = currentDetail.place.detailUrl;
    renderImages(currentDetail.images || []);
    renderPanoramas(currentDetail.panoramas || []);
    fillArticle(currentDetail.article);
  } catch (error) {
    byId("placeFormMessage").textContent = `Không tải được nội dung địa điểm: ${error.message}`;
  }
}

function resetContentEditor() {
  byId("imageAdminGrid").innerHTML = "";
  byId("placeImageFiles").value = "";
  byId("imageUploadMessage").textContent = "";
  byId("panoramaAdminGrid").innerHTML = "";
  byId("placePanoramaFiles").value = "";
  byId("panoramaUploadMessage").textContent = "";
  fillArticle(null);
}

function renderImages(images) {
  const grid = byId("imageAdminGrid");
  if (!images.length) {
    grid.innerHTML = '<div class="editor-empty">Chưa có hình ảnh.</div>';
    return;
  }
  grid.innerHTML = images.map(image => `
    <article class="image-admin-card" data-image-card="${esc(image.id)}">
      <div class="image-preview-wrap"><img src="${esc(image.url)}" alt="${esc(image.altText || image.caption || "Ảnh địa điểm")}" loading="lazy" /><span class="cover-chip" ${image.isCover ? "" : "hidden"}>Ảnh đại diện</span></div>
      <label><span>Chú thích</span><input data-field="caption" value="${esc(image.caption || "")}" /></label>
      <label><span>Alt text</span><input data-field="altText" value="${esc(image.altText || "")}" /></label>
      <div class="image-meta-row">
        <label><span>Thứ tự</span><input data-field="sortOrder" type="number" value="${Number(image.sortOrder || 0)}" /></label>
        <label class="cover-check"><input data-field="isCover" type="checkbox" ${image.isCover ? "checked" : ""} /><span>Đặt làm ảnh đại diện</span></label>
      </div>
      <div class="image-card-actions"><button class="ghost-button" data-save-image="${esc(image.id)}" type="button">Lưu sửa ảnh</button><button class="danger-button" data-delete-image="${esc(image.id)}" type="button">Xóa ảnh</button></div>
    </article>
  `).join("");
  grid.querySelectorAll("[data-save-image]").forEach(button => button.addEventListener("click", () => saveImageMeta(button.dataset.saveImage)));
  grid.querySelectorAll("[data-delete-image]").forEach(button => button.addEventListener("click", () => deleteImage(button.dataset.deleteImage)));
}

async function uploadImages() {
  const placeId = byId("placeId").value;
  const files = [...byId("placeImageFiles").files];
  const message = byId("imageUploadMessage");
  if (!placeId) return message.textContent = "Vui lòng lưu địa điểm trước.";
  if (!files.length) return message.textContent = "Hãy chọn ít nhất một ảnh.";
  const tooLarge = files.find(file => file.size > maxImageMb * 1024 * 1024);
  if (tooLarge) return message.textContent = `${tooLarge.name} vượt quá ${maxImageMb}MB.`;
  const button = byId("uploadImagesButton");
  button.disabled = true;
  message.classList.remove("success");
  let completed = 0;
  try {
    for (const file of files) {
      message.textContent = `Đang tải ${completed + 1}/${files.length}: ${file.name}`;
      const dataBase64 = await fileToDataUrl(file);
      await api(`/api/admin/places/${encodeURIComponent(placeId)}/images`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64 })
      });
      completed++;
    }
    message.textContent = `Đã tải lên ${completed} ảnh.`;
    message.classList.add("success");
    byId("placeImageFiles").value = "";
    await loadPlaceContent(placeId);
    await loadPlaces();
  } catch (error) {
    message.textContent = `Đã tải ${completed}/${files.length} ảnh. ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function saveImageMeta(imageId) {
  const placeId = byId("placeId").value;
  const card = document.querySelector(`[data-image-card="${cssEsc(imageId)}"]`);
  if (!card) return;
  const button = card.querySelector("[data-save-image]");
  button.disabled = true;
  try {
    await api(`/api/admin/places/${encodeURIComponent(placeId)}/images/${encodeURIComponent(imageId)}`, {
      method: "PUT",
      body: JSON.stringify({
        caption: card.querySelector('[data-field="caption"]').value.trim(),
        altText: card.querySelector('[data-field="altText"]').value.trim(),
        sortOrder: Number(card.querySelector('[data-field="sortOrder"]').value || 0),
        isCover: card.querySelector('[data-field="isCover"]').checked
      })
    });
    await loadPlaceContent(placeId);
    await loadPlaces();
    byId("imageUploadMessage").textContent = "Đã lưu thông tin ảnh.";
    byId("imageUploadMessage").classList.add("success");
  } catch (error) {
    byId("imageUploadMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteImage(imageId) {
  const placeId = byId("placeId").value;
  if (!confirm("Xóa hình ảnh này khỏi địa điểm?")) return;
  try {
    await api(`/api/admin/places/${encodeURIComponent(placeId)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE" });
    await loadPlaceContent(placeId);
    await loadPlaces();
  } catch (error) {
    byId("imageUploadMessage").textContent = error.message;
  }
}

function renderPanoramas(panoramas) {
  const grid = byId("panoramaAdminGrid");
  if (!panoramas.length) {
    grid.innerHTML = '<div class="editor-empty">Chưa có ảnh 360°.</div>';
    return;
  }
  grid.innerHTML = panoramas.map((panorama, index) => `
    <article class="panorama-admin-card" data-panorama-card="${esc(panorama.id)}">
      <div class="panorama-preview-wrap"><img src="${esc(panorama.url)}" alt="${esc(panorama.title || "Ảnh panorama 360")}" loading="lazy" /><span class="panorama-chip">360° #${index + 1}</span></div>
      <label><span>Tiêu đề</span><input data-field="title" value="${esc(panorama.title || "")}" /></label>
      <label><span>Mô tả</span><input data-field="description" value="${esc(panorama.description || "")}" /></label>
      <label class="panorama-replace-field"><span>Thay file ảnh 360 (không bắt buộc)</span><input data-field="replacementFile" type="file" accept="image/jpeg,image/png,image/webp" /><small>File hiện tại: ${esc(panorama.originalName || "panorama")}</small></label>
      <div class="panorama-meta-row">
        <label><span>Thứ tự</span><input data-field="sortOrder" type="number" value="${Number(panorama.sortOrder || 0)}" /></label>
        <label><span>Yaw mở đầu</span><input data-field="initialYaw" type="number" step="1" min="-180" max="180" value="${Number(panorama.initialYaw || 0)}" /></label>
        <label><span>Pitch mở đầu</span><input data-field="initialPitch" type="number" step="1" min="-90" max="90" value="${Number(panorama.initialPitch || 0)}" /></label>
      </div>
      <div class="panorama-card-actions"><button class="ghost-button" data-save-panorama="${esc(panorama.id)}" type="button">Lưu / thay ảnh 360</button><button class="danger-button" data-delete-panorama="${esc(panorama.id)}" type="button">Xóa 360</button></div>
    </article>
  `).join("");
  grid.querySelectorAll("[data-save-panorama]").forEach(button => button.addEventListener("click", () => savePanoramaMeta(button.dataset.savePanorama)));
  grid.querySelectorAll("[data-delete-panorama]").forEach(button => button.addEventListener("click", () => deletePanorama(button.dataset.deletePanorama)));
}

async function uploadPanoramas() {
  const placeId = byId("placeId").value;
  const files = [...byId("placePanoramaFiles").files];
  const message = byId("panoramaUploadMessage");
  if (!placeId) return message.textContent = "Vui lòng lưu địa điểm trước.";
  if (!files.length) return message.textContent = "Hãy chọn ít nhất một ảnh 360.";
  const tooLarge = files.find(file => file.size > maxPanoramaMb * 1024 * 1024);
  if (tooLarge) return message.textContent = `${tooLarge.name} vượt quá ${maxPanoramaMb}MB.`;
  const button = byId("uploadPanoramasButton");
  button.disabled = true;
  message.classList.remove("success");
  let completed = 0;
  try {
    for (const file of files) {
      message.textContent = `Đang tải ảnh 360° ${completed + 1}/${files.length}: ${file.name}`;
      const dataBase64 = await fileToDataUrl(file);
      await api(`/api/admin/places/${encodeURIComponent(placeId)}/panoramas`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64 })
      });
      completed++;
    }
    message.textContent = `Đã tải lên ${completed} ảnh 360°.`;
    message.classList.add("success");
    byId("placePanoramaFiles").value = "";
    await loadPlaceContent(placeId);
    await loadPlaces();
  } catch (error) {
    message.textContent = `Đã tải ${completed}/${files.length} ảnh. ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function savePanoramaMeta(panoramaId) {
  const placeId = byId("placeId").value;
  const card = document.querySelector(`[data-panorama-card="${cssEsc(panoramaId)}"]`);
  if (!card) return;
  const button = card.querySelector("[data-save-panorama]");
  const replacementInput = card.querySelector('[data-field="replacementFile"]');
  const replacementFile = replacementInput?.files?.[0] || null;
  const message = byId("panoramaUploadMessage");

  if (replacementFile && replacementFile.size > maxPanoramaMb * 1024 * 1024) {
    message.textContent = `${replacementFile.name} vượt quá ${maxPanoramaMb}MB.`;
    return;
  }

  button.disabled = true;
  message.classList.remove("success");
  try {
    const payload = {
      title: card.querySelector('[data-field="title"]').value.trim(),
      description: card.querySelector('[data-field="description"]').value.trim(),
      sortOrder: Number(card.querySelector('[data-field="sortOrder"]').value || 0),
      initialYaw: Number(card.querySelector('[data-field="initialYaw"]').value || 0),
      initialPitch: Number(card.querySelector('[data-field="initialPitch"]').value || 0)
    };

    if (replacementFile) {
      if (!/^image\/(jpeg|png|webp)$/i.test(replacementFile.type)) {
        throw new Error("Ảnh 360 thay thế chỉ hỗ trợ JPG, PNG hoặc WEBP.");
      }
      message.textContent = `Đang thay ảnh 360 bằng ${replacementFile.name}...`;
      payload.fileName = replacementFile.name;
      payload.mimeType = replacementFile.type;
      payload.dataBase64 = await fileToDataUrl(replacementFile);
    }

    await api(`/api/admin/places/${encodeURIComponent(placeId)}/panoramas/${encodeURIComponent(panoramaId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await loadPlaceContent(placeId);
    await loadPlaces();
    message.textContent = replacementFile ? "Đã thay ảnh 360 và lưu thông tin." : "Đã lưu thông tin ảnh 360.";
    message.classList.add("success");
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deletePanorama(panoramaId) {
  const placeId = byId("placeId").value;
  if (!confirm("Xóa ảnh panorama 360 này khỏi địa điểm?")) return;
  try {
    await api(`/api/admin/places/${encodeURIComponent(placeId)}/panoramas/${encodeURIComponent(panoramaId)}`, { method: "DELETE" });
    await loadPlaceContent(placeId);
    await loadPlaces();
  } catch (error) {
    byId("panoramaUploadMessage").textContent = error.message;
  }
}

function fillArticle(article) {
  byId("articleTitle").value = article?.title || byId("placeName").value || "";
  byId("articleStatus").value = article?.status || "published";
  byId("articleSummary").value = article?.summary || "";
  byId("articleContent").value = article?.content || "";
  byId("articleExternalUrl").value = article?.externalUrl || "";
  byId("deleteArticleButton").hidden = !article;
  byId("articleMessage").textContent = "";
  byId("articleMessage").classList.remove("success");
}

async function saveArticle() {
  const placeId = byId("placeId").value;
  const message = byId("articleMessage");
  if (!placeId) return message.textContent = "Hãy lưu địa điểm trước.";
  const button = byId("saveArticleButton");
  button.disabled = true;
  message.textContent = "Đang lưu bài viết...";
  message.classList.remove("success");
  try {
    await api(`/api/admin/places/${encodeURIComponent(placeId)}/article`, {
      method: "PUT",
      body: JSON.stringify({
        title: byId("articleTitle").value.trim(),
        status: byId("articleStatus").value,
        summary: byId("articleSummary").value.trim(),
        content: byId("articleContent").value.trim(),
        externalUrl: byId("articleExternalUrl").value.trim()
      })
    });
    message.textContent = "Đã lưu bài giới thiệu.";
    message.classList.add("success");
    await loadPlaceContent(placeId);
    await loadPlaces();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteArticle() {
  const placeId = byId("placeId").value;
  if (!placeId || !confirm("Xóa bài giới thiệu của địa điểm này?")) return;
  try {
    await api(`/api/admin/places/${encodeURIComponent(placeId)}/article`, { method: "DELETE" });
    await loadPlaceContent(placeId);
    await loadPlaces();
    byId("articleMessage").textContent = "Đã xóa bài viết.";
    byId("articleMessage").classList.add("success");
  } catch (error) {
    byId("articleMessage").textContent = error.message;
  }
}

async function deletePlace() {
  const id = byId("placeId").value;
  if (!id || !confirm("Xóa địa điểm này khỏi hệ thống?")) return;
  const button = byId("deletePlaceButton");
  button.disabled = true;
  try {
    await api(`/api/admin/places/${encodeURIComponent(id)}`, { method: "DELETE" });
    dialog.close();
    await loadPlaces();
  } catch (error) {
    byId("placeFormMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function syncOsm() {
  const button = byId("syncButton");
  const message = byId("syncMessage");
  if (!confirm("Khôi phục toàn bộ dữ liệu về trạng thái ban đầu?")) return;
  button.disabled = true;
  message.textContent = "Đang khôi phục dữ liệu...";
  message.classList.remove("success");
  try {
    await api("/api/system/reset", { method: "POST" });
    message.textContent = "Đã khôi phục dữ liệu ban đầu.";
    message.classList.add("success");
    await loadPlaces();
  } catch (error) {
    message.textContent = `Không khôi phục được: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function ensurePlaceMap() {
  if (!window.L) {
    byId("placeMapHint").textContent = "Không tải được bản đồ chọn vị trí. Bạn có thể nhập tọa độ thủ công.";
    return;
  }
  if (placeMap) {
    setTimeout(() => placeMap.invalidateSize(), 0);
    return;
  }

  placeMap = L.map("placeMap", { zoomControl: true, minZoom: 12, maxZoom: 19 }).setView(DEFAULT_CENTER, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(placeMap);
  placeMap.on("click", event => {
    byId("placeLat").value = event.latlng.lat.toFixed(7);
    byId("placeLng").value = event.latlng.lng.toFixed(7);
    setMapCoordinates(event.latlng.lat, event.latlng.lng);
  });

  try {
    const boundary = await api("/api/boundary");
    boundaryLayer = L.geoJSON(boundary, { style: { color: "#0068B5", weight: 2, fillOpacity: 0.05 } }).addTo(placeMap);
    const bounds = boundaryLayer.getBounds();
    if (bounds.isValid()) {
      placeMap.setMaxBounds(bounds.pad(0.12));
      placeMap.fitBounds(bounds.pad(0.03));
    }
  } catch {}
  setTimeout(() => placeMap.invalidateSize(), 0);
}

function setMapCoordinates(latValue, lngValue, { fitDefault = false } = {}) {
  if (!placeMap) return;
  const lat = latValue === "" || latValue == null ? null : Number(latValue);
  const lng = lngValue === "" || lngValue == null ? null : Number(lngValue);
  if (placeMarker) {
    placeMap.removeLayer(placeMarker);
    placeMarker = null;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    placeMarker = L.marker([lat, lng]).addTo(placeMap);
    placeMap.setView([lat, lng], Math.max(placeMap.getZoom(), 16));
    byId("placeMapHint").textContent = `Đang chọn: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  } else {
    byId("placeMapHint").textContent = "Bấm lên bản đồ để chọn đúng vị trí.";
    if (fitDefault && boundaryLayer?.getBounds().isValid()) placeMap.fitBounds(boundaryLayer.getBounds().pad(0.03));
    else if (fitDefault) placeMap.setView(DEFAULT_CENTER, 13);
  }
  setTimeout(() => placeMap.invalidateSize(), 0);
}

function syncMapFromInputs() {
  const lat = byId("placeLat").value.trim();
  const lng = byId("placeLng").value.trim();
  if (!lat && !lng) return setMapCoordinates(null, null);
  if (lat && lng) setMapCoordinates(lat, lng);
}

function clearCoordinates() {
  byId("placeLat").value = "";
  byId("placeLng").value = "";
  setMapCoordinates(null, null, { fitDefault: true });
}

function resetMessage() {
  const message = byId("placeFormMessage");
  message.textContent = "";
  message.classList.remove("success");
}

function bind() {
  byId("newPlaceButton").addEventListener("click", openNew);
  byId("adminSearch").addEventListener("input", render);
  byId("categoryFilter").addEventListener("change", render);
  byId("closeDialogButton").addEventListener("click", () => dialog.close());
  byId("cancelDialogButton").addEventListener("click", () => dialog.close());
  byId("deletePlaceButton").addEventListener("click", deletePlace);
  byId("clearCoordinatesButton").addEventListener("click", clearCoordinates);
  byId("placeLat").addEventListener("change", syncMapFromInputs);
  byId("placeLng").addEventListener("change", syncMapFromInputs);
  byId("uploadImagesButton").addEventListener("click", uploadImages);
  byId("uploadPanoramasButton").addEventListener("click", uploadPanoramas);
  byId("saveArticleButton").addEventListener("click", saveArticle);
  byId("deleteArticleButton").addEventListener("click", deleteArticle);
  form.addEventListener("submit", savePlace);
  byId("syncButton").addEventListener("click", syncOsm);
  byId("logoutButton").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); }
    finally { location.replace("/admin"); }
  });
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { resetMessage(); currentDetail = null; });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function cssEsc(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

init();
