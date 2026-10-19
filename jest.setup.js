// Runs in every test file before the tests. Mocks that every screen test would otherwise repeat.

// Safe-area insets need a native view; the library ships this mock for tests (all insets 0).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
