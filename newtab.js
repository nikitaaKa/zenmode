const searchForm = document.querySelector(".zen-newtab-search");
const searchInput = searchForm.querySelector("input");
const searchIcon = document.getElementById("search-mode-icon");
const brandMark = document.querySelector(".zen-newtab-mark");
const modeBtns = document.querySelectorAll(".zen-mode-btn");

let currentMode = "search";

chrome.storage?.local?.get("newtab_search_mode", (result) => {
  if (result && result.newtab_search_mode) {
    setMode(result.newtab_search_mode);
  }
});

function setMode(mode) {
  currentMode = mode;
  modeBtns.forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  searchForm.classList.remove("is-ai", "is-gemini");
  searchIcon.classList.remove("is-ai", "is-gemini");
  brandMark.classList.remove("is-ai", "is-gemini");

  if (mode === "ai") {
    searchForm.classList.add("is-ai");
    searchIcon.classList.add("is-ai");
    brandMark.classList.add("is-ai");
    searchIcon.innerHTML = "&#10022;";
    searchInput.placeholder = "Ask Google Search in AI Mode...";
  } else if (mode === "gemini") {
    searchForm.classList.add("is-gemini");
    searchIcon.classList.add("is-gemini");
    brandMark.classList.add("is-gemini");
    searchIcon.innerHTML = "&#10023;";
    searchInput.placeholder = "Ask Gemini AI...";
  } else {
    searchIcon.innerHTML = "&#9679;";
    searchInput.placeholder = "Search the web or type a URL...";
  }

  chrome.storage?.local?.set({ newtab_search_mode: mode });
  searchInput.focus();
}

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setMode(btn.dataset.mode);
  });
});

function resolveDestination(raw, mode) {
  const query = raw.trim();
  if (!query) return "";

  if (mode === "ai") {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=50&aep=11`;
  }

  if (mode === "gemini") {
    return `https://gemini.google.com/app?q=${encodeURIComponent(query)}`;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(query)) return query;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(query) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(query)) {
    return `http://${query}`;
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(query) && !query.includes(" ")) {
    return `https://${query}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = resolveDestination(searchInput.value, currentMode);
  if (!url) return;

  chrome.tabs.getCurrent((tab) => {
    if (tab?.id) {
      chrome.runtime.sendMessage({ type: "zen:navigate", tabId: tab.id, url });
    } else {
      window.location.href = url;
    }
  });
});
