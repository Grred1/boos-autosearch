# Repository guidance

This is the browse-only fork of mrcxsy/boss-auto-apply. Read docs/原始需求.md and README.md before editing. The historical upstream README is archived and is not the current specification.

Never restore automatic recruiter contact, sending messages/resumes, private BOSS API calls, MAIN-world event patches, anti-detection hooks, or captcha bypass. User manually starts each bounded round and manually sends every greeting.

Runtime: plain JavaScript MV3 extension, no build step. `src/core.js` contains pure filter functions; `src/dom.js` reads public page DOM; `content.js` owns user controls and browsing; `background.js` manages owned detail tabs, cancellation and fixed external AI endpoints; `options.*` implements settings and records.

Use textContent for all page/model/user data. Model access requires opt-in consent and optional domain permission. Do not forward browser credentials. Preserve Apache-2.0 attribution and upstream commit record.

Validation: npm test; npm run check; npm run test:browser (after npm ci, using a separate local Chrome context and offline fixtures only). Do not test on the user's live account without a clear instruction to do so.
