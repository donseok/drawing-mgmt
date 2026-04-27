// Test setup — runs once before each test file.
//
// Registers @testing-library/jest-dom custom matchers (`toBeInTheDocument`,
// `toHaveTextContent`, etc.) on Vitest's `expect`. Component tests added later
// can rely on them without per-file imports.
import '@testing-library/jest-dom/vitest';
