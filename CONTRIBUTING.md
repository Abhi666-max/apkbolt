# Contributing to ApkBolt

Thank you for your interest in contributing to ApkBolt! The primary architectural principle of ApkBolt is **zero shell dependencies and deterministic runtime execution**. Please review the guidelines below before opening issues or submitting pull requests.

---

## Development Environment

- **Operating System**: Windows 10 / 11 64-bit
- **Node.js**: v20 or higher
- **Package Manager**: npm or pnpm

### Getting Started

```powershell
# Clone the repository
git clone https://github.com/abhi666-max/apkbolt.git
cd apkbolt

# Install dependencies
npm install

# Start in development mode
npm start
```

---

## Pre-Commit Verification

Always ensure the entire automated test suite passes before submitting code:

```powershell
# Run the complete test suite (pure Node unit tests and runtime pipeline verifications)
npm test
```

When modifying UI components, verify that the window layout renders properly without regressions:

```powershell
# Run smoke screen verification
npx electron . --smoke test\shot.png
```

---

## Code & Architecture Guidelines

1. **Zero External Shell Dependencies**: Handlers in `src/core/` (ZIP, AXML, ARSC, PNG, and ICO parsers) are written without external binary dependencies. When adding new features, prefer Node.js standard built-ins rather than adding third-party packages.
2. **Vanilla Native UI**: The frontend is built with high-performance vanilla HTML5, CSS3, and modern JavaScript without framework bloat.
3. **Unified ADB Interface**: All communication with the Android guest subsystem must go through `src/core/adb.js`. Never invoke arbitrary adb commands directly from disparate modules.
4. **Context Isolation**: Main and renderer processes communicate strictly through the whitelisted IPC channels exposed via `preload.js` with `contextIsolation: true`.
5. **Code Style**: Use clear, concise English for all identifiers, comments, and user-facing strings.

---

## Testing Guidelines

- When real APK fixtures are unavailable, offline APK parsing tests will mock binary buffers. To test against an authentic APK, specify the test fixture environment variable:

```powershell
$env:APKSTART_TEST_APK = "C:\path\to\sample.apk"
npm test
```

- Tests must not make external internet requests. Use local mock HTTP servers for network tests (see `test/engine-test.js`).

---

## Commit Guidelines

Follow the Conventional Commits specification:

```
feat(engine): add custom qcow2 disk import support
fix(axml): correct string pool base offset calculation
docs: update hypervisor configuration manual
```
