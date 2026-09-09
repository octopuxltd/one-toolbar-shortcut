# One Toolbar Shortcut

A Firefox extension that adds a single toolbar button which takes you straight to one
site you choose — no bookmarks menu, no digging through a toolbar folder.

- Left-click the icon to go to your chosen site (in place of the current tab, or in a
  new tab, depending on the "Open site in a new tab" preference).
- Right-click the icon to set the current page as the destination, or to open
  preferences.
- The destination's favicon becomes the toolbar icon once you grant it access (a
  one-time permission prompt for that specific site).

## Loading it locally

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on…" and select `manifest.json`.

## `docs/`

A static test page used to check whether a page hosted on GitHub Pages can be
embedded in the extension's own options page via an iframe.
