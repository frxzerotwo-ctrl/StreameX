// --- CONFIGURATION ---
const WORKER_URL = 'https://streamex-server.frxzerotwo.workers.dev';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_URL = 'https://image.tmdb.org/t/p/w342';
const IMG_ORIG = 'https://image.tmdb.org/t/p/original';

// --- GLOBAL VARIABLES ---
let currentUser = null;
let appSettings = { theme: 'dark', lang: 'en', region: 'IN', adult: 'false' };
let currentSlide = 0;
let slideInterval;
let playerState = { id: null, type: null, season: 1, episode: 1, anilistId: null, isAnime: false };
let seasonData = [];
let episodeView = 'list';
let navState = { view: 'home', query: null };

const prefetchedData = {};

async function prefetchEndpoint(endpoint) {
    if (prefetchedData[endpoint]) return;

    try {
        const data = await fetchAPI(endpoint);
        prefetchedData[endpoint] = data;
    } catch (e) { }
}

const activeScrollHandlers = {};


// --- SERVERS WITH AUTO ARABIC SUBTITLES (Option 1) ---
const playbackServers = [
    { name: "1vid (مترجم تلقائي)", embed: "https://vidlink.pro/movie/{id}?cc=ar&primaryColor=ff0000&autoplay=false", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Vk (مترجم تلقائي)", embed: "https://vidfast.pro/movie/{id}?autoCC=true&cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Ok.ru (مترجم)", embed: "https://player.videasy.net/movie/{id}?cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Vidspeed", embed: "https://vidsrc.cc/v2/embed/movie/{id}?autoPlay=false&cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Mp4upload", embed: "https://autoembed.co/movie/tmdb/{id}?cc=ar", useSandbox: false, lang: "ar", autoCC: true },
];

const arabicServers = [
    { name: "Voe.sx (عربي ثابت)", embed: "https://vidsrc.to/embed/movie/{id}?cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Playmogo (عربي)", embed: "https://player.smashy.stream/movie/{id}?cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Hgcloud", embed: "https://vidsrc.xyz/embed/movie?tmdb={id}&ds_lang=ar&cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Mixdropp", embed: "https://multiembed.mov/directstream.php?video_id={id}&tmdb=1&cc=ar", useSandbox: false, lang: "ar", autoCC: true },
    { name: "Bysesukior", embed: "https://www.2embed.cc/embed/{id}?cc=ar", useSandbox: false, lang: "ar", autoCC: true },
];

const tvPlaybackServers = [
    { name: "1vid TV (مترجم)", embed: "https://vidlink.pro/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
    { name: "Vk TV", embed: "https://vidfast.pro/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
    { name: "Ok TV", embed: "https://player.videasy.net/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
    { name: "Vidspeed TV", embed: "https://vidsrc.cc/v2/embed/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
    { name: "Mp4upload TV", embed: "https://vidsrc.to/embed/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
];

const tvArabicServers = [
    { name: "Playmogo TV (افتراضي)", embed: "https://player.smashy.stream/tv/{id}/{season}/{episode}?cc=ar", useSandbox: false, autoCC: true },
    { name: "Voe.sx TV", embed: "https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}&cc=ar", useSandbox: false, autoCC: true },
];

const servers = [...playbackServers, ...arabicServers, ...tvPlaybackServers, ...tvArabicServers];






// --- NEW HELPER: FETCH ANILIST ID ---
async function fetchAnilistId(title, season = 1) {
    // If season > 1, append it to search (e.g. "Naruto Season 2") because Anilist separates seasons
    const searchQuery = season > 1 ? `${title} Season ${season}` : title;

    const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        title {
          romaji
          english
        }
      }
    }
    `;

    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                query: query,
                variables: { search: searchQuery }
            })
        });

        const data = await response.json();
        if (data.data && data.data.Media) {
            console.log(`[Anilist] Found ID: ${data.data.Media.id} for "${searchQuery}"`);
            return data.data.Media.id;
        }
    } catch (e) {
        console.error("[Anilist] Fetch Failed:", e);
    }
    return null;
}

// Use DOMContentLoaded instead of window.onload so it runs instantly
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    applyTheme();

    // 1. ROUTE IMMEDIATELY - Don't wait for anything else!
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const id = params.get('id');

    if (type && id) {
        openPlayer(id, type, true);
    } else {
        router('home');
    }

    // 2. Fetch settings in the background WITHOUT 'await' blocking the UI
    populateSettingsAPI().catch(error => {
        console.error("Settings API Error:", error);
        addFallbackSettings();
    });
});

// --- BROWSER BACK BUTTON LISTENER ---
// Move this outside to run immediately
window.addEventListener('popstate', (event) => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const id = params.get('id');

    if (type && id) {
        openPlayer(id, type, true);
    } else {
        restoreLastState();
    }
});

// --- DATABASE LOGIC ---
function toggleLib(key, id, type, title, poster) {
    let list = getLib(key);

    if (list.find(i => i.id == id)) {
        list = list.filter(i => i.id != id);
        if (key === 'watchlist') showToast("Removed from Watchlist");
    } else {
        list.unshift({ id, type, title, poster, savedAt: Date.now() });
        if (key === 'watchlist') showToast("Saved to Watchlist");
    }
    saveLib(key, list);
}

async function renderLibrary(containerId, key) {
    const container = document.getElementById(containerId);
    if (!container) return;

    showSkeletons(containerId, 6);

    let list = getLib(key) || [];

    if (key === 'history') {
        list = [...list].reverse();
    }

    renderGrid(list, containerId, null);
}


// --- SETTINGS LOGIC ---
async function populateSettingsAPI() {
    const langSelect = document.getElementById('set-lang');
    const regionSelect = document.getElementById('set-region');
    if (!langSelect || !regionSelect) return;
    const langs = await fetchAPI('/configuration/languages');
    if (Array.isArray(langs)) {
        langs.sort((a, b) => a.english_name.localeCompare(b.english_name));
        langSelect.innerHTML = '';
        langs.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.iso_639_1;
            opt.innerText = l.english_name;
            langSelect.appendChild(opt);
        });
    }
    const countries = await fetchAPI('/configuration/countries');
    if (Array.isArray(countries)) {
        countries.sort((a, b) => a.english_name.localeCompare(b.english_name));
        regionSelect.innerHTML = '';
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.iso_3166_1;
            opt.innerText = c.english_name;
            regionSelect.appendChild(opt);
        });
    }
    langSelect.value = appSettings.lang || 'en';
    regionSelect.value = appSettings.region || 'IN';
}

function addFallbackSettings() {
    const langSelect = document.getElementById('set-lang');
    if (langSelect) langSelect.innerHTML = '<option value="en">English</option>';
    const regionSelect = document.getElementById('set-region');
    if (regionSelect) regionSelect.innerHTML = '<option value="IN">India</option><option value="US">USA</option>';
}

function loadSettings() {
    const saved = localStorage.getItem('streamex_settings');
    if (saved) appSettings = JSON.parse(saved);
    const themeEl = document.getElementById('set-theme');
    if (themeEl) themeEl.value = appSettings.theme;
    const adultEl = document.getElementById('set-adult');
    if (adultEl) adultEl.value = appSettings.adult;
}

function saveSettings() {
    appSettings.theme = document.getElementById('set-theme').value;
    appSettings.lang = document.getElementById('set-lang').value;
    appSettings.region = document.getElementById('set-region').value;
    appSettings.adult = document.getElementById('set-adult').value;
    localStorage.setItem('streamex_settings', JSON.stringify(appSettings));
    location.reload();
}

function applyTheme() {
    if (appSettings.theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
}

// --- ROUTING ---
function router(viewName) {
    // 1. Clean URL (remove ?id=...)
    if (window.location.search.length > 0) {
        window.history.pushState({}, '', window.location.pathname);
    }

    // 2. TRACK HISTORY 
    if (viewName !== 'player') {
        navState.view = viewName;
        if (viewName !== 'movies' && viewName !== 'mobile-search' && viewName !== 'search') {
            navState.query = null;
        }
    }

    // Clear desktop search box when navigating to another page
    if (viewName !== 'search' && viewName !== 'mobile-search' && viewName !== 'player') {
        const desktopSearch = document.querySelector('.search-input:not(#mobile-search-input)');
        if (desktopSearch) desktopSearch.value = '';
    }

    // 3. Update UI & HIGHLIGHT ACTIVE MENU
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        // Check if this sidebar item matches the current view
        if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(`router('${viewName}')`)) {
            el.classList.add('active');
        }
    });

    document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.b-nav-item').forEach(el => el.classList.remove('active'));

    if (viewName !== 'player') {
        document.getElementById('iframe-box').innerHTML = '';
    }

    if (viewName === 'home') {
        document.querySelectorAll('.b-nav-item')[0]?.classList.add('active');
        loadHome();
    } else if (viewName === 'mobile-search') {
        document.querySelectorAll('.b-nav-item')[1]?.classList.add('active');
    } else {
        document.querySelectorAll('.b-nav-item')[2]?.classList.add('active');
        document.querySelector('.main-content').scrollTop = 0;
        if (viewName === 'movies') loadMoviesPage();
        if (viewName === 'tv') loadTVPage();
        if (viewName === 'anime') loadAnimePage();
        if (viewName === 'watchlist') renderLibrary('watchlist-grid', 'watchlist');
        if (viewName === 'history') renderLibrary('history-grid', 'history');
    }
}

// --- API HELPER ---
async function fetchAPI(endpoint) {
    // 1. Check local memory first (Fastest)
    if (prefetchedData[endpoint]) {
        return prefetchedData[endpoint];
    }

    // 2. Check Browser Session Storage (Survives page reloads)
    const cacheKey = 'tmdb_' + endpoint;
    const cachedStr = sessionStorage.getItem(cacheKey);
    if (cachedStr) {
        const cachedData = JSON.parse(cachedStr);
        prefetchedData[endpoint] = cachedData; // Put back in memory
        return cachedData;
    }

    // 3. If not cached, fetch from your Cloudflare Worker
    const res = await fetch(
  `${WORKER_URL}/?endpoint=${encodeURIComponent(endpoint)}`
);
    const data = await res.json();

    // 4. Save the result so we don't hit the worker again this session
    prefetchedData[endpoint] = data;
    try {
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
        console.warn("Session storage full");
    }

    return data;
}


// --- HOME & CATEGORIES ---
async function refreshHomeHistory() {
    const continueSection = document.getElementById('continue-watching-section');
    if (!continueSection) return;

    let historyList = getLib('history') || [];

    if (historyList.length > 0) {
        historyList.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

        continueSection.style.display = 'block';
        renderGrid(historyList.slice(0, 4), 'home-history');
    } else {
        continueSection.style.display = 'none';
    }
}


async function loadHome() {
    showSkeletons('hero-slider', 1); showSkeletons('home-bollywood', 6); showSkeletons('home-hollywood', 6); showSkeletons('home-tv', 6);
    const continueSection = document.getElementById('continue-watching-section');
    if (continueSection) { continueSection.style.display = 'block'; showSkeletons('home-history', 4); }
    const today = new Date().toISOString().split('T')[0];
    const currentRegion = appSettings.region || 'IN';
    const regionSelect = document.getElementById('set-region');
    let regionName = "Local";
    if (regionSelect && regionSelect.selectedIndex > -1) regionName = regionSelect.options[regionSelect.selectedIndex].text;
    const titleEl = document.getElementById('local-title');
    if (titleEl) titleEl.innerText = `Latest ${regionName} Movies`;
    const hTitle = document.getElementById('hollywood-title');
    if (hTitle) hTitle.innerText = (currentRegion !== 'US') ? "Latest Hollywood" : "Trending Worldwide";
    let localQuery;

    if (currentRegion === "IN") {
        // True Bollywood (Hindi)
        localQuery = `/discover/movie?with_original_language=hi&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&vote_count.gte=5`;
    } else {
        // Other regions still use origin country
        localQuery = `/discover/movie?with_origin_country=${currentRegion}&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&vote_count.gte=5`;
    }
    const hollyQuery = currentRegion !== 'US' ? `/discover/movie?with_origin_country=US&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&vote_count.gte=5` : '/movie/trending/week';
    // 1. FETCH AND RENDER THE SLIDER FIRST (Crucial for LCP)
    try {
        const trending = await fetchAPI('/trending/all/week');
        let slides = [];
        if (trending && trending.results) {
            slides = trending.results.filter(item => item.backdrop_path).slice(0, 5);
        }
        renderSlider(slides); // Paint the slider to the screen instantly!
    } catch (error) {
        console.error("Slider Load Error:", error);
    }

    // 2. FETCH THE REST OF THE GRIDS AFTERWARD
    try {
        const [localMovies, hollyData, tvShows] = await Promise.all([
            fetchAPI(localQuery),
            fetchAPI(hollyQuery),
            fetchAPI('/trending/tv/week')
        ]);

        renderGrid(localMovies ? localMovies.results : [], 'home-bollywood');
        renderGrid(hollyData ? hollyData.results : [], 'home-hollywood');
        renderGrid(tvShows ? tvShows.results : [], 'home-tv', 'tv');

        // Background Prefetching for other pages
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                prefetchEndpoint('/movie/popular');
                prefetchEndpoint('/tv/top_rated');
                prefetchEndpoint('/discover/tv?with_genres=16&with_origin_country=JP');
            });
        } else {
            setTimeout(() => {
                prefetchEndpoint('/movie/popular');
                prefetchEndpoint('/tv/top_rated');
                prefetchEndpoint('/discover/tv?with_genres=16&with_origin_country=JP');
            }, 2000);
        }
    } catch (error) {
        console.error("Home Data Load Error:", error);
    }
    await refreshHomeHistory();
}

function renderSlider(items) {
    const container = document.getElementById('hero-slider');
    if (!container) return;
    container.innerHTML = '';
    items.forEach((item, index) => {
        if (!item) return;
        const type = item.media_type || (item.name ? 'tv' : 'movie');
        const title = item.title || item.name;
        const activeClass = index === 0 ? 'active' : '';
        let bg = '';
        if (item.backdrop_path) {
            bg = `https://wsrv.nl/?url=image.tmdb.org/t/p/w1280${item.backdrop_path}&output=webp`;

            // Preload the very first slider image as ultra-high priority
            if (index === 0) {
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'image';
                link.href = bg;
                link.imageSrcset = `${bg}`;
                link.setAttribute('fetchpriority', 'high');
                document.head.appendChild(link);
            }
        }
        const slide = document.createElement('div');
        slide.className = `slide ${activeClass}`;
        slide.style.backgroundImage = `url(${bg})`;
        slide.innerHTML = `<div class="hero-content"><div style="margin-bottom:10px;"><span style="background:var(--accent); color:white; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:12px;">#${index + 1} Spotlight</span></div><div class="hero-title">${title}</div><div class="hero-desc">${item.overview || ''}</div><button class="btn btn-primary" onclick="openPlayer('${item.id}', '${type}')"><i class="fas fa-play"></i> Watch Now</button></div>`;
        container.appendChild(slide);
    });
    if (slideInterval) clearInterval(slideInterval);
    const slides = document.querySelectorAll('.slide');
    currentSlide = 0;
    slideInterval = setInterval(() => {
        if (slides.length > 0) {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }
    }, 5000);
}

async function loadMoviesPage() { showSkeletons('movies-popular', 6); showSkeletons('movies-top', 6); showSkeletons('movies-action', 6); const [popular, topRated, action] = await Promise.all([fetchAPI('/movie/popular'), fetchAPI('/movie/top_rated'), fetchAPI('/discover/movie?with_genres=28')]); renderGrid(popular.results, 'movies-popular', 'movie'); renderGrid(topRated.results, 'movies-top', 'movie'); renderGrid(action.results, 'movies-action', 'movie'); }
async function loadTVPage() { showSkeletons('tv-airing', 6); showSkeletons('tv-top', 6); const [trending, popular] = await Promise.all([fetchAPI('/tv/on_the_air'), fetchAPI('/tv/top_rated')]); renderGrid(trending.results, 'tv-airing', 'tv'); renderGrid(popular.results, 'tv-top', 'tv'); }
async function loadAnimePage() { showSkeletons('anime-trending', 6); showSkeletons('anime-popular', 6); const [trending, popular] = await Promise.all([fetchAPI('/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc'), fetchAPI('/discover/tv?with_genres=16&with_origin_country=JP&sort_by=vote_count.desc')]); renderGrid(trending.results, 'anime-trending', 'tv'); renderGrid(popular.results, 'anime-popular', 'tv'); }

function renderGrid(items, containerId, forceType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (!items || items.length === 0) {
        container.innerHTML =
            '<div style="color:#666; padding:20px;">No content found.</div>';
        return;
    }

    let visibleCount = 20;
    let currentIndex = 0;

    function renderBatch() {
        const slice = items.slice(currentIndex, currentIndex + visibleCount);

        slice.forEach(item => {
            const posterPath = item.poster_path || item.poster;
            if (!posterPath) return;

            const type =
                item.type ||
                forceType ||
                item.media_type ||
                (item.name ? "tv" : "movie");

            const title = item.title || item.name;
            const dateStr = item.release_date || item.first_air_date || "";
            const year = dateStr ? dateStr.substring(0, 4) : "";

            const card = document.createElement("div");
            card.className = "media-card";
            card.onclick = () => openPlayer(item.id, type);

            const ratingTag = item.vote_average
                ? `<div class="card-rating">${item.vote_average.toFixed(1)}</div>`
                : "";

            // Smart Responsive & Next-Gen WebP Sizing
            const isExternal = posterPath.startsWith("http");

            // Wrap TMDB URLs in the wsrv.nl proxy to force WebP conversion
            const imgUrlSmall = isExternal ? posterPath : `https://wsrv.nl/?url=image.tmdb.org/t/p/w185${posterPath}&output=webp&q=70`;
            const imgUrlMedium = isExternal ? posterPath : `https://wsrv.nl/?url=image.tmdb.org/t/p/w342${posterPath}&output=webp&q=70`;

            card.innerHTML = `
        <div class="poster">
          <img 
            src="${imgUrlSmall}" 
            srcset="${imgUrlSmall} 185w, ${imgUrlMedium} 342w"
            sizes="(max-width: 768px) 110px, 150px"
            loading="lazy" 
            alt="${title}" 
            onerror="this.style.display='none'">
          ${ratingTag}
          <div class="hover-overlay">
            <i class="fas fa-play-circle play-icon"></i>
          </div>
        </div>
        <div class="media-title">${title}</div>
        <div class="media-year">${year} ${type === "tv" ? "• TV" : ""
                }</div>
      `;

            container.appendChild(card);
        });

        currentIndex += visibleCount;
    }

    renderBatch();

    // Remove the old listener for this specific container if it exists
    if (activeScrollHandlers[containerId]) {
        window.removeEventListener("scroll", activeScrollHandlers[containerId]);
    }

    function handleScroll() {
        // Only trigger if this view is actually active, and we are near the bottom
        if (container.closest('.page-view')?.classList.contains('active') || containerId === 'search-res' || containerId === 'mobile-search-results') {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
                // If we've shown all items, stop listening to save performance
                if (currentIndex >= items.length) {
                    window.removeEventListener("scroll", handleScroll);
                    delete activeScrollHandlers[containerId];
                    return;
                }
                renderBatch();
            }
        }
    }
    activeScrollHandlers[containerId] = handleScroll;
    window.addEventListener("scroll", handleScroll, { passive: true });
}

// --- player---
async function openPlayer(id, type, skipPush = false) {
    // 1. Initialize Default State
    let preferredServer = -1;
    // Reset player state completely
    playerState = { id, type, season: 1, episode: 1, anilistId: null, isAnime: false };

    // 2. CHECK HISTORY (LOCAL ONLY)
    let savedState = getLib('history')?.find(i => i.id == id);

    // 3. RESTORE PROGRESS (If found)
    if (savedState) {
        if (type === 'tv') {
            playerState.season = savedState.season || 1;
            playerState.episode = savedState.episode || 1;
            if (playerState.season > 1 || playerState.episode > 1) {
                showToast(`Resumed: S${playerState.season} E${playerState.episode}`, 'info');
            }
        }
        if (savedState.serverIdx !== undefined) {
            preferredServer = savedState.serverIdx;
        }
    }

    // 4. UI Setup & Navigation History Logic
    if (!document.getElementById('view-player').classList.contains('active')) {
        // Only save state if we are entering from outside
    }

    document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
    document.getElementById('view-player').classList.add('active');
    window.scrollTo(0, 0);
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;

    if (!skipPush) {
        const newUrl = `?type=${type}&id=${id}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }
    document.getElementById('iframe-box').innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center;"><i class="fas fa-spinner fa-spin" style="font-size:40px;"></i></div>';

    // 5. Fetch Details from API
    const data = await fetchAPI(`/${type}/${id}`);

    const title = data.title || data.name;
    const desc = data.overview;
    const poster = data.poster_path ? IMG_URL + data.poster_path : '';

    // --- ANIME DETECTION ---
    // --- IMPROVED ANIME DETECTION ---
    const isTV = type === 'tv';

    const isAnime =
        isTV &&
        (
            // Japanese origin
            (data.origin_country && data.origin_country.includes('JP')) ||

            // Japanese language
            data.original_language === 'ja'
        ) &&
        // Must be animation
        (data.genres && data.genres.some(g => g.id === 16));


    playerState.title = title;
    playerState.poster = poster;
    playerState.isAnime = isAnime;

    // --- SMART SERVER SELECTION ---
    if (preferredServer === -1) {
        preferredServer = servers.findIndex(s => !!s.isAnime === isAnime);
        // Fallback: If no matching server found, use index 0 (but careful if 0 is anime and we are watching movie)
        if (preferredServer === -1) {
            // If we are watching non-anime, find first non-anime server
            if (!isAnime) preferredServer = servers.findIndex(s => !s.isAnime);
            // If we are watching anime, find first anime server
            else preferredServer = servers.findIndex(s => s.isAnime);

            // Absolute fallback
            if (preferredServer === -1) {
        // خلي Playmogo TV هو الافتراضي للمسلسلات
        if (type === 'tv') {
            const playmogoIdx = servers.findIndex(s => s.name.includes('Playmogo TV') || s.name === 'Playmogo TV');
            preferredServer = playmogoIdx !== -1 ? playmogoIdx : 0;
        } else {
            // للأفلام خلي 1vid هو الافتراضي
            const vid1Idx = servers.findIndex(s => s.name.includes('1vid'));
            preferredServer = vid1Idx !== -1 ? vid1Idx : 0;
        }
    }
        }
    }

    // --- ANIME SPECIFIC LOGIC ---
    if (isAnime) {
        const targetSeason = playerState.season || 1;
        const anilistId = await fetchAnilistId(title, targetSeason);
        if (anilistId) {
            playerState.anilistId = anilistId;
        }
    }

    // --- UI RENDERING (Common for both) ---
    const year = (data.release_date || data.first_air_date || '').substring(0, 4);
    const genres = data.genres ? data.genres.map(g => g.name).slice(0, 2).join(', ') : '';
    const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';

    // Panels Setup
    const rightPanel = document.getElementById('episode-panel');
    const bottomDetails = document.querySelector('.media-details-box');
    if (rightPanel) rightPanel.innerHTML = '';
    if (bottomDetails) bottomDetails.innerHTML = '';

    if (type === 'movie') {
        if (rightPanel) {
            rightPanel.style.display = 'flex';
            const status = data.status || "Released";
            const studio = (data.production_companies && data.production_companies.length > 0) ? data.production_companies[0].name : "Unknown";
            const date = data.release_date || "N/A";

            rightPanel.innerHTML = `
                <div class="movie-sidebar">
                    <div class="movie-sidebar-header">
                        <img src="${poster}" class="sidebar-poster" alt="${title}">
                        <div class="sidebar-meta-info">
                            <div class="meta-item"><span class="meta-label">Status</span><span class="meta-value">${status}</span></div>
                            <div class="meta-item"><span class="meta-label">Production</span><span class="meta-value">${studio}</span></div>
                            <div class="meta-item"><span class="meta-label">Aired</span><span class="meta-value">${date}</span></div>
                        </div>
                    </div>
                    <div class="movie-sidebar-body">
                        <h1>${title}</h1>
                        <div class="sidebar-badges">
                            <span class="badge-year">${year}</span>
                            <span class="badge-rating">${rating}</span>
                        </div>
                        <div class="sidebar-buttons">
                            <button class="s-btn s-btn-red" id="watchlist-btn-movie"><i class="far fa-heart"></i> Watchlist </button>
                            <button class="s-btn s-btn-green" onclick="downloadContent()"><i class="fas fa-download"></i> Download</button>
                            <button onclick="shareContent('${title.replace(/'/g, "\\'")}')" class="s-btn s-btn-gray"><i class="fas fa-share-alt"></i> Share</button>
                        </div>
                        <div class="sidebar-desc">${desc}</div>
                    </div>
                </div>
            `;
        }
        setTimeout(() => setupWatchlistBtn(id, 'watchlist-btn-movie', type, title, data.poster_path), 0);

    } else {
        if (rightPanel) {
            rightPanel.style.display = 'flex';
            rightPanel.innerHTML = `
                <div class="ep-header">
                    <select id="season-select" onchange="loadSeason(this.value)"></select>
                    <div class="view-toggles">
                        <i class="fas fa-list active" onclick="setEpView('list')"></i>
                        <i class="fas fa-th-large" onclick="setEpView('grid')"></i>
                    </div>
                </div>
                <div id="episode-list-box" class="ep-container list-view"></div>
            `;
        }
        if (bottomDetails) {
            // Extract TV specific data for the meta info box
            const tvStatus = data.status || "Airing";
            const tvNetwork = (data.networks && data.networks.length > 0) ? data.networks[0].name : "Unknown";
            const tvDate = data.first_air_date || "N/A";

            bottomDetails.innerHTML = `
                <div class="movie-sidebar tv-details-card">
                    <div class="movie-sidebar-header">
                        <img src="${poster}" class="sidebar-poster" alt="${title}">
                        <div class="sidebar-meta-info">
                            <div class="meta-item"><span class="meta-label">Status</span><span class="meta-value">${tvStatus}</span></div>
                            <div class="meta-item"><span class="meta-label">Network</span><span class="meta-value">${tvNetwork}</span></div>
                            <div class="meta-item"><span class="meta-label">Aired</span><span class="meta-value">${tvDate}</span></div>
                        </div>
                    </div>
                    <div class="movie-sidebar-body">
                        <h1 style="margin-top: 15px;">${title}</h1>
                        <div class="sidebar-badges">
                            <span class="badge-year">${year}</span>
                            <span class="badge-rating">${rating}</span>
                            <span style="font-size: 13px; color: var(--text-muted); margin-left: 5px;">${genres}</span>
                        </div>
                        <div class="sidebar-buttons">
                            <button class="s-btn s-btn-red" id="watchlist-btn-tv"><i class="far fa-heart"></i> Watchlist </button>
                            <button class="s-btn s-btn-green" onclick="downloadContent()"><i class="fas fa-download"></i> Download</button>
                            <button onclick="shareContent('${title.replace(/'/g, "\\'")}')" class="s-btn s-btn-gray"><i class="fas fa-share-alt"></i> Share</button>
                        </div>
                        <div class="sidebar-desc">${desc}</div>
                    </div>
                </div>
            `;
        }
        setTimeout(() => setupWatchlistBtn(id, 'watchlist-btn-tv', type, title, data.poster_path), 0);

        const sSelect = document.getElementById('season-select');
        if (sSelect && data.seasons) {
            sSelect.innerHTML = '';
            data.seasons.forEach(s => {
                if (s.season_number > 0) {
                    const opt = document.createElement('option');
                    opt.value = s.season_number;
                    opt.innerText = s.name;
                    sSelect.appendChild(opt);
                }
            });
            sSelect.value = playerState.season;
        }

        await loadSeason(playerState.season);
        setTimeout(() => {
            const activeEp = document.querySelector('.ep-item.active');
            const box = document.getElementById('episode-list-box');
            if (activeEp && box) {
                const epTop = activeEp.getBoundingClientRect().top;
                const boxTop = box.getBoundingClientRect().top;
                box.scrollTo({
                    top: box.scrollTop + (epTop - boxTop) - (box.clientHeight / 2) + (activeEp.clientHeight / 2),
                    behavior: 'smooth'
                });
            }
        }, 300);
    }

    renderServers(preferredServer);
    loadVideo(preferredServer);

    // --- RECOMMENDATIONS (GUARANTEED TO RUN) ---
    // Fetch recommendations for EVERY type (movie/tv/anime)
    // --- RECOMMENDATIONS (FULLY FIXED FOR MOVIE / TV / ANIME) ---
    try {
        const recContainer = document.getElementById('player-recommendations');

        if (recContainer) {
            recContainer.innerHTML =
                '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading recommendations...</div>';
        }

        // Try recommendations first
        let recs = await fetchAPI(`/${type}/${id}/recommendations`);

        // If empty → fallback to similar
        if (!recs || !recs.results || recs.results.length === 0) {
            recs = await fetchAPI(`/${type}/${id}/similar`);
        }

        if (recs && recs.results && recs.results.length > 0) {
            renderGrid(
                recs.results.filter(i => i.poster_path).slice(0, 12),
                'player-recommendations',
                type
            );
        } else {
            if (recContainer) {
                recContainer.innerHTML =
                    '<div style="color:#666; padding:20px;">No recommendations available.</div>';
            }
        }

    } catch (e) {
        console.error("Recommendations Error:", e);
    }

    window.scrollTo(0, 0);
    const finalMainContent = document.querySelector('.main-content');
    if (finalMainContent) finalMainContent.scrollTop = 0;

}

function setupWatchlistBtn(id, btnId, type, title, poster) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    updateWatchlistBtnStyles(id, btnId);
    btn.onclick = () => {
        toggleLib('watchlist', id, type, title, poster);
        setTimeout(() => updateWatchlistBtnStyles(id, btnId), 200);
    };
}

async function updateWatchlistBtnStyles(id, btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const watchlist = getLib('watchlist') || [];
    const exists = watchlist.find(i => i.id == id);

    if (exists) {
        btn.innerHTML = '<i class="fas fa-check"></i> Added';

        if (btn.classList.contains('s-btn')) {
            btn.classList.remove('s-btn-red');
            btn.classList.add('s-btn-gray');
        } else if (btn.classList.contains('btn-primary')) {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-glass');
        }
    } else {
        btn.innerHTML = '<i class="far fa-heart"></i> Watchlist';

        if (btn.classList.contains('s-btn')) {
            btn.classList.remove('s-btn-gray');
            btn.classList.add('s-btn-red');
        } else if (btn.classList.contains('btn-glass')) {
            btn.classList.remove('btn-glass');
            btn.classList.add('btn-primary');
        }
    }
}

function shareContent(title) {
    if (navigator.share) { navigator.share({ title: 'Watch on StreameX', text: `Check out "${title}" on StreameX!`, url: window.location.href }).catch(console.error); }
    else { navigator.clipboard.writeText(window.location.href); showToast('Link copied!'); }
}

async function loadSeason(seasonNum) {
    playerState.season = seasonNum;
    const box = document.getElementById('episode-list-box');
    if (box) box.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    // --- ANIME SEASON UPDATE ---
    if (playerState.isAnime) {
        // When changing season, get the new Anilist ID for that specific season
        const newAnilistId = await fetchAnilistId(playerState.title, seasonNum);
        if (newAnilistId) {
            playerState.anilistId = newAnilistId;
            // Reload the player if it's currently playing to update the ID
            const iframeBox = document.getElementById('iframe-box');
            if (iframeBox && iframeBox.innerHTML.includes('iframe')) {
                const currentServerBtn = document.querySelector('.server-btn.active');
                const fallbackIdx = servers.findIndex(s => !!s.isAnime === playerState.isAnime);
                const serverIdx = currentServerBtn ? parseInt(currentServerBtn.dataset.index) : (fallbackIdx !== -1 ? fallbackIdx : 0);
                // Only reload if using an Anime server
                if (servers[serverIdx].isAnime) loadVideo(serverIdx);
            }
        }
    }
    // ----------------------------

    const data = await fetchAPI(`/tv/${playerState.id}/season/${seasonNum}`);
    seasonData = data.episodes || [];
    renderEpisodeList();
}

function setEpView(view) {
    episodeView = view;
    document.querySelector('.fa-list')?.classList.toggle('active', view === 'list');
    document.querySelector('.fa-th-large')?.classList.toggle('active', view === 'grid');
    const box = document.getElementById('episode-list-box');
    if (box) box.className = `ep-container ${view}-view`;
    renderEpisodeList();
}

function renderEpisodeList() {
    const box = document.getElementById('episode-list-box');
    if (!box) return;
    box.innerHTML = '';
    if (!seasonData.length) { box.innerHTML = '<div style="padding:10px; color:#666;">No episodes found.</div>'; return; }
    seasonData.forEach(ep => {
        const div = document.createElement('div');
        div.className = `ep-item ${ep.episode_number == playerState.episode ? 'active' : ''}`;
        div.onclick = () => {
            playerState.episode = ep.episode_number;
            renderEpisodeList();
            // Determine active server using the saved dataset index
            const currentServerBtn = document.querySelector('.server-btn.active');
            const fallbackIdx = servers.findIndex(s => !!s.isAnime === playerState.isAnime);
            const serverIdx = currentServerBtn ? parseInt(currentServerBtn.dataset.index) : (fallbackIdx !== -1 ? fallbackIdx : 0);
            loadVideo(serverIdx);
        };
        // Force WebP for episode thumbnails
        const imgUrl = ep.still_path ? `https://wsrv.nl/?url=image.tmdb.org/t/p/w185${ep.still_path}&output=webp` : '';
        if (episodeView === 'list') {
            div.innerHTML = `<div class="ep-number">${ep.episode_number}</div><div class="ep-info"><div class="ep-title">${ep.name}</div></div>`;
        } else {
            div.innerHTML = `<div class="ep-thumb">${imgUrl ? `<img src="${imgUrl}" loading="lazy">` : '<div style="width:100%;height:100%;background:#222;"></div>'}</div><div class="ep-info"><div class="ep-title"><span style="color:var(--accent); font-weight:bold;">${ep.episode_number}.</span> ${ep.name}</div></div>`;
        }
        box.appendChild(div);
    });
}

function closePlayer() {
    restoreLastState();
}

function renderServers(activeIdx = -1) {
    const list = document.getElementById('server-list');
    if (!list) return;
    list.innerHTML = '';
    const isTV = playerState.type === 'tv';

    function createHeader(title) {
        const h = document.createElement('div');
        h.innerHTML = title;
        h.style.gridColumn = '1 / -1';
        h.style.color = '#4caf50';
        h.style.fontSize = '13px';
        h.style.fontWeight = '700';
        h.style.marginTop = '15px';
        h.style.marginBottom = '5px';
        h.style.borderBottom = '1px solid #333';
        h.style.paddingBottom = '5px';
        return h;
    }

    function renderGroup(group, headerTitle) {
        if (group.length === 0) return;
        if (headerTitle) list.appendChild(createHeader(headerTitle));
        group.forEach((srv) => {
            const realIdx = servers.indexOf(srv);
            const btn = document.createElement('div');
            btn.className = `server-btn ${realIdx === activeIdx ? 'active' : ''}`;
            btn.dataset.index = realIdx;
            // تمييز العربي
            const arBadge = srv.lang === 'ar' ? ' 🇪🇬' : '';
            btn.innerHTML = `<i class="fas fa-play"></i> ${srv.name}${arBadge}`;
            btn.onclick = () => {
                document.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                loadVideo(realIdx);
            };
            list.appendChild(btn);
        });
    }

    if (isTV) {
        renderGroup(tvPlaybackServers, '<i class="fas fa-server"></i> سيرفرات تشغيل فقط');
        renderGroup(tvArabicServers, '<i class="fas fa-closed-captioning"></i> سيرفرات ترجمة عربية ثابتة (زي احواك)');
    } else {
        renderGroup(playbackServers, '<i class="fas fa-server"></i> سيرفرات تشغيل فقط - سريعة');
        renderGroup(arabicServers, '<i class="fas fa-closed-captioning"></i> سيرفرات ترجمة - عربي ثابت (Voe, Mixdrop...)');
    }
}


async function loadVideo(serverIdx) {
    const iframeBox = document.getElementById('iframe-box');
    if (!playerState) playerState = { season: 1, episode: 1 };
    iframeBox.innerHTML = `<div style="display:flex; height:100%; width:100%; align-items:center; justify-content:center; flex-direction:column; color:#fff; background:#000;"><i class="fas fa-circle-notch fa-spin" style="font-size:40px; margin-bottom:15px; color:var(--accent);"></i><div style="font-family:sans-serif; font-size:14px; opacity:0.8;">جاري تحميل الفيلم مترجم عربي تلقائي...</div><div style="font-size:11px; opacity:0.6; margin-top:8px;">الترجمة العربية هتشتغل لوحدها</div></div>`;
    updateHistory(serverIdx);
    const srv = servers[serverIdx];
    if (!srv) { iframeBox.innerHTML = '<div style="color:red; padding:20px;">Error: Server not found.</div>'; return; }
    try {
        let targetId = srv.isAnime && playerState.anilistId ? playerState.anilistId : playerState.id;
        let url = srv.embed.replace('{id}', targetId).replace('{season}', playerState.season || 1).replace('{episode}', playerState.episode || 1);
        // اضافة باراميتر الترجمة العربية التلقائية لو مش موجود
        if (srv.autoCC && !url.includes('cc=')) {
            url += (url.includes('?') ? '&' : '?') + 'cc=ar&lang=ar';
        }
        iframeBox.innerHTML = `<iframe id="main-player-iframe" src="${url}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer" style="width:100%; height:100%;"></iframe><div style="position:absolute; bottom:10px; left:10px; background:rgba(76,175,80,0.9); color:#fff; padding:4px 10px; border-radius:20px; font-size:11px; z-index:10; font-family:sans-serif;"><i class="fas fa-closed-captioning"></i> عربي تلقائي - لو مظهرتش دوس CC واختار Arabic</div>`;
        showToast('الترجمة العربية هتشتغل تلقائي 🇪🇬', 'success');
        // محاولة لاختيار العربي تلقائي عبر localStorage لبعض المشغلات
        try { localStorage.setItem('player_cc_lang', 'ar'); localStorage.setItem('subtitle_lang', 'ar'); } catch(e){}
    } catch (error) {
        console.error("Video Load Error:", error);
        iframeBox.innerHTML = `<div style="text-align:center; padding:20px; color:#ff4444;">Stream Error: ${error.message}<br><small>جرب سيرفر تاني</small></div>`;
    }
}

// --- AUTO ARABIC SUBTITLE FETCHER (Option 1 - OpenSubtitles) ---
async function fetchArabicSubtitleAuto(tmdbId, type='movie') {
    try {
        // جيب IMDB ID من TMDB
        const ext = await fetchAPI(`/${type}/${tmdbId}/external_ids`);
        const imdbId = ext.imdb_id;
        if (!imdbId) return null;
        console.log('[AR SUB] IMDB:', imdbId);
        // هنا تقدر تضيف API Key بتاع OpenSubtitles او SubDL
        // مثال: const subRes = await fetch(`https://api.subdl.com/api/v1/subtitles?api_key=YOUR_KEY&filmId=${imdbId}&languages=ar`);
        // للتجربة هنستخدم VidLink اللي فيه عربي تلقائي
        return null;
    } catch(e) { console.error('Subtitle fetch failed', e); return null; }
}







// --- HELPERS ---
function getLib(key) { return JSON.parse(localStorage.getItem('streamex_' + key)) || []; }
function saveLib(key, data) { localStorage.setItem('streamex_' + key, JSON.stringify(data)); }
function handleSearch(e) {
    if (e.key === 'Enter') {
        const query = e.target.value;
        if (!query) return;

        // Use the smart search function to handle everything (saving state, etc)
        performLiveSearch(query);
    }
}
function toggleMobileMenu() { document.getElementById('mobile-menu-overlay')?.classList.toggle('active'); }
function openMobileSearch() { document.getElementById('mobile-menu-overlay')?.classList.remove('active'); router('mobile-search'); setTimeout(() => { document.getElementById('mobile-search-input')?.focus(); }, 100); }
function clearData(key) { if (confirm('Are you sure?')) { localStorage.removeItem('streamex_' + key); location.reload(); } }
function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '<i class="fas fa-check-circle" style="color:#4caf50;"></i>' : '<i class="fas fa-info-circle" style="color:#2196f3;"></i>';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); if (container.children.length === 0) container.remove(); }, 3000);
}
function showSkeletons(containerId, count = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) { container.innerHTML += `<div class="media-card sk-card"><div class="poster skeleton sk-poster"></div><div class="skeleton sk-text"></div><div class="skeleton sk-meta"></div></div>`; }
}
let searchTimer;
function handleSmartSearch(query) {
    clearTimeout(searchTimer);
    if (!query || query.trim().length === 0) {
        const mobileView = document.getElementById('view-mobile-search');
        if (mobileView && mobileView.classList.contains('active')) { document.getElementById('mobile-search-results').innerHTML = ''; }
        else { router('home'); }
        return;
    }
    if (query.length < 2) return;
    searchTimer = setTimeout(() => { performLiveSearch(query); }, 500);
}

function performLiveSearch(query) {
    // 1. Save the query to history
    navState.query = query;

    let resultContainerId = 'search-res';
    const mobileView = document.getElementById('view-mobile-search');

    if (mobileView && mobileView.classList.contains('active')) {
        resultContainerId = 'mobile-search-results';
        navState.view = 'mobile-search';
    } else {
        // USE THE NEW SEARCH VIEW INSTEAD OF DESTROYING THE MOVIES PAGE
        router('search');
        navState.query = query; // Ensure query persists
        const searchTitle = document.getElementById('search-title');
        if (searchTitle) {
            searchTitle.innerHTML = `Results for: "<span style="color:var(--accent)">${query}</span>"`;
        }
    }

    showSkeletons(resultContainerId, 6);

    fetchAPI(`/search/multi?query=${encodeURIComponent(query)}`).then(data => {
        const filtered = data.results.filter(i => i.media_type !== 'person' && i.poster_path);
        if (filtered.length === 0) {
            document.getElementById(resultContainerId).innerHTML = '<div style="color:#888; padding:20px;">No matches found. Check spelling?</div>';
        } else {
            renderGrid(filtered, resultContainerId);
        }
    });
}

function updateHistory(serverIdx) {
    const item = {
        id: playerState.id,
        type: playerState.type,
        title: playerState.title || "Unknown Title",
        poster: playerState.poster || "",
        season: playerState.season,
        episode: playerState.episode,
        serverIdx: serverIdx,
        savedAt: Date.now()
    };

    let history = getLib('history') || [];

    // Remove existing entry
    history = history.filter(i => i.id != item.id);

    // Add to top
    history.unshift(item);

    // Keep only latest 50
    if (history.length > 50) history.pop();

    saveLib('history', history);
}

async function downloadContent() {
    // Extract season and episode alongside id and type
    const { id, type, season, episode } = playerState;

    // Define primary URL
    const primaryUrl = `https://zxcstream.xyz/download/${type}/${id}`;

    // Define fallback URL
    let fallbackUrl = `https://media.trendingpie.com/?id=${id}`;

    // Check if it's a TV show to append season and episode
    if (type === 'tv') {
        // Use the selected season/episode, or default to 1 if undefined
        const s = season || 1;
        const e = episode || 1;
        fallbackUrl += `&s=${s}&e=${e}`;
    }

    showToast("Preparing download link...", "info");

    try {
        // Attempt to ping the primary server
        await fetch(primaryUrl, { method: 'HEAD', mode: 'no-cors' });

        // If the ping succeeds, open the primary link
        window.open(primaryUrl, '_blank');

        // Show the manual fallback toast in case of a 404
        setTimeout(() => {
            showToast(`Not working? <a href="${fallbackUrl}" target="_blank" style="color: #ffeb3b; font-weight: bold; text-decoration: underline;">Try Server 2</a>`, 'info');
        }, 1000);

    } catch (error) {
        // If the ping fails completely, open the fallback automatically
        console.warn("Primary download server is unreachable, switching to fallback.", error);

        showToast("Primary server down. Opening Fallback...", "success");
        window.open(fallbackUrl, '_blank');
    }
}

function restoreLastState() {
    // 1. Hide Player
    document.getElementById('view-player').classList.remove('active');
    document.getElementById('iframe-box').innerHTML = '';

    // 2. Check if we had a search query
    if (navState.query) {
        // If we were searching, restore the view AND the results
        if (navState.view === 'mobile-search') {
            router('mobile-search');
            performLiveSearch(navState.query);
        } else {
            // Desktop/Standard search (lives in 'movies' view)
            router('movies');
            navState.query = navState.query; // Ensure query persists
            performLiveSearch(navState.query);
        }
    } else {
        // 3. No search? Just go back to the previous page (Home, Anime, TV, etc.)
        router(navState.view || 'home');
    }
}

// --- SIDEBAR TOGGLE LOGIC ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggle-icon');

    // Toggle the 'collapsed' class
    sidebar.classList.toggle('collapsed');

    // Change the arrow icon direction
    if (sidebar.classList.contains('collapsed')) {
        icon.classList.remove('fa-chevron-left');
        icon.classList.add('fa-chevron-right');
    } else {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-left');
    }
}

// ServiceWorker disabled - was causing cache issues
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
}

// Online/Offline Detection Logic
const statusToast = document.getElementById('connection-status');

function showConnectionStatus(message, isOnline) {
    if (!statusToast) return;

    // Set the text and update classes
    statusToast.textContent = message;
    statusToast.className = `connection-toast show ${isOnline ? 'toast-online' : 'toast-offline'}`;

    // If we are back online, hide the message after 3 seconds
    if (isOnline) {
        setTimeout(() => {
            statusToast.classList.remove('show');
        }, 3000);
    }
}

// Listen for the browser losing internet connection
window.addEventListener('offline', () => {
    showConnectionStatus('You are offline. Showing cached movies.', false);
});

// Listen for the browser regaining internet connection
window.addEventListener('online', () => {
    showConnectionStatus('Back online! Ready to stream new movies.', true);
});

// --- EXPOSE TO HTML ---
window.router = router;
window.openPlayer = openPlayer;
window.shareContent = shareContent;
window.loadSeason = loadSeason;
window.setEpView = setEpView;
window.handleSearch = handleSearch;
window.toggleMobileMenu = toggleMobileMenu;
window.openMobileSearch = openMobileSearch;
window.closePlayer = closePlayer;
window.clearData = clearData;
window.toggleLib = toggleLib;
window.saveSettings = saveSettings;
window.loadVideo = loadVideo;
window.toggleMobileMenu = toggleMobileMenu;
window.showToast = showToast;
window.handleSmartSearch = handleSmartSearch;
window.downloadContent = downloadContent;
window.toggleSidebar = toggleSidebar;
