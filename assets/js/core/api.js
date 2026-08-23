const SITE_DB_NAME = "binh-dinh-tourism-netlify-demo-v16";
const SITE_DB_VERSION = 1;
const SITE_SESSION_KEY = "bd_tourism_demo_admin";
const SITE_ROOT = new URL("../../../", import.meta.url);
const SEED_URL = new URL("data/site-data.json", SITE_ROOT).href;
const BOUNDARY_URL = new URL("data/boundary.json", SITE_ROOT).href;
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "BinhDinh@2026";

let dbPromise = null;
let seedPromise = null;
let boundaryPromise = null;

export async function api(path, options = {}) {
  if (!String(path).startsWith("/api/")) return realFetch(path, options);
  await ensureSeeded();
  const url = new URL(path, location.origin);
  const method = String(options.method || "GET").toUpperCase();
  const body = parseBody(options.body);
  return handleSiteApi(url, method, body);
}

async function handleSiteApi(url, method, body) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/api/auth/login" && method === "POST") {
    if (String(body?.username || "") !== ADMIN_USERNAME || String(body?.password || "") !== ADMIN_PASSWORD) {
      fail(401, "Sai tài khoản hoặc mật khẩu.");
    }
    sessionStorage.setItem(SITE_SESSION_KEY, ADMIN_USERNAME);
    return { ok: true, user: { username: ADMIN_USERNAME } };
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    sessionStorage.removeItem(SITE_SESSION_KEY);
    return { ok: true };
  }
  if (pathname === "/api/auth/me" && method === "GET") {
    requireAdmin();
    return { user: { username: ADMIN_USERNAME } };
  }

  if (pathname === "/api/map-config" && method === "GET") {
    return {
      apiKeyRequired: false,
      mapProvider: "map",
      routingProvider: "routing",
      panoramaProvider: "panorama",
      maxImageMb: 8,
      maxPanoramaMb: 20,
    };
  }

  if (pathname === "/api/boundary" && method === "GET") return loadBoundary();

  if (pathname === "/api/geocode" && method === "GET") {
    return geocode(url.searchParams.get("q") || "", url.searchParams.get("scope") || "boundary");
  }

  if (pathname === "/api/route" && method === "GET") {
    return route({
      fromLat: url.searchParams.get("fromLat"),
      fromLng: url.searchParams.get("fromLng"),
      toLat: url.searchParams.get("toLat"),
      toLng: url.searchParams.get("toLng")
    });
  }

  if (pathname === "/api/places" && method === "GET") {
    const items = await listPlaces({
      publicOnly: true,
      category: url.searchParams.get("category") || "",
      q: url.searchParams.get("q") || ""
    });
    return { items, count: items.length };
  }

  const publicDetail = pathname.match(/^\/api\/places\/([^/]+)$/);
  if (publicDetail && method === "GET") {
    return getPlaceDetail(decodeURIComponent(publicDetail[1]), true);
  }

  if (pathname.startsWith("/api/admin/")) requireAdmin();

  if (pathname === "/api/admin/places" && method === "GET") {
    const items = await listPlaces({ publicOnly: false });
    return { items, count: items.length };
  }

  if (pathname === "/api/admin/places" && method === "POST") {
    const item = await createPlace(body || {});
    return { item };
  }

  if (pathname === "/api/admin/import-osm" && method === "POST") {
    fail(501, "Chức năng đồng bộ dữ liệu hiện chưa khả dụng.");
  }

  if (pathname === "/api/system/reset" && method === "POST") {
    requireAdmin();
    await resetSiteData();
    return { ok: true };
  }

  let match = pathname.match(/^\/api\/admin\/places\/([^/]+)$/);
  if (match) {
    const placeId = decodeURIComponent(match[1]);
    if (method === "GET") return getPlaceDetail(placeId, false);
    if (method === "PUT") return { item: await updatePlace(placeId, body || {}) };
    if (method === "DELETE") return deletePlace(placeId);
  }

  match = pathname.match(/^\/api\/admin\/places\/([^/]+)\/images$/);
  if (match && method === "POST") return { image: await addImage(decodeURIComponent(match[1]), body || {}) };

  match = pathname.match(/^\/api\/admin\/places\/([^/]+)\/images\/([^/]+)$/);
  if (match) {
    const placeId = decodeURIComponent(match[1]);
    const imageId = decodeURIComponent(match[2]);
    if (method === "PUT") return { image: await updateImage(placeId, imageId, body || {}) };
    if (method === "DELETE") return deleteImage(placeId, imageId);
  }

  match = pathname.match(/^\/api\/admin\/places\/([^/]+)\/panoramas$/);
  if (match && method === "POST") return { panorama: await addPanorama(decodeURIComponent(match[1]), body || {}) };

  match = pathname.match(/^\/api\/admin\/places\/([^/]+)\/panoramas\/([^/]+)$/);
  if (match) {
    const placeId = decodeURIComponent(match[1]);
    const panoramaId = decodeURIComponent(match[2]);
    if (method === "PUT") return { panorama: await updatePanorama(placeId, panoramaId, body || {}) };
    if (method === "DELETE") return deletePanorama(placeId, panoramaId);
  }

  match = pathname.match(/^\/api\/admin\/places\/([^/]+)\/article$/);
  if (match) {
    const placeId = decodeURIComponent(match[1]);
    if (method === "PUT") return { article: await saveArticle(placeId, body || {}) };
    if (method === "DELETE") return deleteArticle(placeId);
  }

  fail(404, `Không tìm thấy đường dẫn ${pathname}.`);
}

async function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SITE_DB_NAME, SITE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("places")) db.createObjectStore("places", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) {
        const store = db.createObjectStore("images", { keyPath: "id" });
        store.createIndex("placeId", "placeId", { unique: false });
      }
      if (!db.objectStoreNames.contains("panoramas")) {
        const store = db.createObjectStore("panoramas", { keyPath: "id" });
        store.createIndex("placeId", "placeId", { unique: false });
      }
      if (!db.objectStoreNames.contains("articles")) db.createObjectStore("articles", { keyPath: "placeId" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không thể mở dữ liệu hệ thống."));
  });
  return dbPromise;
}

async function ensureSeeded() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const seeded = await idbGet("meta", "seeded");
    if (seeded?.value) return;
    const response = await fetch(SEED_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Không tải được dữ liệu hệ thống.");
    const seed = await response.json();
    for (const place of seed.places || []) await idbPut("places", place);
    for (const image of seed.images || []) await idbPut("images", image);
    for (const panorama of seed.panoramas || []) await idbPut("panoramas", panorama);
    for (const article of seed.articles || []) await idbPut("articles", article);
    await idbPut("meta", { key: "seeded", value: new Date().toISOString() });
  })().catch(error => {
    seedPromise = null;
    throw error;
  });
  return seedPromise;
}

async function resetSiteData() {
  for (const name of ["places", "images", "panoramas", "articles", "meta"]) await idbClear(name);
  seedPromise = null;
  await ensureSeeded();
}

async function listPlaces({ publicOnly = false, category = "", q = "" } = {}) {
  const [places, images, panoramas, articles] = await Promise.all([
    idbGetAll("places"), idbGetAll("images"), idbGetAll("panoramas"), idbGetAll("articles")
  ]);
  const imageByPlace = groupBy(images, "placeId");
  const panoramaByPlace = groupBy(panoramas, "placeId");
  const articleByPlace = new Map(articles.map(article => [article.placeId, article]));
  const needle = String(q || "").trim().toLocaleLowerCase("vi");
  return places
    .filter(place => place.status !== "deleted")
    .filter(place => !publicOnly || place.status === "published")
    .filter(place => !category || place.category === category)
    .filter(place => !needle || `${place.name} ${place.address || ""} ${place.note || ""}`.toLocaleLowerCase("vi").includes(needle))
    .map(place => enrichPlace(place, imageByPlace.get(place.id) || [], panoramaByPlace.get(place.id) || [], articleByPlace.get(place.id)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "vi"));
}

async function getPlaceDetail(placeId, publicOnly) {
  const place = await idbGet("places", placeId);
  if (!place || place.status === "deleted" || (publicOnly && place.status !== "published")) fail(404, "Không tìm thấy địa điểm.");
  const [images, panoramas, article] = await Promise.all([
    idbGetByIndex("images", "placeId", placeId),
    idbGetByIndex("panoramas", "placeId", placeId),
    idbGet("articles", placeId)
  ]);
  const sortedImages = images.sort(sortMedia);
  const sortedPanoramas = panoramas.sort(sortMedia);
  return {
    place: enrichPlace(place, sortedImages, sortedPanoramas, article),
    images: sortedImages,
    panoramas: sortedPanoramas,
    article: publicOnly && article?.status !== "published" ? null : (article || null)
  };
}

async function createPlace(input) {
  const clean = await validatePlace(input);
  let id = slugId(clean.name);
  while (await idbGet("places", id)) id = `${slugId(clean.name)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const item = { ...clean, id, source: "admin", createdAt: now, updatedAt: now, deletedAt: null };
  await idbPut("places", item);
  return enrichPlace(item, [], [], null);
}

async function updatePlace(placeId, input) {
  const current = await idbGet("places", placeId);
  if (!current || current.status === "deleted") fail(404, "Không tìm thấy địa điểm.");
  const clean = await validatePlace({ ...current, ...input });
  const item = { ...current, ...clean, source: current.source || "admin", updatedAt: new Date().toISOString(), deletedAt: null };
  await idbPut("places", item);
  const detail = await getPlaceDetail(placeId, false);
  return detail.place;
}

async function deletePlace(placeId) {
  const current = await idbGet("places", placeId);
  if (!current) fail(404, "Không tìm thấy địa điểm.");
  await idbDelete("places", placeId);
  for (const image of await idbGetByIndex("images", "placeId", placeId)) await idbDelete("images", image.id);
  for (const panorama of await idbGetByIndex("panoramas", "placeId", placeId)) await idbDelete("panoramas", panorama.id);
  await idbDelete("articles", placeId);
  return { ok: true };
}

async function validatePlace(input) {
  const name = cleanText(input.name, 180);
  if (!name) fail(400, "Tên địa điểm là bắt buộc.");
  const categories = new Set(["dulich", "luutru", "amthuc", "giaitri", "suckhoe", "tienich"]);
  const category = String(input.category || "");
  if (!categories.has(category)) fail(400, "Danh mục không hợp lệ.");
  const status = input.status === "draft" ? "draft" : "published";
  const latEmpty = input.lat == null || String(input.lat).trim() === "";
  const lngEmpty = input.lng == null || String(input.lng).trim() === "";
  if (latEmpty !== lngEmpty) fail(400, "Latitude và Longitude phải được nhập đủ cả hai.");
  let lat = null, lng = null;
  if (!latEmpty) {
    lat = Number(input.lat); lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) fail(400, "Tọa độ không hợp lệ.");
    const boundary = await loadBoundary();
    if (!pointInFeature(lat, lng, boundary)) fail(400, "Tọa độ nằm ngoài ranh giới Phường Bình Định.");
  }
  return {
    name,
    category,
    status,
    address: cleanText(input.address, 300),
    lat,
    lng,
    note: cleanText(input.note, 500),
    phone: cleanText(input.phone, 80),
    website: cleanText(input.website, 500),
    openingHours: cleanText(input.openingHours, 200),
    priceRange: cleanText(input.priceRange, 120)
  };
}

async function addImage(placeId, input) {
  const place = await requirePlace(placeId);
  validateImagePayload(input, "Ảnh");
  const current = await idbGetByIndex("images", "placeId", placeId);
  const now = new Date().toISOString();
  const image = {
    id: uid(), placeId, url: String(input.dataBase64), mimeType: String(input.mimeType), originalName: cleanText(input.fileName, 200),
    caption: cleanText(input.caption, 500), altText: cleanText(input.altText, 300) || place.name,
    sortOrder: finiteNumber(input.sortOrder, current.length), isCover: Boolean(input.isCover) || current.length === 0,
    createdAt: now, updatedAt: now
  };
  if (image.isCover) for (const other of current) await idbPut("images", { ...other, isCover: false, updatedAt: now });
  await idbPut("images", image);
  return image;
}

async function updateImage(placeId, imageId, input) {
  await requirePlace(placeId);
  const current = await idbGet("images", imageId);
  if (!current || current.placeId !== placeId) fail(404, "Không tìm thấy hình ảnh.");
  const now = new Date().toISOString();
  const next = {
    ...current,
    caption: input.caption == null ? current.caption : cleanText(input.caption, 500),
    altText: input.altText == null ? current.altText : cleanText(input.altText, 300),
    sortOrder: input.sortOrder == null ? current.sortOrder : finiteNumber(input.sortOrder, current.sortOrder),
    isCover: input.isCover == null ? current.isCover : Boolean(input.isCover),
    updatedAt: now
  };
  if (next.isCover) {
    for (const other of await idbGetByIndex("images", "placeId", placeId)) {
      if (other.id !== imageId && other.isCover) await idbPut("images", { ...other, isCover: false, updatedAt: now });
    }
  }
  await idbPut("images", next);
  return next;
}

async function deleteImage(placeId, imageId) {
  const current = await idbGet("images", imageId);
  if (!current || current.placeId !== placeId) fail(404, "Không tìm thấy hình ảnh.");
  await idbDelete("images", imageId);
  if (current.isCover) {
    const rest = (await idbGetByIndex("images", "placeId", placeId)).sort(sortMedia);
    if (rest[0]) await idbPut("images", { ...rest[0], isCover: true, updatedAt: new Date().toISOString() });
  }
  return { ok: true };
}

async function addPanorama(placeId, input) {
  const place = await requirePlace(placeId);
  validateImagePayload(input, "Ảnh 360");
  const current = await idbGetByIndex("panoramas", "placeId", placeId);
  const now = new Date().toISOString();
  const panorama = {
    id: uid(), placeId, url: String(input.dataBase64), mimeType: String(input.mimeType), originalName: cleanText(input.fileName, 200),
    title: cleanText(input.title, 180) || `${place.name} - 360° ${current.length + 1}`,
    description: cleanText(input.description, 700), sortOrder: finiteNumber(input.sortOrder, current.length),
    initialYaw: clamp(input.initialYaw, -180, 180, 0), initialPitch: clamp(input.initialPitch, -90, 90, 0),
    createdAt: now, updatedAt: now
  };
  await idbPut("panoramas", panorama);
  return panorama;
}

async function updatePanorama(placeId, panoramaId, input) {
  await requirePlace(placeId);
  const current = await idbGet("panoramas", panoramaId);
  if (!current || current.placeId !== placeId) fail(404, "Không tìm thấy ảnh 360.");
  const next = {
    ...current,
    title: input.title == null ? current.title : cleanText(input.title, 180),
    description: input.description == null ? current.description : cleanText(input.description, 700),
    sortOrder: input.sortOrder == null ? current.sortOrder : finiteNumber(input.sortOrder, current.sortOrder),
    initialYaw: input.initialYaw == null ? current.initialYaw : clamp(input.initialYaw, -180, 180, current.initialYaw),
    initialPitch: input.initialPitch == null ? current.initialPitch : clamp(input.initialPitch, -90, 90, current.initialPitch),
    updatedAt: new Date().toISOString()
  };
  if (input.dataBase64) {
    validateImagePayload(input, "Ảnh 360 thay thế");
    next.url = String(input.dataBase64);
    next.mimeType = String(input.mimeType);
    next.originalName = cleanText(input.fileName, 200) || current.originalName;
  }
  await idbPut("panoramas", next);
  return next;
}

async function deletePanorama(placeId, panoramaId) {
  const current = await idbGet("panoramas", panoramaId);
  if (!current || current.placeId !== placeId) fail(404, "Không tìm thấy ảnh 360.");
  await idbDelete("panoramas", panoramaId);
  return { ok: true };
}

async function saveArticle(placeId, input) {
  const place = await requirePlace(placeId);
  const current = await idbGet("articles", placeId);
  const now = new Date().toISOString();
  const article = {
    placeId,
    title: cleanText(input.title, 220) || place.name,
    summary: cleanText(input.summary, 1200),
    content: cleanText(input.content, 30000),
    externalUrl: cleanText(input.externalUrl, 1000),
    status: input.status === "draft" ? "draft" : "published",
    createdAt: current?.createdAt || now,
    updatedAt: now
  };
  await idbPut("articles", article);
  return article;
}

async function deleteArticle(placeId) {
  await idbDelete("articles", placeId);
  return { ok: true };
}

async function geocode(query, scope = "boundary") {
  const q = String(query || "").trim();
  if (q.length < 2) fail(400, "Vui lòng nhập ít nhất 2 ký tự để tìm điểm xuất phát.");
  const allowOutside = String(scope || "boundary").toLowerCase() === "all";
  const boundary = await loadBoundary();
  const local = (await listPlaces({ publicOnly: true }))
    .filter(hasCoords)
    .filter(place => `${place.name} ${place.address || ""}`.toLocaleLowerCase("vi").includes(q.toLocaleLowerCase("vi")))
    .slice(0, allowOutside ? 6 : 5)
    .map(place => ({ id: `local-${place.id}`, name: place.name, label: place.address || place.name, lat: Number(place.lat), lng: Number(place.lng), type: "local" }));

  try {
    const search = new URL("https://nominatim.openstreetmap.org/search");
    search.searchParams.set("q", q);
    search.searchParams.set("format", "jsonv2");
    search.searchParams.set("addressdetails", "1");
    search.searchParams.set("countrycodes", "vn");
    search.searchParams.set("limit", allowOutside ? "10" : "8");
    if (!allowOutside) {
      const [south, west, north, east] = geoJsonBbox(boundary);
      search.searchParams.set("bounded", "1");
      search.searchParams.set("viewbox", `${west},${north},${east},${south}`);
    }
    const response = await fetch(search, { headers: { "accept-language": "vi,en;q=0.8" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const remote = (Array.isArray(json) ? json : []).map(item => {
      const lat = Number(item.lat), lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (!allowOutside && !pointInFeature(lat, lng, boundary)) return null;
      return { id: `nominatim-${item.place_id || `${lat}-${lng}`}`, name: String(item.name || firstLabelPart(item.display_name) || q), label: String(item.display_name || item.name || q), lat, lng, type: String(item.type || item.category || "location") };
    }).filter(Boolean);
    const items = dedupeOrigins([...local, ...remote]).slice(0, allowOutside ? 8 : 5);
    return { items, count: items.length };
  } catch {
    if (local.length) return { items: local, count: local.length };
    fail(503, "Không kết nối được dịch vụ tìm địa chỉ. Hãy thử lại hoặc dùng vị trí hiện tại.");
  }
}

async function route({ fromLat, fromLng, toLat, toLng }) {
  const origin = normalizePoint(fromLat, fromLng, "điểm xuất phát");
  const destination = normalizePoint(toLat, toLng, "điểm đến");
  const boundary = await loadBoundary();
  if (!pointInFeature(destination.lat, destination.lng, boundary)) fail(400, "Điểm đến nằm ngoài phạm vi Phường Bình Định.");
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const providers = ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"];
  let json = null;
  for (const base of providers) {
    try {
      const url = new URL(`${base}/route/v1/driving/${coordinates}`);
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("steps", "true");
      url.searchParams.set("alternatives", "false");
      const response = await fetch(url, { headers: { "accept-language": "vi,en;q=0.8" } });
      if (!response.ok) continue;
      const candidate = await response.json();
      if (candidate?.code === "Ok" && candidate?.routes?.[0]?.geometry?.coordinates?.length) { json = candidate; break; }
    } catch {}
  }
  if (!json) fail(503, "Tạm thời chưa tính được tuyến đường. Vui lòng thử lại sau.");
  const found = json.routes[0];
  const rawSteps = (found.legs || []).flatMap(leg => leg.steps || []);
  return {
    profile: "driving",
    distanceMeters: Number(found.distance || 0),
    durationSeconds: Number(found.duration || 0),
    geometry: found.geometry,
    steps: rawSteps.map((step, index) => ({
      index: index + 1,
      instruction: makeInstruction(step, index, rawSteps.length),
      road: String(step.name || ""),
      distanceMeters: Number(step.distance || 0),
      durationSeconds: Number(step.duration || 0),
      maneuver: step.maneuver || {}
    }))
  };
}

async function requirePlace(placeId) {
  const place = await idbGet("places", placeId);
  if (!place || place.status === "deleted") fail(404, "Không tìm thấy địa điểm.");
  return place;
}

function enrichPlace(place, images, panoramas, article) {
  const sortedImages = [...images].sort(sortMedia);
  const cover = sortedImages.find(image => image.isCover) || sortedImages[0];
  return {
    ...place,
    coverImage: cover?.url || "",
    imageCount: images.length,
    panoramaCount: panoramas.length,
    hasArticle: Boolean(article && article.status === "published"),
    detailUrl: `/place.html?id=${encodeURIComponent(place.id)}`
  };
}

function validateImagePayload(input, label) {
  const mimeType = String(input?.mimeType || "").toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) fail(400, `${label} chỉ hỗ trợ JPG, PNG hoặc WEBP.`);
  const data = String(input?.dataBase64 || "");
  if (!data.startsWith("data:image/")) fail(400, `${label} không có dữ liệu hợp lệ.`);
}

function requireAdmin() {
  if (sessionStorage.getItem(SITE_SESSION_KEY) !== ADMIN_USERNAME) fail(401, "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.");
}

async function loadBoundary() {
  if (!boundaryPromise) boundaryPromise = fetch(BOUNDARY_URL, { cache: "force-cache" }).then(response => {
    if (!response.ok) throw new Error("Không tải được ranh giới bản đồ.");
    return response.json();
  });
  return boundaryPromise;
}

function pointInFeature(lat, lng, feature) {
  const geometry = feature?.geometry;
  if (!geometry) return true;
  if (geometry.type === "Polygon") return pointInPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some(polygon => pointInPolygon(lng, lat, polygon));
  return true;
}

function pointInPolygon(x, y, rings) {
  if (!rings?.length || !pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function geoJsonBbox(feature) {
  const coords = [];
  walkCoordinates(feature?.geometry?.coordinates, coords);
  if (!coords.length) return [13.84, 109.02, 13.94, 109.15];
  const lats = coords.map(c => c[1]), lngs = coords.map(c => c[0]);
  return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)];
}
function walkCoordinates(value, out) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) { out.push([Number(value[0]), Number(value[1])]); return; }
  for (const child of value) walkCoordinates(child, out);
}

function makeInstruction(step, index, total) {
  const maneuver = step.maneuver || {};
  const type = String(maneuver.type || "").toLowerCase();
  const modifier = String(maneuver.modifier || "").toLowerCase();
  const road = String(step.name || "").trim();
  const roadSuffix = road ? ` vào ${road}` : "";
  if (type === "depart" || index === 0) return road ? `Bắt đầu và đi theo ${road}` : "Bắt đầu hành trình";
  if (type === "arrive" || index === total - 1) return "Đến địa điểm";
  if (type === "roundabout" || type === "rotary") {
    const exit = Number(maneuver.exit);
    return Number.isFinite(exit) && exit > 0 ? `Vào vòng xuyến, đi ra ở lối thứ ${exit}${roadSuffix}` : `Đi qua vòng xuyến${roadSuffix}`;
  }
  if (type === "fork") return `${turnLabel(modifier, "Đi theo nhánh")}${roadSuffix}`;
  if (type === "merge") return `${turnLabel(modifier, "Nhập làn")}${roadSuffix}`;
  if (type === "end of road") return `${turnLabel(modifier, "Đến cuối đường, rẽ")}${roadSuffix}`;
  if (type === "new name") return road ? `Tiếp tục vào ${road}` : "Tiếp tục đi thẳng";
  if (type === "continue") return `${turnLabel(modifier, "Tiếp tục")}${roadSuffix}`;
  if (type === "turn") return `${turnLabel(modifier, "Rẽ")}${roadSuffix}`;
  return road ? `Tiếp tục theo ${road}` : "Tiếp tục theo tuyến đường";
}
function turnLabel(modifier, prefix) {
  const labels = { uturn: "quay đầu", "sharp right": "chếch gấp sang phải", right: "phải", "slight right": "chếch phải", straight: "thẳng", "slight left": "chếch trái", left: "trái", "sharp left": "chếch gấp sang trái" };
  const direction = labels[modifier];
  if (!direction) return prefix;
  if (prefix === "Tiếp tục" && direction === "thẳng") return "Tiếp tục đi thẳng";
  return `${prefix} ${direction}`;
}

function normalizePoint(latValue, lngValue, label) {
  const lat = Number(latValue), lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) fail(400, `Tọa độ ${label} không hợp lệ.`);
  return { lat, lng };
}
function hasCoords(place) { return place?.lat != null && place?.lng != null && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)); }
function cleanText(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function finiteNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function uid() { return crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function slugId(value) { const s = String(value || "dia-diem").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70); return s || `dia-diem-${Date.now()}`; }
function firstLabelPart(value) { return String(value || "").split(",")[0].trim(); }
function groupBy(items, key) { const map = new Map(); for (const item of items) { const k = item[key]; if (!map.has(k)) map.set(k, []); map.get(k).push(item); } return map; }
function sortMedia(a, b) { if (Boolean(a.isCover) !== Boolean(b.isCover)) return a.isCover ? -1 : 1; return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")); }
function dedupeOrigins(items) { const seen = new Set(); return items.filter(item => { const key = `${Number(item.lat).toFixed(5)}:${Number(item.lng).toFixed(5)}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function parseBody(body) { if (body == null || body === "") return null; if (typeof body === "object") return body; try { return JSON.parse(body); } catch { return null; } }
function fail(status, message) { throw Object.assign(new Error(message), { status, data: { message } }); }

async function realFetch(path, options) {
  const response = await fetch(path, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) fail(response.status, data?.message || `HTTP ${response.status}`);
  return data;
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
async function idbGetByIndex(storeName, indexName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).index(indexName).getAll(key);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}
async function idbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
async function idbClear(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
