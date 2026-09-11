# Remedy imagery

Drop photographs here to replace the drawn fallbacks in the Kundli guidance panel.

| File | Used by | Suggested subject |
| --- | --- | --- |
| `temple.jpg` | Temple / Puja card | A temple exterior or sanctum, landscape orientation |

## Requirements

- **Filename must match exactly**, lowercase, `.jpg`.
- Landscape, at least **1200×750**. The card crops to roughly 16:10 centred at 42% height,
  so keep the subject slightly above centre.
- Keep each file under ~400KB. These load on every Kundli visit.

## If a file is absent

Nothing breaks. `RemedyPhoto` falls back to a drawn SVG temple that matches the card's
sizing and animation. This is deliberate: the previous implementation hotlinked a
Wikimedia URL, and when it stopped resolving the card rendered raw alt text over an empty
box. Nothing here contacts a third-party host at runtime.

## Licensing

Whatever you install is **your** licensing decision — own photography, a stock licence, or
Creative Commons. If you use CC material that requires attribution, put the credit in
`temple-photo-credit` in `KundliScene.tsx`, which currently reads
`Illustrative temple reference`.

Do not commit images you do not have the right to redistribute.

## Optional: fetch from a manifest

`frontend/scripts/setup-remedy-images.mjs` will download whatever you list in
`remedy-images.json` (next to the script) into this folder:

```bash
cd frontend && npm run setup:remedy-images
```

The manifest ships empty — populate it with URLs you have cleared for use. The script never
fails the build; a missing image simply keeps the drawn fallback.
