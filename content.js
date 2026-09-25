(() => {
  if (window.top !== window) return;
  if (document.getElementById("zenmode-host")) return;

  let enabled = false;
  let panelVisible = false;
  let isBookmarked = false;
  let hideTimeout = null;

  const host = document.createElement("div");
  host.id = "zenmode-host";
  const shadow = host.attachShadow({ mode: "open" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content.css");
  shadow.appendChild(link);

  const container = document.createElement("div");
  container.className = "zenmode-container";
  container.innerHTML = `
    <div class="zenmode-edge" aria-hidden="true"></div>
    <section class="zenmode-panel" aria-label="ZenMode browser controls">
      <div class="zenmode-tab-strip">
        <div class="zenmode-tab-list" aria-label="Open tabs"></div>
        <button class="zenmode-new-tab" data-action="new-tab" title="New tab" aria-label="New tab">&#43;</button>
      </div>
      <div class="zenmode-toolbar">
        <div class="zenmode-brand"><span class="zenmode-mark">z</span><span>ZenMode</span></div>
        <div class="zenmode-divider"></div>
        <button class="zenmode-button" data-action="back" title="Back" aria-label="Back">&#8592;</button>
        <button class="zenmode-button" data-action="forward" title="Forward" aria-label="Forward">&#8594;</button>
        <button class="zenmode-button" data-action="reload" title="Reload" aria-label="Reload">&#8635;</button>
        <div class="zenmode-address-wrap">
          <span class="zenmode-lock">&#9679;</span>
          <input class="zenmode-address" aria-label="Address or search" spellcheck="false" autocomplete="off" />
        </div>
        <button class="zenmode-button" data-action="bookmark" title="Bookmark page" aria-label="Bookmark page">&#9734;</button>
        <div class="zenmode-divider"></div>
        <button class="zenmode-button zenmode-exit" data-action="exit" title="Exit ZenMode (Esc)" aria-label="Exit ZenMode">&#10005;</button>
      </div>
    </section>
  `;
  shadow.appendChild(container);
  document.documentElement.appendChild(host);

  const panel = shadow.querySelector(".zenmode-panel");
  const address = shadow.querySelector(".zenmode-address");
  const tabList = shadow.querySelector(".zenmode-tab-list");
  const bookmarkBtn = shadow.querySelector('[data-action="bookmark"]');
  let hostTabId = null;

  function sendMessage(message) {
    if (hostTabId) return chrome.runtime.sendMessage({ ...message, tabId: hostTabId });
    return chrome.runtime.sendMessage(message);
  }

  function escapeHTML(value) {
    return String(value || "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
    }[ch]));
  }

  function renderTabs(tabs) {
    tabList.innerHTML = tabs.map((tab) => {
      const title = escapeHTML(tab.title || "New tab");
      const icon = tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")
        ? `<img class="zenmode-tab-favicon" src="${escapeHTML(tab.favIconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';" /><span class="zenmode-tab-dot" style="display:none;"></span>`
        : `<span class="zenmode-tab-dot"></span>`;

      return `
        <div class="zenmode-tab-item${tab.active ? " is-active" : ""}" data-tab-id="${tab.id}" title="${title}">
          ${icon}
          <span class="zenmode-tab-title">${title}</span>
          <button class="zenmode-tab-close" data-close-tab="${tab.id}" title="Close tab">&#10005;</button>
        </div>
      `;
    }).join("");
  }

  function requestTabs() {
    sendMessage({ type: "zen:get-tabs" }).then((response) => {
      if (response?.tabs) renderTabs(response.tabs);
    }).catch(() => {});
  }

  function checkBookmark() {
    sendMessage({ type: "zen:check-bookmark", url: window.location.href }).then((response) => {
      isBookmarked = response?.bookmarked ?? false;
      updateBookmarkUI();
    }).catch(() => {});
  }

  function updateBookmarkUI() {
    if (isBookmarked) {
      bookmarkBtn.innerHTML = "&#9733;";
      bookmarkBtn.classList.add("is-active");
      bookmarkBtn.title = "Remove bookmark";
    } else {
      bookmarkBtn.innerHTML = "&#9734;";
      bookmarkBtn.classList.remove("is-active");
      bookmarkBtn.title = "Bookmark page";
    }
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    container.classList.toggle("zenmode-enabled", enabled);
    if (!enabled) {
      panelVisible = false;
      container.classList.remove("zenmode-visible");
    } else {
      address.value = window.location.href;
      requestTabs();
      checkBookmark();
    }
  }

  function showPanel() {
    if (!enabled) return;
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    panelVisible = true;
    container.classList.add("zenmode-visible");
  }

  function hidePanel() {
    if (!enabled) return;
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (shadow.activeElement === address) return;
      panelVisible = false;
      container.classList.remove("zenmode-visible");
    }, 220);
  }

  window.addEventListener("mousemove", (event) => {
    if (event.clientY <= 64) {
      showPanel();
    }
  });

  panel.addEventListener("mouseenter", showPanel);
  panel.addEventListener("mouseleave", hidePanel);

  container.addEventListener("click", (event) => {
    const path = event.composedPath();

    const closeBtn = path.find((el) => el.dataset && el.dataset.closeTab !== undefined);
    if (closeBtn) {
      event.preventDefault();
      event.stopPropagation();
      const tabId = Number(closeBtn.dataset.closeTab);
      chrome.runtime.sendMessage({ type: "zen:close-tab", targetTabId: tabId });
      const tabElement = closeBtn.closest(".zenmode-tab-item");
      if (tabElement) tabElement.remove();
      return;
    }

    const tabItem = path.find((el) => el.dataset && el.dataset.tabId !== undefined);
    if (tabItem) {
      event.preventDefault();
      event.stopPropagation();
      const tabId = Number(tabItem.dataset.tabId);
      chrome.runtime.sendMessage({ type: "zen:select-tab", tabId });
      return;
    }

    const button = path.find((el) => el.dataset && el.dataset.action !== undefined);
    if (!button) return;
    const action = button.dataset.action;
    if (action === "back") history.back();
    if (action === "forward") history.forward();
    if (action === "reload") window.location.reload();
    if (action === "new-tab") sendMessage({ type: "zen:tab" });
    if (action === "bookmark") {
      sendMessage({ type: "zen:toggle-bookmark" }).then((res) => {
        isBookmarked = res?.bookmarked ?? false;
        updateBookmarkUI();
      }).catch(() => {});
    }
    if (action === "exit") sendMessage({ type: "zen:toggle" });
  });

  address.addEventListener("focus", () => {
    address.select();
    showPanel();
  });

  address.addEventListener("blur", () => {
    hidePanel();
  });

  function resolveDestination(raw) {
    const text = raw.trim();
    if (!text) return "";
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return text;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) {
      return `http://${text}`;
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(text) && !text.includes(" ")) {
      return `https://${text}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  }

  address.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const url = resolveDestination(address.value);
    if (url) {
      sendMessage({ type: "zen:navigate", url });
      address.blur();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && enabled) {
      if (document.activeElement === address || shadow.activeElement === address) {
        address.blur();
      } else {
        sendMessage({ type: "zen:toggle" });
      }
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "zen:ping") {
      sendResponse({ ready: true });
      return;
    }
    if (message.type === "zen:tabs-updated") {
      if (enabled) requestTabs();
      return;
    }
    if (message.type === "zen:set-enabled") {
      setEnabled(message.enabled);
      sendResponse({ enabled });
      return;
    }
    if (message.type === "zen:toggle") {
      setEnabled(!enabled);
      sendResponse({ enabled });
    }
  });

  if (chrome.tabs?.getCurrent) {
    chrome.tabs.getCurrent((tab) => {
      hostTabId = tab?.id || null;
      sendMessage({ type: "zen:get-state" }).then((response) => {
        if (response?.enabled) setEnabled(true);
      }).catch(() => {});
    });
  } else {
    sendMessage({ type: "zen:get-state" }).then((response) => {
      if (response?.enabled) setEnabled(true);
    }).catch(() => {});
  }
})();
