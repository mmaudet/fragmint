---
description: Full Fragmint validation suite — types, lint, tests, build
---

# Validate: Full Project Validation

Run all validation checks in sequence and report results.

## 1. Type Checking

**Server**:
```bash
pnpm --filter @fragmint/server typecheck
```
**Expected**: No errors

**Web**:
```bash
pnpm --filter @fragmint/web typecheck
```
**Expected**: No errors

---

## 2. Linting

```bash
pnpm lint
```
**Expected**: 0 errors (warnings OK)

---

## 3. Unit Tests

```bash
pnpm test
```
**Expected**: All tests pass

---

## 4. Build

```bash
pnpm build
```
**Expected**: All packages build successfully

---

## 5. Local Server Smoke Test

Start server:
```bash
pnpm --filter @fragmint/server dev &
sleep 3
```

Test health:
```bash
curl -s http://localhost:3333/v1/health | jq .
```
**Expected**: `{ "status": "ok" }` (or similar)

Test fragments listing:
```bash
curl -s http://localhost:3333/v1/fragments | jq .
```

Stop server:
```bash
lsof -ti:3333 | xargs kill 2>/dev/null || true
```

---

## 6. End-to-End Tests (Optional — requires Ollama)

```bash
pnpm e2e
```
**Expected**: All Playwright tests pass

---

## 7. Summary Report

```
## Validation Report

### Type Checking
- Server: ✅/❌
- Web: ✅/❌

### Lint
- All packages: ✅/❌ [N warnings]

### Unit Tests
- Result: ✅/❌ [N passed, M failed]

### Build
- Result: ✅/❌

### Local Server
- Health endpoint: ✅/❌
- Fragments endpoint: ✅/❌

### E2E (if run)
- Result: ✅/❌ [N passed]

### Errors/Warnings
- [List any issues]

### Overall: PASS ✅ / FAIL ❌
```

**If any validation fails**, provide:
1. The exact error message
2. The file/line causing the issue
3. Suggested fix
