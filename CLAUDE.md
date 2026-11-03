# Notes for Claude

## Before every merge to main

Bump the editor's update number in `editor.html`:

```js
const VERSION='v26', VERSION_DATE='2026-11-03', UPDATE=9;
```

Add 1 to `UPDATE` (and set `VERSION_DATE` to today) in the same branch, before merging.
The editor footer shows "Editor v26 · update N", so this tells the user which copy is live.
Do it on every merge, even when the change is not in `editor.html`.
