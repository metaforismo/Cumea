# Icon Composer validation

- Document: `production/Cumea-A3R1.icon`
- Source: corrected PNG `concepts/cumea-a3r1-corrected-safe-area.png`, embedded by Icon Composer in `Assets/`
- Platform preview: iOS/macOS
- Appearance previews inspected: Default, Dark, Mono
- Master-layer Liquid Glass effects: off, after observing that specular and shadow changed the approved artwork
- Icon Composer light-angle control remains at -45 degrees, but does not relight the protected PNG while its effects are disabled
- Correction: removed the internal diagonal artifact from the violet underside, leaving one continuous fold
- Safe area: complete three-agent composition reduced by approximately 14 percent with additional padding on all sides
- Pixel identity: corrected workspace PNG and PNG embedded by Icon Composer share SHA-256 `fba0d5a207e96f646dd5477330b21ba893062f8abf4283d36026744564b49dee`
- Approved rounded macOS export: `../../Cumea-A3R1-Liquid-Glass-iOS-Default-1024x1024@1x.png`; this is
  the flattened fallback used for Electron/ICNS and preserves transparent outer corners
- Mobile fallback: the opaque Icon Composer master is used unmasked and the operating system applies
  the current iOS/Android mask

Not tested: physical device or App Store upload. Package and Simulator evidence is recorded separately
in the release handoff because it is tied to a specific build, not to this static design review.
