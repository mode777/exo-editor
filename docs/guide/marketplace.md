# Marketplace listing

The marketplace is discovery. A deployed shell reads a fixed list of feeds,
shows the plugins those feeds list, and installs one by writing its manifest URL
to the active workspace's `exo.json`. The shell still fetches and validates the
manifest and asks for consent; a feed cannot skip either step.

The normative format, limits and error codes are in
[`docs/contracts/marketplace.md`](../contracts/marketplace.md). This page is the
author-facing walkthrough; if they disagree, the contract wins.

## 1. Publish a manifest

Your plugin needs an HTTPS `exo-manifest.json` with a stable `id`, `name`,
`version`, `publisher`, `engines.exo` and `runtime.entry`. See
[manifest.md](./manifest.md) and [hosting.md](./hosting.md). The manifest URL is
the value users install.

## 2. Add a feed entry

A marketplace feed is one JSON document:

```json
{
  "schemaVersion": 1,
  "id": "my-team",
  "name": "My Team Plugins",
  "description": "Editors maintained by my team.",
  "owner": { "name": "My Team", "url": "https://example.com" },
  "plugins": [
    {
      "name": "My Editor",
      "manifest": "https://plugins.example.com/my-editor/exo-manifest.json",
      "description": "Edits our domain files.",
      "version": "1.0.0",
      "publisher": { "name": "My Team" },
      "homepage": "https://example.com/my-editor",
      "license": "MIT",
      "keywords": ["editor", "example"],
      "category": "Editors"
    }
  ]
}
```

Only `name` and `manifest` are required on an entry. Display fields are optional
and non-authoritative: after the manifest loads, installed rows, consent and
details use the manifest's name, id, version, publisher and permissions. Feed
metadata never enters `exo.json` and never changes the consent fingerprint.

Unknown fields, relative or insecure manifest URLs, duplicate manifests and
over-limit documents are rejected. A feed is validated all-or-nothing.

## 3. Deploy the feed and the source list

A deployed shell reads `marketplace-sources.json` from its own origin:

```json
{
  "schemaVersion": 1,
  "feeds": ["https://example.com/marketplace.json"]
}
```

The source list is fixed for that deployment. The shell offers no UI to add or
remove a feed. A fork or private instance replaces the file at deploy time; the
shell application does not change.

In this repository:

```bash
npm run deploy:copy-marketplace
npm run check:marketplace
```

copies the committed [`marketplace/marketplace.json`](../../marketplace/marketplace.json)
and [`marketplace/sources.json`](../../marketplace/sources.json) into
the shell build output. An operator can override either input:

```bash
EXO_MARKETPLACE_SOURCES=/path/sources.json \
EXO_MARKETPLACE_FEED=/path/marketplace.json \
npm run deploy:copy-marketplace
```

The deployed shell reads the catalog lazily when Extensions first opens. It does
not fetch marketplace documents at startup.

## 4. Check locally

`npm run dev` serves the committed feed and source list at:

- `http://localhost:5173/exo-editor/marketplace.json`
- `http://localhost:5173/exo-editor/marketplace-sources.json`

The dev middleware is not part of the production build. In the shell, open
**Extensions** and confirm your entry appears under Marketplace with its feed
name. Install it and confirm `exo.json` receives one entry and the consent
dialog names your manifest origin.

For a feed on another origin, serve it with CORS headers that allow the shell
origin, and use an HTTPS URL (or `http://localhost` in development). The feed is
fetched with credentials and referrer omitted.

## 5. Listing in the official feed

The official feed is
[`marketplace/marketplace.json`](../../marketplace/marketplace.json), deployed at
`https://mode777.github.io/exo-editor/marketplace.json`. It lists the plugins
this project publishes. Add a listing in a pull request; the repository test
checks that the shipped entries match the deployed plugin manifests, and CI
validates the built marketplace assets before deployment.

The marketplace has no ratings, download counts, update channel, signature
authority or automatic updates. A feed may point at a newer manifest, but the
shell only reads it when the installed entry loads, and consent is re-requested
when the capability fingerprint changes.
