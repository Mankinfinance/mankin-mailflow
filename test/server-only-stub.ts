// Stub for the "server-only" import. Real server-only blocks client-bundled
// imports; in vitest we don't care — we just want the import side-effect to
// be a no-op so pure helpers can be unit tested.
export {};
