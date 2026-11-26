# GSD fork open items

- gsd-tools verify test-content: impl_files_covered is [] for all 39 files of 409.2 although handle-webhook.test.ts imports ./handle-webhook.ts; importsExactFile (gsd-tools.js:7669) should match; cause unverified; probe: call computeImplTestCoverage on that one file (source: igaming 409.2-RULING-8.md, owner: GSD fork pilot session).
