import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./accessibility.css", import.meta.url), "utf8");

describe("app-wide accessibility interaction baseline", () => {
  it("styles selection and keyboard focus across native and custom controls", () => {
    expect(css).toContain("::selection");
    expect(css).toContain(":focus-visible");
    expect(css).toContain('[role="button"]');
    expect(css).toContain('[role="menuitem"]');
    expect(css).toContain('[role="tab"]');
    expect(css).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it("removes decorative motion and smooth scrolling when reduced motion is requested", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
    expect(css).toContain(".animate-panel-in");
    expect(css).toContain(".animate-pop-in");
  });

  it("does not hide semantic working state", () => {
    expect(css).not.toContain(".mote-avatar--working { display: none");
    expect(css).not.toContain("[aria-busy=\"true\"] { display: none");
  });
});
