# Notes for Claude

## Before every merge to main

Bump the editor's update number in `editor.html`:

```js
const VERSION='v26', VERSION_DATE='YYYY-MM-DD', UPDATE=N;   // near the top of the script
```

Add 1 to `UPDATE` (and set `VERSION_DATE` to today) in the same branch, before merging.
The editor footer shows "Editor v26 · update N", so this tells the user which copy is live.
Do it on every merge, even when the change is not in `editor.html`.

## The editing panel is shared

The editor's sidebar and the Social post maker are the same panel. Its CSS lives in the
`<!-- panel-css:start -->` … `<!-- panel-css:end -->` block, which must be identical in
`editor.html` and `social.html`. Edit it in `editor.html`, then run:

```
python3 tools/sync-panel.py          # copy it into social.html
python3 tools/sync-panel.py --check  # just compare
```

Page-specific styles (the editor's canvas and export bar, the post maker's picture grid,
preview and hashtag chips) stay outside the block, in each page's own `<style>`.
