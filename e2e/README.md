# Fragmint E2E Tests

## collections-e2e.sh

End-to-end test for the collections workflow. Validates multi-tenant fragment isolation, access control, and cross-collection composition.

### Prerequisites

- Fragmint server running in dev mode (`pnpm dev` or equivalent)
- Default admin user `mmaudet` / `fragmint-dev`
- `curl` and `python3` available in PATH

### Usage

```bash
# Against default local server (http://localhost:3737)
./e2e/collections-e2e.sh

# Against a custom URL
./e2e/collections-e2e.sh http://localhost:4000
```

### Test Scenario

| # | Test | Description |
|---|------|-------------|
| 1 | Admin login | Authenticate as mmaudet |
| 2 | Create user | Create jdupont (contributor role) |
| 3 | Common collection | Verify the system 'common' collection exists |
| 4 | Create team collection | Create 'projet-anfsi' team collection |
| 5 | Access denied | jdupont cannot access projet-anfsi (no membership) |
| 6 | Add member | Add jdupont as contributor to projet-anfsi |
| 7 | Access granted | jdupont can now access projet-anfsi |
| 8 | Create fragment | jdupont creates a fragment in projet-anfsi |
| 9 | Fragment visible | Fragment appears in projet-anfsi listing |
| 10 | Fragment isolated | Fragment does NOT appear in common listing |
| 11 | Backward compat | GET /v1/fragments still works (no collection filter) |
| 12 | Isolation count | projet-anfsi has exactly 1 fragment |
| 13 | Common fragment | Admin creates a fragment in common |
| 14 | Cross-collection | Fragments from both collections accessible by ID; each stays in its own collection listing |
| 15 | Revoke access | Remove jdupont from projet-anfsi; access denied |
| 16 | Common preserved | jdupont retains access to common collection |

### Exit Code

- `0` — all tests passed
- `1` — one or more tests failed
