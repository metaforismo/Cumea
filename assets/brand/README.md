# Cumea brand asset

`iconacumea.png` is generated from the user-approved rounded macOS export
`Cumea-A3R1-Liquid-Glass-iOS-Default-1024x1024@1x.png`. It preserves the rendered plate and its
transparent outer corners for the Dock, repository, landing, and web surfaces.

The editable Apple source is `Cumea-A3R1-Liquid-Glass.icon`. Mobile assets are generated from its
opaque, unmasked master image so iOS and Android—not Cumea—apply the final platform mask.

On macOS, regenerate the checked web, Electron, ICNS, iOS, and Android files with:

```sh
node scripts/generate-brand-assets.mjs
```

The script uses the system `sips` utility for aspect-preserving resizing and electron-builder's
pinned icon converter for ICNS. The Android adaptive foreground is
proportionally scaled onto the same opaque dark background so system masks do not cut off the three
characters.
