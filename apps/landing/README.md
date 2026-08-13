# Cumea landing

Static Vite landing for Cumea. It is intentionally isolated from the desktop and mobile clients and
has no runtime service dependency.

## Local development

From the repository root, after the workspace dependencies are installed:

```sh
pnpm --dir apps/landing dev
pnpm --dir apps/landing typecheck
pnpm --dir apps/landing build
```

The production output is written to `apps/landing/dist`.

## Honest download state

The macOS CTA defaults to `#download`, is marked `aria-disabled`, and says that the signed release is
coming soon. It must not point at an unsigned build. Configure it only after a real release exists:

```sh
VITE_CUMEA_MAC_DOWNLOAD_URL=https://github.com/metaforismo/Cumea/releases/download/v0.1.0/Cumea.dmg pnpm --dir apps/landing build
```

The repository URL can also be changed without editing the page:

```sh
VITE_CUMEA_GITHUB_URL=https://github.com/example/Cumea pnpm --dir apps/landing build
```

Both configuration values must be HTTPS URLs. Invalid or missing download URLs fail closed to the
coming-soon state.

## Vercel

Create a Vercel project with `apps/landing` as its Root Directory. The checked-in `vercel.json`
selects Vite, runs `pnpm build`, publishes `dist`, and applies baseline security headers.

Before a production deployment:

1. set `VITE_CUMEA_MAC_DOWNLOAD_URL` only if a signed and notarized release is actually available;
2. add the final production domain to the repository metadata and social preview workflow;
3. verify the deployment at 320 px, 768 px, and desktop widths;
4. test keyboard navigation, reduced motion, increased contrast, and the final external links.

Deploying the Vercel project is an external publishing action and is deliberately separate from the
local build.
