# Build candidates (test fixture)

Not real data. Four rows for the build test: one document that builds, one whose server answers HTTP 403, one bill whose
page has a digest but no legislative history, and one release with no paragraph that could be its summary.

## California (US-CA)

| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |
|---|---|---|---|---|---|---|---|---|---|
| yes | ca-sb-900-2025 | Example frontier model transparency (SB 900) | bill | ai-governance | enacted (signed 2025-09-29) | yes | https://example.test/bills/sb-900 | seen | Builds: a landmark with a digest, a history and a full page of text |
| yes | ca-ab-100-2024 | Example deepfake disclosure (AB 100) | bill | online-safety | enacted (2024) | yes | https://example.test/bills/ab-100 | seen | Excluded: a digest but no legislative history, so no official status |

## Singapore (SG)

| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |
|---|---|---|---|---|---|---|---|---|---|
| yes | sg-pdpc-advisory-2024 | Advisory Guidelines on use of personal data in AI systems | guidance | privacy-data | published (2024-03-01) | no | https://example.test/pdpc/advisory | seen | Excluded: the server answers HTTP 403 |
| yes | sg-mddi-brief-2024 | Example ministry brief | press-release | digital-infrastructure | published (2024-05-01) | no | https://example.test/mddi/brief | seen | Excluded: the page has no paragraph of 25 words, so no official summary |
