const STORAGE_KEY = "destinationUrl";
const FAVICON_KEY = "faviconDataUrl";
const FAVICON_FOR_KEY = "faviconForUrl";
const OPEN_NEW_TAB_KEY = "openInNewTab";

let cachedDestinationUrl = null;
let cachedFaviconForUrl = null;
let cachedOpenInNewTab = false;

async function loadCache() {
  const stored = await browser.storage.local.get([STORAGE_KEY, FAVICON_FOR_KEY, OPEN_NEW_TAB_KEY]);
  cachedDestinationUrl = stored[STORAGE_KEY] || null;
  cachedFaviconForUrl = stored[FAVICON_FOR_KEY] || null;
  cachedOpenInNewTab = !!stored[OPEN_NEW_TAB_KEY];
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (STORAGE_KEY in changes) cachedDestinationUrl = changes[STORAGE_KEY].newValue || null;
  if (FAVICON_FOR_KEY in changes) cachedFaviconForUrl = changes[FAVICON_FOR_KEY].newValue || null;
  if (OPEN_NEW_TAB_KEY in changes) cachedOpenInNewTab = !!changes[OPEN_NEW_TAB_KEY].newValue;
});

async function getDestinationUrl() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY];
}

async function setIconFromDataUrl(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Fetched favicon data couldn't be decoded as an image"));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 32;
  canvas.height = img.naturalHeight || 32;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  browser.browserAction.setIcon({ imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) });
}

async function restoreSavedIcon() {
  const stored = await browser.storage.local.get(FAVICON_KEY);
  if (stored[FAVICON_KEY]) {
    setIconFromDataUrl(stored[FAVICON_KEY]).catch((err) =>
      console.error("One Toolbar Shortcut: couldn't restore saved icon", err)
    );
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type !== "favicon-data-url" || !message.dataUrl) return;

  try {
    await setIconFromDataUrl(message.dataUrl);
    const destinationUrl = await getDestinationUrl();
    await browser.storage.local.set({ [FAVICON_KEY]: message.dataUrl, [FAVICON_FOR_KEY]: destinationUrl });
  } catch (err) {
    console.error("One Toolbar Shortcut: couldn't apply fetched favicon", err);
  }
});

// Opens the destination either in place of the clicked-from tab, or in a new tab,
// depending on the "Open site in a new tab" checkbox — and resolves with the target
// tab's id plus a promise for when it finishes loading. Pinned tabs and about:debugging
// always get a new tab instead, regardless of that setting: replacing a pinned tab's
// site is surprising, and about:debugging is what you're using to test this very
// extension, so navigating it away would lose your debugging session.
function openDestination(tab, url) {
  const forcedNewTab = tab.pinned || (tab.url && tab.url.startsWith("about:debugging"));

  if (cachedOpenInNewTab || forcedNewTab) {
    // A brand-new tab starts out "loading", so there's no risk of it reaching
    // 'complete' before we can attach a listener for it once it exists.
    return browser.tabs.create({ url }).then((newTab) => ({
      id: newTab.id,
      loadComplete: waitForTabComplete(newTab.id)
    }));
  }

  // Attach the listener BEFORE navigating: an existing tab can be fast enough (e.g.
  // a cached page) to reach 'complete' before tabs.update()'s own promise resolves,
  // which would make a listener attached afterward miss that event entirely.
  const loadComplete = waitForTabComplete(tab.id);
  return browser.tabs.update(tab.id, { url }).then(() => ({ id: tab.id, loadComplete }));
}

// No `await` runs before permissions.request() here — awaiting anything first would
// lose the click's "user action" status and make permissions.request() throw.
browser.browserAction.onClicked.addListener((tab) => {
  const destinationUrl = cachedDestinationUrl;

  if (!destinationUrl) {
    browser.runtime.openOptionsPage();
    return;
  }

  if (cachedFaviconForUrl === destinationUrl) {
    openDestination(tab, destinationUrl);
    return;
  }

  // If the tab we were clicked from is already on the destination's domain, activeTab
  // already covers it directly — no permission prompt needed at all. This only applies
  // to *this* tab specifically: activeTab doesn't extend to some other tab elsewhere
  // that happens to be open on the same domain.
  const destinationOrigin = new URL(destinationUrl).origin;
  const sameOriginAsClickedTab = tab.url && new URL(tab.url).origin === destinationOrigin;

  if (sameOriginAsClickedTab) {
    browser.tabs.executeScript(tab.id, { file: "content/get-favicon.js" }).catch((err) =>
      console.error("One Toolbar Shortcut: favicon capture failed", err)
    );
    openDestination(tab, destinationUrl);
    return;
  }

  const originPattern = `${destinationOrigin}/*`;
  browser.permissions
    .request({ origins: [originPattern] })
    .catch((err) => {
      console.error("One Toolbar Shortcut: permission request failed", err);
      return false;
    })
    .then((granted) => {
      if (!granted) {
        openDestination(tab, destinationUrl);
        return;
      }

      openDestination(tab, destinationUrl).then(({ id, loadComplete }) => {
        loadComplete
          .then(() => browser.tabs.executeScript(id, { file: "content/get-favicon.js" }))
          .catch((err) => console.error("One Toolbar Shortcut: favicon capture failed", err));
      });
    });
});

browser.menus.create({
  id: "set-current-page",
  title: "Set current page as destination",
  contexts: ["browser_action"]
});

browser.menus.create({
  id: "set-destination-url",
  title: "One Toolbar Shortcut Preferences",
  contexts: ["browser_action"]
});

function canBeDestination(url) {
  return !!url && /^https?:\/\//i.test(url);
}

// The menu is shown from the toolbar button, not "in" a tab, so onShown's own `tab`
// param is omitted here — the active tab has to be looked up separately. That lookup
// is async, so a fast reopen of the menu could let an earlier check's result land
// after a newer one; lastMenuInstanceId guards against updating for a stale check.
let lastMenuInstanceId = 0;

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.menuIds.includes("set-current-page")) return;

  const instanceId = ++lastMenuInstanceId;
  const activeTab = tab || (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (instanceId !== lastMenuInstanceId) return;

  browser.menus.update("set-current-page", { enabled: canBeDestination(activeTab && activeTab.url) });
  browser.menus.refresh();
});

function flashSavedBadge() {
  browser.browserAction.setBadgeText({ text: "✓" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#2e7d32" });
  setTimeout(() => browser.browserAction.setBadgeText({ text: "" }), 1500);
}

browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "set-destination-url") {
    browser.runtime.openOptionsPage();
    return;
  }

  if (info.menuItemId === "set-current-page") {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.url) return;

    await browser.storage.local.set({ [STORAGE_KEY]: activeTab.url });
    flashSavedBadge();
    browser.tabs.executeScript(activeTab.id, { file: "content/get-favicon.js" }).catch((err) =>
      console.error("One Toolbar Shortcut: couldn't inject favicon script", err)
    );
  }
});

loadCache();
restoreSavedIcon();
