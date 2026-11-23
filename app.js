/* =========================================================
   CKEM Int'l Digital Hymnal
   IndexedDB + Batched Pagination + Offline PWA + 3D UI
   ========================================================= */

const DB_NAME = "ckem_intl_hymnal_db";
const DB_VERSION = 1;
const STORE_HYMNS = "hymns";
const FAVS_KEY = "ckem_intl_favs_v1";
const THEME_KEY = "ckem_intl_theme_v1";
const FONT_SCALE_KEY = "ckem_intl_font_scale_v1";
const PAGE_SIZE = 36;

let db = null;
let allHymns = [];
let filteredHymns = [];
let renderedCount = 0;
let favorites = new Set();
let activeCategory = "ALL";
let searchQuery = "";
let activeHymnId = null;
let fontScale = 1;
let wakeLock = null;

const hymnGrid = document.getElementById("hymnGrid");
const emptyState = document.getElementById("emptyState");
const resultsCountLabel = document.getElementById("resultsCountLabel");
const totalHymnsBadge = document.getElementById("totalHymnsBadge");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const categoryTabs = document.getElementById("categoryTabs");

const hymnListView = document.getElementById("hymnListView");
const hymnReaderView = document.getElementById("hymnReaderView");
const readerPageCard = document.getElementById("readerPageCard");

// Create Load More button dynamically below hymnGrid
const loadMoreWrap = document.createElement("div");
loadMoreWrap.id = "loadMoreWrap";
loadMoreWrap.className = "text-center mt-4 d-none";
loadMoreWrap.innerHTML = `
  <button type="button" class="btn btn-ckem-outline px-4 py-2" id="loadMoreBtn">
    <i class="bi bi-arrow-down-circle me-1"></i> Load More Hymns
  </button>
`;
hymnGrid.parentNode.insertBefore(loadMoreWrap, emptyState);

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("currentYear").textContent = new Date().getFullYear();
  init3DBookTilt();
  bindEvents();
  initApp();
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_HYMNS)) {
        const store = database.createObjectStore(STORE_HYMNS, { keyPath: "id" });
        store.createIndex("book", "book", { unique: false });
        store.createIndex("number", "number", { unique: false });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAllHymns() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HYMNS, "readonly");
    const store = tx.objectStore(STORE_HYMNS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPutHymns(items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HYMNS, "readwrite");
    const store = tx.objectStore(STORE_HYMNS);
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbDeleteHymn(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HYMNS, "readwrite");
    tx.objectStore(STORE_HYMNS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function buildSearchIndex(h) {
  h._search = [
    h.number,
    h.title,
    h.book,
    h.meta || "",
    h.chorus || "",
    ...(h.stanzas || [])
  ]
    .join(" ")
    .toLowerCase();
  return h;
}

async function initApp() {
  try {
    db = await openDatabase();

    // Load preferences
    const savedFavs = localStorage.getItem(FAVS_KEY);
    if (savedFavs) favorites = new Set(JSON.parse(savedFavs));
    applyTheme(localStorage.getItem(THEME_KEY) || "light");

    const savedScale = parseFloat(localStorage.getItem(FONT_SCALE_KEY));
    if (!isNaN(savedScale)) {
      fontScale = savedScale;
      applyFontScale();
    }

    // Fetch shared hymns.json and merge into IndexedDB
    let sharedHymns = [];
    try {
      const res = await fetch("./hymns.json", { cache: "no-store" });
      if (res.ok) sharedHymns = await res.json();
    } catch (_) {
      // Offline fallback uses IndexedDB
    }

    if (Array.isArray(sharedHymns) && sharedHymns.length > 0) {
      await dbPutHymns(sharedHymns);
    }

    const rawHymns = await dbGetAllHymns();
    allHymns = rawHymns.map(buildSearchIndex);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(console.warn);
    }
  } catch (err) {
    console.error("Failed to initialize hymnal database:", err);
  }

  applyFiltersAndRender(true);
}

function saveFavorites() {
  localStorage.setItem(FAVS_KEY, JSON.stringify([...favorites]));
}

function updateTotalBadge() {
  const count = allHymns.length;
  totalHymnsBadge.textContent = `${count.toLocaleString()} ${count === 1 ? "Hymn" : "Hymns"} Loaded`;
}

function init3DBookTilt() {
  const scene = document.getElementById("book3dScene");
  const card = document.getElementById("book3dCard");
  if (!scene || !card) return;

  scene.addEventListener("mousemove", (e) => {
    const rect = scene.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    const rotateY = -12 + x * 36;
    const rotateX = 4 - y * 28;
    card.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(1.03)`;
  });

  scene.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });

  scene.addEventListener("click", () => {
    if (allHymns.length > 0) {
      openHymnReader(allHymns[0].id);
    } else {
      const modal = new bootstrap.Modal(document.getElementById("manageHymnsModal"));
      modal.show();
    }
  });
}

function bindEvents() {
  document.getElementById("brandHomeBtn").addEventListener("click", (e) => {
    e.preventDefault();
    closeHymnReader();
  });

  let searchTimer = null;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim().toLowerCase();
    clearSearchBtn.classList.toggle("d-none", val.length === 0);
    searchTimer = setTimeout(() => {
      searchQuery = val;
      if (!hymnReaderView.classList.contains("d-none")) closeHymnReader();
      applyFiltersAndRender(true);
    }, 120);
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("d-none");
    applyFiltersAndRender(true);
  });

  categoryTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".ckem-tab");
    if (!btn) return;
    document.querySelectorAll(".ckem-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.category;
    if (!hymnReaderView.classList.contains("d-none")) closeHymnReader();
    applyFiltersAndRender(true);
  });

  document.getElementById("loadMoreBtn").addEventListener("click", () => {
    renderNextBatch();
  });

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  document.getElementById("wakeLockBtn").addEventListener("click", toggleWakeLock);
  document.getElementById("backToListBtn").addEventListener("click", closeHymnReader);

  document.getElementById("fontIncreaseBtn").addEventListener("click", () => {
    fontScale = Math.min(1.6, +(fontScale + 0.1).toFixed(2));
    applyFontScale();
  });

  document.getElementById("fontDecreaseBtn").addEventListener("click", () => {
    fontScale = Math.max(0.8, +(fontScale - 0.1).toFixed(2));
    applyFontScale();
  });

  document.getElementById("fontResetBtn").addEventListener("click", () => {
    fontScale = 1;
    applyFontScale();
  });

  document.getElementById("readerFavBtn").addEventListener("click", () => {
    if (!activeHymnId) return;
    toggleFavorite(activeHymnId);
    updateReaderFavButton(activeHymnId);
  });

  document.getElementById("readerEditBtn").addEventListener("click", () => {
    if (!activeHymnId) return;
    openEditModal(activeHymnId);
  });

  document.getElementById("readerDeleteBtn").addEventListener("click", async () => {
    if (!activeHymnId) return;
    if (confirm("Delete this hymn from your CKEM Int'l hymnal?")) {
      await dbDeleteHymn(activeHymnId);
      allHymns = allHymns.filter((h) => h.id !== activeHymnId);
      favorites.delete(activeHymnId);
      saveFavorites();
      closeHymnReader();
    }
  });

  document.getElementById("prevHymnBtn").addEventListener("click", () => navigateAdjacentHymn(-1));
  document.getElementById("nextHymnBtn").addEventListener("click", () => navigateAdjacentHymn(1));

  document.getElementById("hymnForm").addEventListener("submit", handleSaveSingleHymn);
  document.getElementById("resetFormBtn").addEventListener("click", resetHymnForm);
  document.getElementById("manageHymnsModal").addEventListener("hidden.bs.modal", resetHymnForm);

  document.getElementById("importJsonBtn").addEventListener("click", handleBulkImport);
  document.getElementById("exportJsonBtn").addEventListener("click", handleBulkExport);
}

function computeFilteredHymns() {
  return allHymns
    .filter((hymn) => {
      if (activeCategory === "FAVORITES" && !favorites.has(hymn.id)) return false;
      if (activeCategory !== "ALL" && activeCategory !== "FAVORITES" && hymn.book !== activeCategory) {
        return false;
      }
      if (!searchQuery) return true;
      return (hymn._search || "").includes(searchQuery);
    })
    .sort((a, b) => {
      const numA = parseInt(a.number, 10);
      const numB = parseInt(b.number, 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
      return String(a.number).localeCompare(String(b.number));
    });
}

function applyFiltersAndRender(reset = true) {
  updateTotalBadge();
  filteredHymns = computeFilteredHymns();

  if (reset) {
    hymnGrid.innerHTML = "";
    renderedCount = 0;
  }

  if (filteredHymns.length === 0) {
    resultsCountLabel.textContent = "Showing 0 hymns";
    loadMoreWrap.classList.add("d-none");
    emptyState.classList.remove("d-none");
    if (allHymns.length > 0) {
      emptyState.querySelector("h4").textContent = "No Matching Hymns Found";
      emptyState.querySelector("p").textContent =
        "Try clearing your search filter or switching to another hymnal tab.";
    } else {
      emptyState.querySelector("h4").textContent = "Your CKEM Int'l Hymnal is Ready";
      emptyState.querySelector("p").textContent =
        "No hymns have been added yet. Add your first hymn manually or import a JSON batch to start building your church's offline collection.";
    }
    return;
  }

  emptyState.classList.add("d-none");
  renderNextBatch();
}

function renderNextBatch() {
  const slice = filteredHymns.slice(renderedCount, renderedCount + PAGE_SIZE);
  const frag = document.createDocumentFragment();

  slice.forEach((hymn) => {
    const isFav = favorites.has(hymn.id);
    const firstLine = (hymn.stanzas && hymn.stanzas[0] ? hymn.stanzas[0].split("\n")[0] : "") || "";

    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="hymn-item-card d-flex flex-column justify-content-between" data-id="${hymn.id}">
        <div>
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="hymn-num-pill">Hymn ${escapeHtml(hymn.number)}</span>
            <div class="d-flex align-items-center gap-2">
              <span class="hymn-book-tag">${escapeHtml(hymn.book)}</span>
              <button class="btn btn-sm p-0 border-0 fav-card-btn" data-fav-id="${hymn.id}" title="Bookmark">
                <i class="bi ${isFav ? "bi-heart-fill text-danger" : "bi-heart text-muted"}"></i>
              </button>
            </div>
          </div>
          <h5 class="fw-bold mb-1">${escapeHtml(hymn.title)}</h5>
          <p class="text-muted small mb-0 text-truncate">${escapeHtml(firstLine)}</p>
        </div>
        <div class="mt-3 pt-2 border-top d-flex justify-content-between align-items-center small text-muted">
          <span>${hymn.stanzas.length} ${hymn.stanzas.length === 1 ? "Stanza" : "Stanzas"}</span>
          <span class="fw-semibold" style="color: var(--ckem-gold-hover);">Open <i class="bi bi-arrow-right"></i></span>
        </div>
      </div>
    `;

    col.querySelector(".hymn-item-card").addEventListener("click", (e) => {
      if (e.target.closest(".fav-card-btn")) {
        e.stopPropagation();
        toggleFavorite(hymn.id);
        const icon = e.target.closest(".fav-card-btn").querySelector("i");
        const nowFav = favorites.has(hymn.id);
        icon.className = `bi ${nowFav ? "bi-heart-fill text-danger" : "bi-heart text-muted"}`;
        return;
      }
      openHymnReader(hymn.id);
    });

    frag.appendChild(col);
  });

  hymnGrid.appendChild(frag);
  renderedCount += slice.length;

  resultsCountLabel.textContent = `Showing ${renderedCount.toLocaleString()} of ${filteredHymns.length.toLocaleString()} ${filteredHymns.length === 1 ? "hymn" : "hymns"}`;

  if (renderedCount < filteredHymns.length) {
    loadMoreWrap.classList.remove("d-none");
    document.getElementById("loadMoreBtn").innerHTML =
      `<i class="bi bi-arrow-down-circle me-1"></i> Load More (${(filteredHymns.length - renderedCount).toLocaleString()} remaining)`;
  } else {
    loadMoreWrap.classList.add("d-none");
  }
}

function openHymnReader(id) {
  const hymn = allHymns.find((h) => h.id === id);
  if (!hymn) return;

  activeHymnId = id;
  hymnListView.classList.add("d-none");
  hymnReaderView.classList.remove("d-none");

  readerPageCard.classList.remove("flip-enter");
  void readerPageCard.offsetWidth;
  readerPageCard.classList.add("flip-enter");

  document.getElementById("readerBookBadge").textContent = hymn.book;
  document.getElementById("readerHymnNumber").textContent = `Hymn ${hymn.number}`;
  document.getElementById("readerHymnTitle").textContent = hymn.title;
  document.getElementById("readerHymnMeta").textContent = hymn.meta || "";
  updateReaderFavButton(id);

  const lyricsBody = document.getElementById("readerLyricsBody");
  lyricsBody.innerHTML = "";

  hymn.stanzas.forEach((stanzaText, idx) => {
    const stanzaDiv = document.createElement("div");
    stanzaDiv.className = "stanza-block";
    const formattedLines = escapeHtml(stanzaText).replace(/\n/g, "<br/>");
    stanzaDiv.innerHTML = `<span class="stanza-num">${idx + 1}.</span>${formattedLines}`;
    lyricsBody.appendChild(stanzaDiv);

    if (idx === 0 && hymn.chorus && hymn.chorus.trim()) {
      const chorusDiv = document.createElement("div");
      chorusDiv.className = "chorus-block";
      const formattedChorus = escapeHtml(hymn.chorus.trim()).replace(/\n/g, "<br/>");
      chorusDiv.innerHTML = `<span class="chorus-label">Chorus</span>${formattedChorus}`;
      lyricsBody.appendChild(chorusDiv);
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeHymnReader() {
  activeHymnId = null;
  hymnReaderView.classList.add("d-none");
  hymnListView.classList.remove("d-none");
  applyFiltersAndRender(true);
}

function navigateAdjacentHymn(direction) {
  const currentIndex = filteredHymns.findIndex((h) => h.id === activeHymnId);
  if (currentIndex === -1 || filteredHymns.length <= 1) return;
  const nextIndex = (currentIndex + direction + filteredHymns.length) % filteredHymns.length;
  openHymnReader(filteredHymns[nextIndex].id);
}

async function handleSaveSingleHymn(e) {
  e.preventDefault();
  const editId = document.getElementById("editHymnId").value;
  const number = document.getElementById("hymnNumber").value.trim();
  const book = document.getElementById("hymnBook").value;
  const title = document.getElementById("hymnTitle").value.trim();
  const meta = document.getElementById("hymnMeta").value.trim();
  const chorus = document.getElementById("hymnChorus").value.trim();
  const rawStanzas = document.getElementById("hymnStanzas").value.trim();

  const stanzas = rawStanzas
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (stanzas.length === 0) return;

  const record = buildSearchIndex({
    id: editId || `hymn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    number,
    book,
    title,
    meta,
    chorus,
    stanzas
  });

  const cleanRecord = { ...record };
  delete cleanRecord._search;
  await dbPutHymns([cleanRecord]);

  if (editId) {
    const idx = allHymns.findIndex((h) => h.id === editId);
    if (idx !== -1) allHymns[idx] = record;
  } else {
    allHymns.push(record);
  }

  bootstrap.Modal.getInstance(document.getElementById("manageHymnsModal")).hide();

  if (editId && activeHymnId === editId) {
    openHymnReader(editId);
  } else {
    applyFiltersAndRender(true);
  }
}

function openEditModal(id) {
  const hymn = allHymns.find((h) => h.id === id);
  if (!hymn) return;

  document.getElementById("editHymnId").value = hymn.id;
  document.getElementById("hymnNumber").value = hymn.number;
  document.getElementById("hymnBook").value = hymn.book;
  document.getElementById("hymnTitle").value = hymn.title;
  document.getElementById("hymnMeta").value = hymn.meta || "";
  document.getElementById("hymnChorus").value = hymn.chorus || "";
  document.getElementById("hymnStanzas").value = (hymn.stanzas || []).join("\n\n");

  new bootstrap.Tab(document.getElementById("single-tab")).show();
  new bootstrap.Modal(document.getElementById("manageHymnsModal")).show();
}

function resetHymnForm() {
  document.getElementById("hymnForm").reset();
  document.getElementById("editHymnId").value = "";
}

async function handleBulkImport() {
  const raw = document.getElementById("bulkJsonInput").value.trim();
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      alert("JSON must be an array of hymn objects: [ { ... }, { ... } ]");
      return;
    }

    const cleanBatch = [];
    parsed.forEach((item, i) => {
      if (item.number && item.title && Array.isArray(item.stanzas) && item.stanzas.length > 0) {
        cleanBatch.push({
          id: item.id || `hymn_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          number: String(item.number).trim(),
          book: (item.book || "CAC").toUpperCase(),
          title: String(item.title).trim(),
          meta: item.meta ? String(item.meta).trim() : "",
          chorus: item.chorus ? String(item.chorus).trim() : "",
          stanzas: item.stanzas.map((s) => String(s).trim()).filter(Boolean)
        });
      }
    });

    if (cleanBatch.length > 0) {
      await dbPutHymns(cleanBatch);
      const map = new Map(allHymns.map((h) => [h.id, h]));
      cleanBatch.forEach((item) => map.set(item.id, buildSearchIndex({ ...item })));
      allHymns = Array.from(map.values());
    }

    applyFiltersAndRender(true);
    document.getElementById("bulkJsonInput").value = "";
    bootstrap.Modal.getInstance(document.getElementById("manageHymnsModal")).hide();
    alert(`Successfully imported ${cleanBatch.length.toLocaleString()} hymn(s) into CKEM Int'l Hymnal.`);
  } catch (err) {
    alert("Invalid JSON format. Please check your syntax and try again.");
  }
}

function handleBulkExport() {
  const exportData = allHymns.map(({ _search, ...rest }) => rest);
  const dataStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hymns.json";
  a.click();
  URL.revokeObjectURL(url);
}

function toggleFavorite(id) {
  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }
  saveFavorites();
}

function updateReaderFavButton(id) {
  const btn = document.getElementById("readerFavBtn");
  const isFav = favorites.has(id);
  btn.innerHTML = `<i class="bi ${isFav ? "bi-heart-fill text-danger" : "bi-heart"}"></i>`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const icon = document.getElementById("themeIcon");
  icon.className = theme === "dark" ? "bi bi-sun-fill text-warning" : "bi bi-moon-stars-fill";
}

function applyFontScale() {
  document.documentElement.style.setProperty("--hymn-font-scale", fontScale);
  localStorage.setItem(FONT_SCALE_KEY, fontScale);
  document.getElementById("fontResetBtn").textContent = `${Math.round(fontScale * 100)}%`;
}

async function toggleWakeLock() {
  const btn = document.getElementById("wakeLockBtn");
  if (!("wakeLock" in navigator)) {
    alert("Screen Wake Lock is not supported in this browser.");
    return;
  }

  try {
    if (wakeLock !== null) {
      await wakeLock.release();
      wakeLock = null;
      btn.classList.remove("active");
    } else {
      wakeLock = await navigator.wakeLock.request("screen");
      btn.classList.add("active");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        btn.classList.remove("active");
      });
    }
  } catch (err) {
    console.warn("Wake Lock request failed:", err);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
