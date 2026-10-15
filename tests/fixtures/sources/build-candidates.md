# Build candidates (test fixture)

Not real data. Three rows for the build test: one document that builds, one whose server answers HTTP 403, and one whose
summary the checker will not support.

## California (US-CA)

| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |
|---|---|---|---|---|---|---|---|---|---|
| yes | ca-sb-900-2025 | Example frontier model transparency (SB 900) | bill | ai-governance | enacted (signed 2025-09-29) | yes | https://example.test/bills/sb-900 | seen | Builds: a landmark with a full page of text |
| yes | ca-ab-100-2024 | Example deepfake disclosure (AB 100) | bill | online-safety | enacted (2024) | yes | https://example.test/bills/ab-100 | seen | Excluded: the checker finds its summary unsupported |

## Singapore (SG)

| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |
|---|---|---|---|---|---|---|---|---|---|
| yes | sg-pdpc-advisory-2024 | Advisory Guidelines on use of personal data in AI systems | guidance | privacy-data | published (2024-03-01) | no | https://example.test/pdpc/advisory | seen | Excluded: the server answers HTTP 403 |
