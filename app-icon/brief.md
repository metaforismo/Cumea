# Cumea app icon

Product promise: a council of AI agents, presented through one clear interface.

Approved direction: **A3R1 — Single Fold Council**.

Target route: Apple Icon Composer for iOS, iPadOS, macOS, and App Store representation. The current Electron desktop build still consumes an exported `icns`; the existing icon remains untouched until Composer output is reviewed.

Production rule: preserve the approved PNG without a vector redraw. The PNG is embedded as the master image layer with per-layer Liquid Glass effects disabled, because those effects materially alter its approved colors and shading. Icon Composer still applies the required platform mask.
