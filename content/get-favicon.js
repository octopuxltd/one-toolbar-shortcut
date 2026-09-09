(async () => {
  const link = document.querySelector('link[rel~="icon"]');
  const candidates = [];
  if (link && link.href) candidates.push(link.href);
  candidates.push(new URL("/favicon.ico", location.origin).href);

  let dataUrl = null;
  let lastError = null;

  for (const faviconUrl of candidates) {
    try {
      const response = await fetch(faviconUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${faviconUrl}`);

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error(`Response from ${faviconUrl} wasn't an image (${blob.type || "unknown type"})`);
      }

      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Couldn't read favicon blob"));
        reader.readAsDataURL(blob);
      });
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!dataUrl) {
    console.error("One Toolbar Shortcut: couldn't fetch a favicon for this page", lastError);
    browser.runtime.sendMessage({ type: "favicon-data-url", dataUrl: null });
    return;
  }

  browser.runtime.sendMessage({ type: "favicon-data-url", dataUrl });
})();
