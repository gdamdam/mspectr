// Vitest global setup. jest-dom matchers are registered for the UI tests that
// opt into the jsdom environment via the `// @vitest-environment jsdom` pragma.
// Importing the matcher registration is harmless in the node environment.
import '@testing-library/jest-dom/vitest'
