// Noop stub of the `server-only` package for vitest.
// Production uses the real package which throws if imported into a client bundle.
// In tests (Node) the throw is a false positive — we just want the import to succeed.
export {};
