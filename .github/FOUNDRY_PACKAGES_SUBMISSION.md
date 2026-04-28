# Submitting to the Foundry VTT Packages list

Once a module is on GitHub with a working `manifest` URL, you can submit it
to https://foundryvtt.com/packages so it appears in Foundry's in-app browser.

## Prerequisites

- A working release with a public manifest URL:
  `https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest/download/module.json`
- A Foundry account at https://foundryvtt.com/
- The manifest URL responds with a valid JSON `module.json` (curl test passes).

## Steps

1. Sign in at https://foundryvtt.com/
2. Go to https://foundryvtt.com/admin/packages/package/add/
   (visible only when signed in; redirects you to the packages section if not.)
3. Choose **Module** as the package type.
4. Fill in:
   - **Name**: must match `id` in `module.json` exactly → `pf2e-dsn-persistent-bridge`
   - **Title**: `PF2e × DSN Persistent Dice Bridge`
   - **Manifest URL**: `https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest/download/module.json`
   - **Description**: short user-facing blurb (Markdown supported)
   - **System** relationship: link to `pf2e`
   - **Required modules**: link to `dice-so-nice` and `lib-wrapper`
5. Submit. Foundry's package admin queues the entry; usually goes live within
   24h after a moderator re-validates the manifest.
6. After approval, the package URL is `https://foundryvtt.com/packages/pf2e-dsn-persistent-bridge`
   (which the issue templates already link to).

## Re-running validation after each release

Once registered, Foundry refetches the manifest periodically. To force a
re-check after pushing a new tag:

1. Sign in.
2. Go to your package admin page.
3. Click **Refresh manifest** / **Validate** (UI may vary).

If the manifest URL stops resolving (e.g. you renamed the repo), the package
will be marked stale; fix the URL and re-validate.

## Updates

Releases are picked up automatically as long as `manifest` URL keeps pointing
to the latest `module.json` and that `module.json`'s `download` URL points to
that release's `module.zip`. Both are handled by the CI in
`.github/workflows/release.yml`.
