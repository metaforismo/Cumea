# Third-party notices

## Electron

The packaged desktop application embeds Electron 43.4.0 as its application
runtime and framework:

- Release: <https://github.com/electron/electron/releases/tag/v43.4.0>
- Copyright (c) Electron contributors and 2013–2020 GitHub Inc.
- License: MIT; see `licenses/electron-MIT.txt`

The release SBOM inventories this framework explicitly because Electron is a
build-time npm dependency whose runtime is embedded by electron-builder rather
than returned by the production-only dependency walk.

## Mote Studio

The bot avatar shapes, palette, eye contrast calculation, and interaction model
are adapted from [Mote Studio](https://github.com/metaforismo/mote-studio) at
commit `aa240400fa504fc2b1b7454323a4d48a90b94c13`.

Copyright (c) 2026 metaforismo. Licensed under the MIT License. The complete
license text is included at `licenses/mote-studio-MIT.txt`.

The Cumea implementation uses native React SVG and CSS animations rather than
Mote Studio's Motion dependency. State semantics, persistence, upload handling,
and reduced-motion behavior are Cumea adaptations.

## qrcode.react

The trusted desktop pairing panel uses `qrcode.react` 4.2.0:

- Source: <https://github.com/zpao/qrcode.react>
- Copyright (c) 2015 Paul O’Shannessy
- License: ISC; see `licenses/qrcode-react-ISC.txt`

The installed distribution also embeds Project Nayuki's QR Code Generator under
the MIT License; see `licenses/qrcode-generator-MIT.txt`.

## @believer/react-native-markdown-display

The mobile companion uses `@believer/react-native-markdown-display` 8.4.1:

- Source: <https://github.com/believer/react-native-markdown-display>
- Copyright (c) 2018–2019 Mient-jan Stelling and Tom Pickard
- License: MIT; see `licenses/react-native-markdown-display-MIT.txt`

## markdown-it

`@believer/react-native-markdown-display` depends on `markdown-it` 14.2.0:

- Source: <https://github.com/markdown-it/markdown-it>
- Copyright (c) 2014 Vitaly Puzrin and Alex Kocharin
- License: MIT; see `licenses/markdown-it-MIT.txt`

## expo-speech-recognition

The mobile companion uses `expo-speech-recognition` 56.0.1 for native iOS and
Android dictation:

- Source: <https://github.com/jamsch/expo-speech-recognition>
- Copyright (c) 2024 jamsch
- License: MIT; see `licenses/expo-speech-recognition-MIT.txt`

## JSZip

The host-side, read-only DOCX preview parser uses JSZip 3.10.1 to inspect and
decompress bounded Open Packaging Convention parts. Cumea does not execute
document content or render DOCX-provided HTML.

- Source: <https://github.com/Stuk/jszip>
- Copyright (c) 2009–2016 Stuart Knightley, David Duponchel, Franz Buchinger,
  António Afonso
- License choice used by Cumea: MIT; see `licenses/jszip-MIT.txt`

## PDF.js

The desktop/web document viewer uses the official `pdfjs-dist` 6.2.108 build
to parse a bounded, same-origin PDF byte snapshot in a local web worker and to
render one page at a time. Cumea supplies its own controls and accessible text
reading path; it does not embed the upstream generic viewer.

- Source: <https://github.com/mozilla/pdf.js>
- Copyright 2012 Mozilla Foundation
- License: Apache License 2.0; see `licenses/pdfjs-Apache-2.0.txt`

## Cua Driver executable, SDK, and UniFFI JavaScript runtime

The optional local-computer bridge bundles the official arm64 executable and
`@trycua/cua-driver` 0.19.3 from the `cua-driver-rs-v0.19.3` release at
<https://github.com/trycua/cua>. The tagged Cargo workspace declares MIT and
the tag's `LICENSE.md` carries Copyright (c) 2025 Cua AI, Inc.; the exact text
is included at `licenses/cua-driver-MIT.txt`. Packaging downloads the pinned
release asset, verifies its published SHA-256, and extracts only the executable.

The driver uses `@ubjs/core` and `@ubjs/node` 0.31.0-3, licensed under the
Mozilla Public License 2.0. The native compatibility runtime notice and source
location are preserved at `licenses/cua-driver-node-runtime-NOTICE.md`. The
release SBOM records the locked production graph and package-declared licenses,
including platform-optional packages that may be absent from a specific binary.

## Reference-only interface research

The public `margelo/ai-chat-demo` repository was used only to study interaction
examples. It had no explicit software license when reviewed, so Cumea contains
no code, assets, or copied implementation from it.
