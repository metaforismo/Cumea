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

## Source-first calls to action

The current page deliberately links to the source repository and latest published prerelease;
it does not advertise an unsigned app as a download. The repository base URL can be changed without
editing the page:

```sh
VITE_CUMEA_GITHUB_URL=https://github.com/example/Cumea pnpm --dir apps/landing build
```

`VITE_CUMEA_GITHUB_URL` must be an HTTPS URL. An invalid or missing value falls back to the canonical
Cumea repository. Links to the release notes, README sections, security policy, and license are all
derived from the same base URL.

## Vercel

Create a Vercel project with `apps/landing` as its Root Directory. The checked-in `vercel.json`
selects Vite, runs `pnpm build`, publishes `dist`, and applies baseline security headers.

Before a production deployment:

1. keep the source-first copy honest until a signed and notarized release actually exists;
2. add the final production domain to the repository metadata and social preview workflow;
3. verify the deployment at 320 px, 768 px, and desktop widths;
4. test keyboard navigation, reduced motion, increased contrast, and the final external links.

Deploying the Vercel project is an external publishing action and is deliberately separate from the
local build.
