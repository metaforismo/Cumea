---
name: "Cumea Landing"
description: "A restrained proof dossier for self-hosted AI teammates."
colors:
  page: "#fbfbfb"
  surface: "#ffffff"
  ink: "#111111"
  muted: "#737373"
  line: "rgba(17, 17, 17, 0.08)"
  line-strong: "rgba(17, 17, 17, 0.14)"
  cumea-orange: "#f06418"
  cumea-orange-hover: "#dd5410"
  cumea-orange-soft: "#fff0e6"
  evidence-paper: "#f4f1eb"
  dossier-dark: "#090a0b"
  dossier-panel: "#111315"
  dossier-text: "#f7f7f4"
  warm-muted: "#696761"
  status-green: "#38b779"
  status-warm: "#d79a6f"
  mote-lagoon: "#16a79d"
  mote-tangerine: "#f56a16"
  mote-sky: "#2f8de3"
  mote-berry: "#d72879"
typography:
  hero-display:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.038em"
  dossier-display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "clamp(2.6rem, 5.7vw, 5.25rem)"
    fontWeight: 720
    lineHeight: 0.94
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  dossier-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.98rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  control:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.011em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.7rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "normal"
  mono:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  compact: "0.45rem"
  medium: "0.8rem"
  dossier: "1rem"
  product-window: "1.15rem"
  pill: "999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "clamp(5.5rem, 9vw, 8.5rem)"
components:
  button-primary:
    backgroundColor: "{colors.cumea-orange}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 1.05rem"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.cumea-orange-hover}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 1.05rem"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 1.05rem"
    height: "36px"
  hero-eyebrow:
    backgroundColor: "{colors.cumea-orange-soft}"
    textColor: "#a94413"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.14rem 0.58rem 0.14rem 0.18rem"
    height: "24px"
  product-search:
    backgroundColor: "rgba(255, 255, 255, 0.045)"
    textColor: "rgba(255, 255, 255, 0.72)"
    rounded: "{rounded.compact}"
    padding: "0.36rem 0.5rem"
  evidence-tab:
    backgroundColor: "transparent"
    textColor: "{colors.warm-muted}"
    typography: "{typography.label}"
    rounded: "0"
    padding: "0.9rem 0.15rem"
    height: "5.25rem"
  evidence-frame:
    backgroundColor: "{colors.dossier-dark}"
    textColor: "{colors.surface}"
    rounded: "{rounded.dossier}"
    padding: "0"
  role-panel:
    backgroundColor: "{colors.dossier-panel}"
    textColor: "{colors.dossier-text}"
    rounded: "{rounded.dossier}"
    padding: "0"
---

<!-- Direction contract: index.html first body comment; proof dossier seed e207a4b4. -->

# Design System: Cumea Landing

## Overview

**Creative North Star: "The Proof Dossier"**

Cumea earns trust as an inspectable chain of evidence: a persistent thread, a held decision, the user-owned host boundary, and finally the source. The preserved hero is the incumbent authority for the first viewport: compact, centered, pale, and dominated by the interactive desktop or mobile product preview. Below it, the proof dossier expands into a wider editorial rhythm of warm paper, near-black product surfaces, hairline rules, real screenshots, and direct product language.

The visual system is restrained and technically honest. Cumea orange marks action, selection, or state rather than decorating whole sections. Role-based Mote identities supply the only vivid multicolor vocabulary. Depth is reserved for product evidence; most explanatory structure is flat, ruled, and spacious. The system explicitly rejects a generic feature-card parade and conversion theater.

**Key Characteristics:**

- A preserved compact hero followed by a wider, evidence-led dossier.
- Warm paper and near-black surfaces alternate to separate proof chapters.
- Real product screenshots, capability tables, and boundary diagrams replace abstract feature tiles.
- Cumea orange is a scarce state signal; Motes carry role identity.
- Keyboard-complete tabs, visible focus, reduced-motion fallbacks, and overflow-safe mobile layouts are part of the visual contract.

## Colors

The palette pairs quiet neutral paper with near-black product evidence, using orange sparingly for action and state and Mote colors for role identity.

### Primary

- **Cumea Signal Orange** (`cumea-orange`, #f06418): primary calls to action, selected evidence markers, and the mobile send control.
- **Pressed Orange** (`cumea-orange-hover`, #dd5410): pointer-hover treatment for the primary action.
- **Orange Wash** (`cumea-orange-soft`, #fff0e6): the incumbent hero eyebrow background; it carries provenance without competing with the preview.

### Secondary

- **Lagoon Mote** (`mote-lagoon`, #16a79d): Chief of Staff identity.
- **Tangerine Mote** (`mote-tangerine`, #f56a16): Sales Outbound identity and the default customizable Mote.
- **Sky Mote** (`mote-sky`, #2f8de3): Inbox Manager identity.
- **Berry Mote** (`mote-berry`, #d72879): Research Analyst identity.

### Neutral

- **Quiet Page** (`page`, #fbfbfb): incumbent hero, proof strip, host boundary, runtime, and FAQ canvas.
- **White Surface** (`surface`, #ffffff): buttons, compact controls, and light component surfaces.
- **Evidence Paper** (`evidence-paper`, #f4f1eb): the screenshot evidence chapter.
- **Dossier Black** (`dossier-dark`, #090a0b): the role chapter and evidence frame.
- **Dossier Panel** (`dossier-panel`, #111315): the role scene inset.
- **Near-Black Ink** (`ink`, #111111): primary text and strong selected states.
- **Operational Gray** (`muted`, #737373): supporting copy in the incumbent hero and light sections.
- **Warm Operational Gray** (`warm-muted`, #696761): dossier chapter introductions.
- **Hairline** (`line`, rgba(17, 17, 17, 0.08)): ordinary divisions and control outlines.
- **Strong Hairline** (`line-strong`, rgba(17, 17, 17, 0.14)): chapter rails and structural boundaries.
- **Soft Dossier White** (`dossier-text`, #f7f7f4): primary text on the dark role chapter.

### Named Rules

**The Signal, Not Paint Rule.** Cumea orange identifies an action, active evidence, or meaningful state; it does not become a full-section background.

**The Mote Identity Rule.** Multicolor belongs to Mote identities and their semantic activity states. Explanatory surfaces stay neutral.

## Typography

**Display Font:** the incumbent hero uses Inter with system fallbacks; dossier displays use the Apple system stack with SF Pro Text and Segoe UI fallbacks.

**Body Font:** Inter with system fallbacks in the hero and product preview; the Apple system stack in the dossier.

**Label/Mono Font:** system sans for controls and metadata; SFMono-Regular with Consolas and Liberation Mono fallbacks for the clone command.

**Character:** The hero is compact and product-like; the dossier becomes editorial through scale, tight tracking, and low line height without introducing a display typeface. Body copy remains plain, compact, and legible.

### Hierarchy

- **Hero Display** (700, 42px, 1): one centered, single-line statement on wide screens; it becomes fluid and wraps below 54rem.
- **Dossier Display** (720, `clamp(2.6rem, 5.7vw, 5.25rem)`, 0.94): proof-chapter headlines with tight negative tracking.
- **Role Title** (default weight, `clamp(1.7rem, 3.5vw, 2.8rem)`, 1): the changing job statement inside the dark role panel.
- **Body** (400, 1rem, 1.5): global prose and control inheritance.
- **Dossier Body** (400, 0.98rem, 1.65): chapter introductions, constrained to 34rem.
- **Label** (usually 700, 0.61–0.84rem): evidence tabs, statuses, matrix headers, and proof metadata. Uppercase is limited to small operational status copy.
- **Mono** (400, 0.6875rem): the clone command and no other editorial content.

### Named Rules

**The System-Type Rule.** Scale, weight, spacing, and contrast create hierarchy; do not introduce a decorative display face into this shipped world.

## Layout

The first viewport preserves the incumbent 50rem shell and centered composition. Its product preview is the dominant object, with the primary and GitHub actions centered above it. The dossier widens to a 70rem shell, leaving 1.5rem gutters on standard screens and 1rem gutters below 35rem.

Proof chapters use asymmetric two-column headings: roughly 1.12fr for the headline and 0.88fr for the supporting explanation. Evidence and role chapters then pair a narrow index with a wide visual stage. At 54rem, these become stacked layouts and the indexes become horizontally scrollable tab rails. At 35rem, proof facts stack, the role stage becomes one column, screenshot framing changes from 16:9.6 to 4:3, and the capability table remains horizontally scrollable. A 21rem breakpoint protects the incumbent hero command and navigation at 320px.

Vertical chapter rhythm is generous (`clamp(5.5rem, 9vw, 8.5rem)` for the principal dossier sections), while component internals stay compact. Hairlines organize proof facts, tabs, the host boundary, the runtime matrix, and FAQ rows instead of card grids.

### Named Rules

**The Two-Shell Rule.** Keep the approved hero inside its 50rem authority; use the 70rem dossier shell only below it.

**The Evidence-First Rule.** A section earns width for screenshots, a capability table, or an architecture boundary—not for a field of generic cards.

## Elevation & Depth

The system is flat by default. Hairlines, alternating paper tones, and near-black chapters provide most hierarchy. Product evidence is the exception: the desktop preview and evidence frame use a single large ambient shadow, while the role panel uses a subtle border and tonal inset rather than elevation. Buttons remain shadowless.

### Shadow Vocabulary

- **Product Preview** (`0 28px 70px rgba(17, 17, 17, 0.14)`): the established desktop application window in the hero.
- **Evidence Frame** (`0 28px 70px rgba(35, 30, 22, 0.16)`): the real-screenshot stage on warm paper.

### Named Rules

**The Proof-Lifts Rule.** Elevation belongs to inspectable product proof. Explanatory facts and controls stay ruled or tonal.

## Shapes

The outer language is softly technical: controls use full pills, product and dossier stages use 1rem-class corners, and compact product controls use sub-0.5rem radii. The desktop preview keeps its incumbent 1.15rem top corners and square open bottom edge. Evidence frames and role panels use 1rem corners, reduced to 0.8rem for the evidence frame on small screens. Boundary nodes use 0.8rem icon tiles, while status dots and Mote eyes carry compact organic geometry.

Hairlines are the dominant edge treatment. Rounded containers should clip real screenshots or coherent product scenes, not wrap isolated marketing claims.

## Components

### Buttons

Pill-shaped, compact, and direct.

- **Shape:** full pill (`999px`), with a 36px default height and 28px compact navigation variant.
- **Primary:** Cumea Signal Orange with white text and 1.05rem horizontal padding.
- **Secondary:** white surface, near-black text, and a quiet hairline border.
- **Hover / Focus:** primary shifts to Pressed Orange on fine pointers; secondary strengthens its hairline. Every focusable control uses a 3px translucent orange outline with a 3px offset. Active state scales to 0.97 unless reduced motion is requested.
- **Source Variant:** a 2.9rem white pill with dark blue-black text on the closing near-black panel.

### Chips

- **Hero Eyebrow:** Orange Wash pill with a nested white MIT badge; small, sentence-case context surrounds the compact uppercase badge.
- **Status Pills:** translucent on dark product surfaces; text color conveys working or needs-you state without flooding the control.

### Cards / Containers

- **Product Preview:** near-black application window, incumbent 50rem width, 1.15rem top corners, one ambient shadow, and no bottom border.
- **Evidence Frame:** near-black screenshot stage with 1rem corners, 16:9.6 media, a ruled figcaption, and the evidence shadow.
- **Role Panel:** tonal inset (`dossier-panel`) with a 1px translucent white border, a copy column, and a real screenshot column.
- **Source Panel:** near-black closing container with 1rem corners and a white source action.

### Inputs / Fields

- **Clone Command:** a white pill with a quiet border, muted prompt glyph, mono repository command, click-to-copy behavior, and a live status toast.
- **Product Preview Inputs:** compact near-black fields within the established app preview. At small widths, interactive controls preserve 44px targets.
- **Focus:** the global orange focus outline remains visible; fields do not remove keyboard focus without a replacement.

### Navigation

The incumbent header is a 30px-high three-column row inside the 50rem shell: brand at left, muted page links centered, and GitHub plus release action at right. Below 54rem, page links disappear; below 35rem, the GitHub pill also disappears while the release action remains. Footer navigation returns to a simple ruled row.

### Evidence Switcher

The three-item tablist is a ruled vertical index on wide screens and a horizontal scroll rail below 54rem. Selection turns the label to Near-Black Ink and adds one orange dot. Pointer activation uses a restrained 180ms crossfade between preloaded real screenshots. Keyboard activation and reduced motion switch immediately. Arrow keys, Home, and End move the roving tab stop.

### Role Switcher

The four-item tablist repeats the product's Mote identities, plain-language role names, scope labels, and statuses. Selection increases contrast and adds a faint tonal wash. The corresponding role stage updates copy, evidence, and alternative text; pointer activation briefly dims the image for 150ms, while keyboard and reduced-motion paths do not animate.

### Host Boundary

Three icon-and-copy nodes—mobile, Cumea host, providers and tools—are joined by directional hairlines. The map becomes a vertical flow below 54rem. The host node alone uses the Cumea icon on black; the neighboring nodes stay on warm neutral tiles.

## Do's and Don'ts

### Do:

- **Do** preserve the compact 50rem hero and its interactive product preview as the first-viewport authority.
- **Do** use the 70rem proof-dossier shell, alternating paper and near-black chapters, and hairline structure below the hero.
- **Do** reserve Cumea orange for actions, selection, and meaningful state.
- **Do** use real product screenshots, Mote identities, accurate capability tables, and explicit host boundaries as proof.
- **Do** preserve roving-tab keyboard behavior, visible orange focus, reduced-motion fallbacks, and 320px overflow safety.

### Don't:

- **Don't** replace the established hero while extending the dossier below it.
- **Don't** turn the dossier into a generic grid of feature cards, decorative gradients, glass surfaces, or conversion theater.
- **Don't** fabricate screenshots, benchmarks, customer proof, managed-cloud behavior, or signed-download affordances.
- **Don't** use orange as broad background paint or introduce unrelated accent colors outside Mote identity and semantic state.
- **Don't** animate evidence changes for keyboard activation or when reduced motion is requested.
