const originalWindowStates = new Map();
const zenWindows = new Set();
const iconCache = new Map();

function getIconImageData(enabled) {
  const key = enabled ? "green" : "gray";
  if (iconCache.has(key)) return iconCache.get(key);

  const canvas = new OffscreenCanvas(48, 48);
  const context = canvas.getContext("2d");
  context.fillStyle = enabled ? "#d9f07a" : "#727873";
  context.beginPath();
  context.roundRect(1, 1, 46, 46, 14);
  context.fill();
  context.strokeStyle = enabled ? "#18201b" : "#eef0e9";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(15, 15);
  context.lineTo(33, 15);
  context.lineTo(15, 33);
  context.lineTo(33, 33);
  context.stroke();
  const imageData = context.getImageData(0, 0, 48, 48);
  iconCache.set(key, imageData);
  return imageData;
}

function zenWindowKey(windowId) {
  return `zen-window-${windowId}`;
}

async function rememberZenWindow(windowId, enabled) {
  if (enabled) {
    zenWindows.add(windowId);
    await chrome.storage.local.set({ [zenWindowKey(windowId)]: true });
  } else {
    zenWindows.delete(windowId);
    await chrome.storage.local.remove(zenWindowKey(windowId));
  }
}

async function isZenWindow(windowId) {
  if (zenWindows.has(windowId)) return true;
  const stored = await chrome.storage.local.get(zenWindowKey(windowId));
  const enabled = stored[zenWindowKey(windowId)] === true;
  if (enabled) zenWindows.add(windowId);
  return enabled;
}

async function setWindowIcon(windowId, enabled) {
  const tabs = await chrome.tabs.query({ windowId });
  const imageData = getIconImageData(enabled);
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => (
    chrome.action.setIcon({ tabId: tab.id, imageData })
  )));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function ensureContentScript(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "zen:ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  }
}

async function setTabEnabled(tab, enabled) {
  if (!tab?.id || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;
  try {
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(tab.id, { type: "zen:set-enabled", enabled });
  } catch (error) {
    console.warn(`ZenMode could not start on tab ${tab.id}.`, error);
  }
}

async function notifyTabsChanged(windowId) {
  if (!windowId) return;
  const enabled = await isZenWindow(windowId);
  if (!enabled) return;
  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    chrome.tabs.sendMessage(t.id, { type: "zen:tabs-updated" }).catch(() => {});
  }
}

async function sendToggle(tab) {
  await ensureContentScript(tab);
  return chrome.tabs.sendMessage(tab.id, { type: "zen:toggle" });
}

async function toggleZenMode(sourceTab) {
  const tab = sourceTab || await getActiveTab();
  if (!tab?.id || !tab.windowId) return;

  try {
    const response = await sendToggle(tab);
    const enabled = response?.enabled ?? false;

    if (enabled) {
      await rememberZenWindow(tab.windowId, true);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      await setWindowIcon(tab.windowId, true);
      await Promise.allSettled(tabs.map((openTab) => setTabEnabled(openTab, true)));
      const window = await chrome.windows.get(tab.windowId);
      if (!originalWindowStates.has(tab.windowId)) {
        originalWindowStates.set(tab.windowId, window.state);
      }
      await chrome.windows.update(tab.windowId, { state: "fullscreen" });
    } else {
      await rememberZenWindow(tab.windowId, false);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      await setWindowIcon(tab.windowId, false);
      await Promise.allSettled(tabs.map((openTab) => setTabEnabled(openTab, false)));
      const state = originalWindowStates.get(tab.windowId) || "normal";
      originalWindowStates.delete(tab.windowId);
      await chrome.windows.update(tab.windowId, { state });
    }
  } catch (error) {
    console.warn("ZenMode is unavailable on this page.", error);
  }
}

chrome.action.onClicked.addListener(toggleZenMode);
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-zen-mode") toggleZenMode();
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  isZenWindow(windowId).then((enabled) => {
    chrome.action.setIcon({ tabId, imageData: getIconImageData(enabled) });
    if (enabled) chrome.tabs.get(tabId).then((tab) => setTabEnabled(tab, true)).catch(() => {});
  }).catch(() => {});
  notifyTabsChanged(windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    isZenWindow(tab.windowId).then((enabled) => {
      chrome.action.setIcon({ tabId, imageData: getIconImageData(enabled) });
      if (enabled) setTabEnabled(tab, true);
    }).catch(() => {});
  }
  if (changeInfo.title || changeInfo.favIconUrl || changeInfo.status === "complete") {
    notifyTabsChanged(tab.windowId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  notifyTabsChanged(tab.windowId);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  notifyTabsChanged(removeInfo.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || message.tabId;

  if (message.type === "zen:get-tabs") {
    if (!tabId) {
      sendResponse({ tabs: [] });
      return true;
    }
    chrome.tabs.get(tabId).then((tab) => chrome.tabs.query({ windowId: tab.windowId })).then((tabs) => {
      sendResponse({
        tabs: tabs.map(({ id, title, active, index, favIconUrl, url }) => ({
          id,
          title,
          active,
          index,
          favIconUrl,
          url
        }))
      });
    }).catch(() => sendResponse({ tabs: [] }));
    return true;
  }

  if (message.type === "zen:get-state") {
    if (!tabId) {
      sendResponse({ enabled: false });
      return true;
    }
    chrome.tabs.get(tabId).then((tab) => isZenWindow(tab.windowId)).then((enabled) => {
      sendResponse({ enabled });
    }).catch(() => sendResponse({ enabled: false }));
    return true;
  }

  if (message.type === "zen:select-tab") {
    chrome.tabs.update(message.tabId, { active: true }).then((selectedTab) => {
      if (selectedTab?.windowId) {
        return chrome.windows.update(selectedTab.windowId, { focused: true });
      }
    }).then(() => {
      sendResponse({ selected: true });
    }).catch((error) => {
      console.warn("ZenMode could not switch tabs.", error);
      sendResponse({ selected: false });
    });
    return true;
  }

  if (message.type === "zen:toggle") {
    if (tabId) {
      chrome.tabs.get(tabId).then((tab) => toggleZenMode(tab));
    } else {
      toggleZenMode();
    }
  }

  if (message.type === "zen:navigate") {
    if (tabId) {
      chrome.tabs.update(tabId, { url: message.url });
    }
  }

  if (message.type === "zen:tab") {
    if (tabId) {
      chrome.tabs.get(tabId).then((tab) => chrome.tabs.create({ windowId: tab.windowId }));
    } else {
      chrome.tabs.create({});
    }
  }

  if (message.type === "zen:close-tab") {
    const targetId = message.targetTabId || message.tabId || sender.tab?.id;
    if (targetId) {
      chrome.tabs.remove(targetId).catch((err) => {
        console.warn("Could not close tab:", err);
      });
    }
    return;
  }

  if (message.type === "zen:check-bookmark") {
    if (!message.url) {
      sendResponse({ bookmarked: false });
      return true;
    }
    chrome.bookmarks.search({ url: message.url }).then((results) => {
      sendResponse({ bookmarked: results && results.length > 0 });
    }).catch(() => sendResponse({ bookmarked: false }));
    return true;
  }

  if (message.type === "zen:toggle-bookmark") {
    if (!tabId) {
      sendResponse({ bookmarked: false });
      return true;
    }
    chrome.tabs.get(tabId).then(async (tab) => {
      if (!tab?.url) return { bookmarked: false };
      const existing = await chrome.bookmarks.search({ url: tab.url });
      if (existing && existing.length > 0) {
        for (const item of existing) {
          await chrome.bookmarks.remove(item.id);
        }
        return { bookmarked: false };
      } else {
        await chrome.bookmarks.create({ title: tab.title || "ZenMode bookmark", url: tab.url });
        return { bookmarked: true };
      }
    }).then((res) => sendResponse(res)).catch(() => sendResponse({ bookmarked: false }));
    return true;
  }
});
