/**
 * A generated HTML artifact is rendered as an inert document in an opaque
 * iframe. Keep this policy independent from the application document CSP:
 * allowing app scripts, same-origin access, forms, or remote subresources here
 * would turn model-authored markup into an application privilege boundary.
 */
export const HTML_ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
  "frame-ancestors 'self'",
  "sandbox",
].join("; ");

export const HTML_ARTIFACT_PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");
