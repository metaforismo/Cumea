# Cumea brand asset

`iconacumea.png` is the user-provided, canonical square artwork. It is intentionally stored as an
opaque RGB PNG: generated outputs must not invent transparency or crop the composition.

On macOS, regenerate the checked web, Electron, ICNS, iOS, and Android files with:

```sh
node scripts/generate-brand-assets.mjs
```

The script uses the system `sips` utility for aspect-preserving resizing and electron-builder's pinned
icon converter for ICNS. The Android adaptive foreground is proportionally scaled onto the same
opaque dark background so system masks do not cut off the three characters.
