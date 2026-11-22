const API_BASE = window.ANIMORA_API_BASE || "https://cdn1.lvn123.site";

const searchOverlay = document.querySelector("#search-overlay");
const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
const searchResultMeta = document.querySelector("#search-result-meta");
const searchToggle = document.querySelector("#search-toggle");
const searchClose = document.querySelector("#search-close");
const profileButton = document.querySelector("#profile-button");
const menuToggle = document.querySelector("#menu-toggle");
const desktopNav = document.querySelector(".desktop-nav");
const toast = document.querySelector("#toast");
const detailOverlay = document.querySelector("#detail-overlay");
const detailClose = document.querySelector("#detail-close");
const detailHero = document.querySelector("#detail-hero");
const detailTitle = document.querySelector("#detail-title");
const detailMeta = document.querySelector("#detail-meta");
const detailDescription = document.querySelector("#detail-description");
const detailTags = document.querySelector("#detail-tags");
const detailSeasonLabel = document.querySelector("#detail-season-label");
const detailEpisodes = document.querySelector("#detail-episodes");
const playerOverlay = document.querySelector("#player-overlay");
const playerClose = document.querySelector("#player-close");
const playerTitle = document.querySelector("#player-title");
const playerEpisodeLabel = document.querySelector("#player-episode-label");
const playerStatus = document.querySelector("#player-status");
const animeVideo = document.querySelector("#anime-video");
const scheduleStrip = document.querySelector("#schedule-strip");

const fallbackSearchCatalog = [
  { title: "Solo Leveling", type: "Anime", meta: "Action / Fantasy / 2024", initials: "SL", start: "#5d110e", end: "#d3382c" },
  { title: "DAN DA DAN", type: "Anime", meta: "Supernatural / Comedy / 2024", initials: "DD", start: "#471b9f", end: "#e9509b" },
  { title: "Jujutsu Kaisen", type: "Anime", meta: "Action / Dark fantasy / 2020", initials: "JK", start: "#0d416f", end: "#62248f" },
  { title: "Frieren: Beyond Journey's End", type: "Anime", meta: "Fantasy / Adventure / 2023", initials: "FR", start: "#8cc8dc", end: "#7466be" },
  { title: "A-1 Pictures", type: "Studio", meta: "Animation studio / Tokyo", initials: "A1", start: "#1f326e", end: "#387ea3" },
  { title: "Action anime", type: "Genre", meta: "24 titles available", initials: "AC", start: "#782846", end: "#2e1c3e" },
  { title: "Romance anime", type: "Genre", meta: "18 titles available", initials: "RO", start: "#3d286f", end: "#1f274e" },
  { title: "Fantasy anime", type: "Genre", meta: "31 titles available", initials: "FA", start: "#124862", end: "#182a56" },
  { title: "Comedy anime", type: "Genre", meta: "16 titles available", initials: "CO", start: "#65552a", end: "#32263a" },
  { title: "Mystery anime", type: "Genre", meta: "12 titles available", initials: "MY", start: "#2c315e", end: "#171d3c" },
  { title: "Miyuki Sawashiro", type: "Character", meta: "Voice actor / 34 credits", initials: "MS", start: "#3d286f", end: "#1f274e" }
];

let activeSearchFilter = "all";
let toastTimer;
let lastFocusedElement = null;
let searchRequestId = 0;
let currentHls = null;
let liveHomeItems = [];

function decodeText(value) {
  let current = String(value ?? "");
  for (let index = 0; index < 2; index += 1) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = current;
    if (decoder.value === current) {
      break;
    }
    current = decoder.value;
  }
  return current;
}

function apiUrl(path) {
  return new URL(path, API_BASE).href;
}

async function fetchApiJson(path) {
  const response = await fetch(apiUrl(path), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`API ${response.status} for ${path}`);
  }
  return response.json();
}

function syncFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((filterButton) => {
    const isActive = filterButton.dataset.filter === activeSearchFilter;
    filterButton.classList.toggle("is-active", isActive);
    filterButton.setAttribute("aria-pressed", String(isActive));
  });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setBodyLock(isLocked) {
  document.body.style.overflow = isLocked ? "hidden" : "";
}

function setOverlayState(overlay, isOpen) {
  overlay.classList.toggle("is-open", isOpen);
  overlay.setAttribute("aria-hidden", String(!isOpen));
  overlay.inert = !isOpen;
}

function closeMobileMenu() {
  desktopNav.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
}

function openSearch() {
  lastFocusedElement = document.activeElement;
  setOverlayState(searchOverlay, true);
  searchToggle.setAttribute("aria-expanded", "true");
  setBodyLock(true);
  window.setTimeout(() => searchInput.focus(), 50);
  renderSearchResults("");
}

function closeSearch() {
  const wasOpen = searchOverlay.classList.contains("is-open");
  setOverlayState(searchOverlay, false);
  searchToggle.setAttribute("aria-expanded", "false");
  searchInput.value = "";
  activeSearchFilter = "all";
  syncFilterButtons();
  if (!detailOverlay.classList.contains("is-open") && !playerOverlay.classList.contains("is-open")) {
    setBodyLock(false);
  }
  if (wasOpen && lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function createSearchResult(item) {
  const resultButton = document.createElement("button");
  resultButton.className = "search-result";
  resultButton.type = "button";

  const resultArt = document.createElement("span");
  resultArt.className = "search-result-art";
  resultArt.textContent = item.initials || (item.title || "AN").slice(0, 2).toUpperCase();
  resultArt.style.setProperty("--result-start", item.start || "#1f326e");
  resultArt.style.setProperty("--result-end", item.end || "#387ea3");
  if (item.poster) {
    resultArt.style.backgroundImage = `linear-gradient(145deg, rgba(8, 11, 22, 0.15), rgba(8, 11, 22, 0.85)), url("${item.poster}")`;
    resultArt.style.backgroundSize = "cover";
    resultArt.style.backgroundPosition = "center";
  }

  const resultCopy = document.createElement("span");
  resultCopy.className = "search-result-copy";
  const resultTitle = document.createElement("strong");
  resultTitle.textContent = decodeText(item.title || "Untitled anime");
  const resultMeta = document.createElement("span");
  resultMeta.textContent = `${item.type || "Anime"} / ${decodeText(item.meta || item.year || "")}`;
  resultCopy.append(resultTitle, resultMeta);
  resultButton.append(resultArt, resultCopy);
  resultButton.addEventListener("click", () => {
    if (item.slug) {
      closeSearch();
      openDetail(item.slug);
      return;
    }
    showToast(`Đã chọn ${decodeText(item.title)}`);
  });
  return resultButton;
}

function renderSearchItems(items, label) {
  searchResults.replaceChildren();
  searchResultMeta.textContent = label;
  if (!items.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-search";
    emptyState.textContent = "Không tìm thấy kết quả phù hợp. Hãy thử tên anime hoặc thể loại khác.";
    searchResults.append(emptyState);
    return;
  }
  items.slice(0, 10).forEach((item) => searchResults.append(createSearchResult(item)));
}

async function renderSearchResults(query) {
  const requestId = searchRequestId + 1;
  searchRequestId = requestId;
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    const suggestions = liveHomeItems.slice(0, 6).map((item) => ({ ...item, type: "Anime", meta: item.year }));
    renderSearchItems(suggestions.length ? suggestions : fallbackSearchCatalog, "Gợi ý cho bạn");
    return;
  }
  searchResultMeta.textContent = "Đang tìm kiếm...";
  searchResults.replaceChildren();
  try {
    const data = await fetchApiJson(`/api/search?q=${encodeURIComponent(normalizedQuery)}&page=1`);
    if (requestId !== searchRequestId) {
      return;
    }
    const items = (data.items || []).map((item) => ({ ...item, type: "Anime", meta: item.year || item.progress }));
    renderSearchItems(items, `${items.length} kết quả cho “${normalizedQuery}”`);
  } catch (error) {
    const localResults = fallbackSearchCatalog.filter((item) => `${item.title} ${item.type} ${item.meta}`.toLowerCase().includes(normalizedQuery.toLowerCase()));
    renderSearchItems(localResults, localResults.length ? "Kết quả tạm thời" : "Không thể kết nối API tìm kiếm");
  }
}

function posterStyle(item) {
  if (!item.poster) {
    return "";
  }
  return `linear-gradient(0deg, rgba(4, 7, 15, 0.88), rgba(4, 7, 15, 0.08) 72%), url("${item.poster}")`;
}

function createPosterCard(item, compact = false) {
  const card = document.createElement("article");
  card.className = compact ? "poster-card compact-card" : "poster-card";
  card.dataset.slug = item.slug || "";
  const art = document.createElement("div");
  art.className = "poster-art";
  if (item.poster) {
    art.style.backgroundImage = posterStyle(item);
    art.style.backgroundSize = "cover";
    art.style.backgroundPosition = "center";
  }
  const badge = document.createElement("span");
  badge.className = item.schedule_badge ? "rank-badge" : "new-badge";
  badge.textContent = item.schedule_badge || item.episode_badge || item.progress || "NEW";
  art.append(badge);
  const word = document.createElement("span");
  word.className = "poster-word";
  word.textContent = decodeText(item.title || "Anime");
  art.append(word);
  const info = document.createElement("div");
  info.className = "poster-info";
  const title = document.createElement("h3");
  title.textContent = decodeText(item.title || "Untitled anime");
  const meta = document.createElement("p");
  meta.textContent = decodeText(item.episode_badge || item.progress || item.year || "Anime");
  const rating = document.createElement("span");
  rating.textContent = item.rating || "—";
  meta.append(rating);
  info.append(title, meta);
  card.append(art, info);
  card.addEventListener("click", () => item.slug ? openDetail(item.slug) : showToast(`Đã chọn ${decodeText(item.title)}`));
  return card;
}

function createUpcomingCard(item, index) {
  const card = document.createElement("article");
  card.className = `upcoming-card${index === 0 ? " upcoming-featured" : ""}`;
  const art = document.createElement("div");
  art.className = "upcoming-art";
  if (item.poster) {
    art.style.backgroundImage = `linear-gradient(0deg, rgba(5, 7, 15, 0.9), rgba(5, 7, 15, 0.08)), url("${item.poster}")`;
    art.style.backgroundSize = "cover";
    art.style.backgroundPosition = "center";
  }
  const dateChip = document.createElement("span");
  dateChip.className = "date-chip";
  dateChip.textContent = item.air_time || "Coming soon";
  const upcomingTitle = document.createElement("span");
  upcomingTitle.className = "upcoming-title";
  upcomingTitle.textContent = decodeText(item.title || "Upcoming anime");
  art.append(dateChip, upcomingTitle);
  const info = document.createElement("div");
  info.className = "upcoming-info";
  const status = document.createElement("span");
  status.textContent = item.schedule_badge || "Coming soon";
  const title = document.createElement("h3");
  title.textContent = decodeText(item.title || "Upcoming anime");
  const description = document.createElement("p");
  description.textContent = decodeText(item.description || `${item.year || ""} / ${item.progress || "New release"}`);
  info.append(status, title, description);
  card.append(art, info);
  card.addEventListener("click", () => item.slug && openDetail(item.slug));
  return card;
}

function createGenreTile(item, index) {
  const classes = ["genre-action", "genre-romance", "genre-fantasy", "genre-comedy", "genre-mystery"];
  const tile = document.createElement("button");
  tile.className = `genre-tile ${classes[index % classes.length]}`;
  tile.type = "button";
  const name = document.createElement("span");
  name.textContent = decodeText(item.name);
  const count = document.createElement("b");
  count.textContent = "Khám phá";
  const arrow = document.createElement("i");
  arrow.textContent = "↗";
  tile.append(name, count, arrow);
  tile.addEventListener("click", () => openGenreSearch(item));
  return tile;
}

function renderLiveHome(items) {
  liveHomeItems = items;
  const hotRail = document.querySelector("#hot-rail");
  const newRail = document.querySelector(".compact-rail");
  const ranked = [...items].filter((item) => item.rating && !item.schedule_badge).sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  const fresh = items.filter((item) => item.episode_badge && !item.schedule_badge);
  if (ranked.length) {
    hotRail.replaceChildren(...ranked.slice(0, 8).map((item) => createPosterCard(item)));
  }
  if (fresh.length) {
    newRail.replaceChildren(...fresh.slice(0, 8).map((item) => createPosterCard(item, true)));
  }
}

function renderUpcoming(items) {
  const upcomingGrid = document.querySelector(".upcoming-grid");
  if (items.length) {
    upcomingGrid.replaceChildren(...items.slice(0, 3).map((item, index) => createUpcomingCard(item, index)));
  }
}

function renderGenres(genres) {
  const genreGrid = document.querySelector(".genre-grid");
  if (genres.length) {
    genreGrid.replaceChildren(...genres.slice(0, 10).map((item, index) => createGenreTile(item, index)));
  }
}

function renderSchedule(schedule) {
  if (!scheduleStrip || !schedule.length) {
    return;
  }
  scheduleStrip.replaceChildren(...schedule.slice(0, 7).map((day) => {
    const card = document.createElement("div");
    card.className = "schedule-day";
    const title = document.createElement("strong");
    title.textContent = decodeText(day.day || "Lịch chiếu");
    const firstItem = Array.isArray(day.items) ? day.items[0] : null;
    const meta = document.createElement("span");
    meta.textContent = firstItem ? `${firstItem.air_time || firstItem.schedule_badge || "Có tập mới"}` : `${day.count || 0} anime`;
    card.append(title, meta);
    return card;
  }));
}

async function loadLiveCatalog() {
  const [homeResult, upcomingResult, scheduleResult, genresResult] = await Promise.allSettled([
    fetchApiJson("/api/home"),
    fetchApiJson("/api/upcoming?page=1"),
    fetchApiJson("/api/schedule"),
    fetchApiJson("/api/genres")
  ]);
  if (homeResult.status === "fulfilled" && Array.isArray(homeResult.value.items)) {
    renderLiveHome(homeResult.value.items);
  }
  if (upcomingResult.status === "fulfilled" && Array.isArray(upcomingResult.value.items)) {
    renderUpcoming(upcomingResult.value.items);
  }
  if (scheduleResult.status === "fulfilled" && Array.isArray(scheduleResult.value.schedule)) {
    renderSchedule(scheduleResult.value.schedule);
  }
  if (genresResult.status === "fulfilled" && Array.isArray(genresResult.value.genres)) {
    renderGenres(genresResult.value.genres);
  }
}

function openDetail(slug) {
  lastFocusedElement = document.activeElement;
  setOverlayState(detailOverlay, true);
  setBodyLock(true);
  detailTitle.textContent = "Đang tải...";
  detailMeta.textContent = "";
  detailDescription.textContent = "";
  detailTags.replaceChildren();
  detailEpisodes.replaceChildren();
  detailHero.style.backgroundImage = "linear-gradient(0deg, rgba(15, 18, 35, 1), rgba(15, 18, 35, 0.05) 75%)";
  fetchApiJson(`/api/anime?slug=${encodeURIComponent(slug)}`).then(renderDetail).catch(() => {
    detailTitle.textContent = "Không thể tải anime";
    detailDescription.textContent = "API chi tiết đang tạm thời không phản hồi. Hãy thử lại sau.";
  });
}

function renderDetail(data) {
  detailTitle.textContent = decodeText(data.title || "Anime");
  detailMeta.textContent = [data.type === "movie" ? "Movie" : "TV Series", data.rating && `★ ${data.rating}`, data.quality, data.status].filter(Boolean).join(" / ");
  detailDescription.textContent = decodeText(data.description || "Chưa có mô tả cho anime này.");
  detailSeasonLabel.textContent = decodeText(data.seasons?.find((season) => season.active)?.name || `${data.episode_count || 0} tập`);
  detailTags.replaceChildren(...(data.genres || []).map((genre) => {
    const tag = document.createElement("span");
    tag.className = "detail-tag";
    tag.textContent = decodeText(genre.name);
    return tag;
  }));
  if (data.banner || data.poster) {
    detailHero.style.backgroundImage = `linear-gradient(0deg, rgba(15, 18, 35, 1), rgba(15, 18, 35, 0.08) 75%), linear-gradient(90deg, rgba(15, 18, 35, 0.9), transparent 70%), url("${data.banner || data.poster}")`;
  }
  const episodes = data.episodes || [];
  if (!episodes.length) {
    const empty = document.createElement("div");
    empty.className = "episode-empty";
    empty.textContent = "Chưa có tập phát hành.";
    detailEpisodes.replaceChildren(empty);
    return;
  }
  detailEpisodes.replaceChildren(...episodes.map((episode) => {
    const button = document.createElement("button");
    button.className = "episode-button";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = `Tập ${decodeText(episode.episode || "?")}`;
    const meta = document.createElement("span");
    meta.textContent = decodeText(episode.title || episode.source || "VietSub");
    button.append(title, meta);
    button.addEventListener("click", () => playEpisode(episode, data));
    return button;
  }));
}

function closeDetail() {
  setOverlayState(detailOverlay, false);
  if (!playerOverlay.classList.contains("is-open")) {
    setBodyLock(false);
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function destroyPlayer() {
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  animeVideo.pause();
  animeVideo.removeAttribute("src");
  animeVideo.load();
}

function playEpisode(episode, anime) {
  closeDetail();
  setOverlayState(playerOverlay, true);
  setBodyLock(true);
  playerTitle.textContent = decodeText(anime.title || "Anime episode");
  playerEpisodeLabel.textContent = `Tập ${decodeText(episode.episode || "?")} / ${decodeText(episode.title || "VietSub")}`;
  playerStatus.textContent = "Đang chuẩn bị luồng phát...";
  destroyPlayer();
  if (!episode.playlist_m3u8) {
    playerStatus.textContent = "Tập này chưa có playlist phát trực tiếp.";
    return;
  }
  const playlistUrl = apiUrl(episode.playlist_m3u8);
  if (window.Hls && Hls.isSupported()) {
    const BaseLoader = Hls.DefaultConfig.loader;
    class DirectGoogleCdnLoader extends BaseLoader {
      load(context, config, callbacks) {
        if (context.url && context.url.includes("googleusercontent.com")) {
          const start = typeof context.rangeStart === "number" ? context.rangeStart : 128;
          const end = typeof context.rangeEnd === "number" ? context.rangeEnd : undefined;
          context.rangeStart = undefined;
          context.rangeEnd = undefined;
          const originalSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function onSuccess(response, stats, ctx, networkDetails) {
            if (response.data instanceof ArrayBuffer) {
              response.data = response.data.slice(start, end);
            }
            originalSuccess(response, stats, ctx, networkDetails);
          };
        }
        super.load(context, config, callbacks);
      }
    }
    currentHls = new Hls({ fLoader: DirectGoogleCdnLoader });
    currentHls.loadSource(playlistUrl);
    currentHls.attachMedia(animeVideo);
    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      playerStatus.textContent = "Sẵn sàng phát";
      animeVideo.play().catch(() => {});
    });
    currentHls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        playerStatus.textContent = "Không thể tải luồng phát. Hãy thử lại tập này.";
      }
    });
    return;
  }
  if (animeVideo.canPlayType("application/vnd.apple.mpegurl")) {
    animeVideo.src = playlistUrl;
    animeVideo.addEventListener("loadedmetadata", () => {
      playerStatus.textContent = "Sẵn sàng phát";
      animeVideo.play().catch(() => {});
    }, { once: true });
    return;
  }
  playerStatus.textContent = "Trình duyệt hiện tại chưa hỗ trợ HLS.";
}

function closePlayer() {
  setOverlayState(playerOverlay, false);
  destroyPlayer();
  if (!detailOverlay.classList.contains("is-open")) {
    setBodyLock(false);
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function openGenreSearch(item) {
  openSearch();
  activeSearchFilter = "all";
  syncFilterButtons();
  searchInput.value = item.name;
  renderSearchResults(item.name);
}

searchToggle.addEventListener("click", openSearch);
searchClose.addEventListener("click", closeSearch);
detailClose.addEventListener("click", closeDetail);
playerClose.addEventListener("click", closePlayer);
profileButton.addEventListener("click", () => showToast("Hồ sơ người dùng đang được mở rộng"));

searchOverlay.addEventListener("click", (event) => {
  if (event.target === searchOverlay) {
    closeSearch();
  }
});

detailOverlay.addEventListener("click", (event) => {
  if (event.target === detailOverlay) {
    closeDetail();
  }
});

playerOverlay.addEventListener("click", (event) => {
  if (event.target === playerOverlay) {
    closePlayer();
  }
});

searchInput.addEventListener("input", (event) => renderSearchResults(event.target.value));

menuToggle.addEventListener("click", () => {
  const isOpen = desktopNav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

desktopNav.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    desktopNav.querySelectorAll(".nav-link").forEach((navLink) => navLink.classList.remove("is-active"));
    link.classList.add("is-active");
    closeMobileMenu();
  });
});

document.querySelectorAll("[data-filter]").forEach((filterButton) => {
  filterButton.addEventListener("click", () => {
    activeSearchFilter = filterButton.dataset.filter;
    syncFilterButtons();
    renderSearchResults(searchInput.value);
  });
});

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const rail = document.querySelector(`#${button.dataset.scrollTarget}`);
    const direction = Number(button.dataset.direction);
    rail.scrollBy({ left: direction * 420, behavior: "smooth" });
  });
});

document.querySelectorAll("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (playerOverlay.classList.contains("is-open")) {
      closePlayer();
    } else if (detailOverlay.classList.contains("is-open")) {
      closeDetail();
    } else if (searchOverlay.classList.contains("is-open")) {
      closeSearch();
    }
    closeMobileMenu();
  }
  if (event.key === "Tab" && searchOverlay.classList.contains("is-open")) {
    const focusableElements = searchOverlay.querySelectorAll("button, input, [href], [tabindex]:not([tabindex='-1'])");
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus();
    }
    if (!event.shiftKey && document.activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus();
    }
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 720) {
    closeMobileMenu();
  }
});

syncFilterButtons();
renderSearchResults("");
loadLiveCatalog();
