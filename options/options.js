const OPEN_NEW_TAB_KEY = "openInNewTab";

const openNewTabCheckbox = document.getElementById("open-new-tab");

browser.storage.local.get(OPEN_NEW_TAB_KEY).then((stored) => {
  openNewTabCheckbox.checked = !!stored[OPEN_NEW_TAB_KEY];
});

openNewTabCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ [OPEN_NEW_TAB_KEY]: openNewTabCheckbox.checked });
});
