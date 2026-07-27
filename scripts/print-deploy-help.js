#!/usr/bin/env node
/* eslint-disable no-undef */

console.log(`Explicit deployment commands:

  npm run deploy:contract -- --contract CommunityToken --config path/to/config.json [--network <network>]
  npm run deploy:village -- --config path/to/config.json [--network <network>]
  npm run deploy:tdf -- --config path/to/config.json [--network <network>]

Verification:

  npm run verify:village -- --manifest deployments/villages/<chainId>/<slug>.json

Ownership handoff and upgrades:

  npm run owner:submit -- --manifest <manifest.json> --network <network> [--upgrade <contract>:<version>]
  npm run owner:status -- --manifest <manifest.json> --network <network> [--upgrade <contract>:<version>]

Bare deploy is intentionally non-transactional. Pick an explicit deployment/profile command.
`);
