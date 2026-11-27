# Exo marketplace assets

This directory holds the two documents that make plugin discovery work for the
deployed shell:

- `marketplace.json` is the authoritative feed. It lists the plugins this
  deployment publishes and points each one at its `exo-manifest.json` URL.
- `sources.json` is the deploy-time source list. It is copied to
  `marketplace-sources.json` next to the shell and tells this deployment which
  feeds to read.

The feed is discovery only. Installing a plugin writes its manifest URL to the
workspace's `exo.json`; the normal plugin host then validates the manifest and
asks for consent. Feed metadata never grants a capability.

## Editing the feed

Add one object to `plugins`:

```json
{
  "name": "My Editor",
  "manifest": "https://plugins.example.com/my-editor/exo-manifest.json",
  "description": "What the plugin does.",
  "version": "1.0.0",
  "publisher": { "name": "Example" },
  "keywords": ["example"],
  "category": "Editors"
}
```

Only `name` and `manifest` are required. The manifest URL must be absolute,
`https` (or `http://localhost` for development), with no credentials or
fragment. Display fields are optional and are not authoritative; the manifest
wins after it loads.

The format and limits are defined in
[`docs/contracts/marketplace.md`](../docs/contracts/marketplace.md) and
[`schema/marketplace.schema.json`](../schema/marketplace.schema.json).

## Deploying a fork

Change the feed URL in `sources.json` to the URL where the fork publishes its
feed, then run:

```bash
npm run deploy:copy-marketplace
npm run check:marketplace
```

An operator can replace either file at deploy time:

```bash
EXO_MARKETPLACE_SOURCES=/path/to/sources.json \
EXO_MARKETPLACE_FEED=/path/to/marketplace.json \
npm run deploy:copy-marketplace
```

The built shell fetches `marketplace-sources.json` from its own origin. It never
offers a runtime control to add or remove a feed.
