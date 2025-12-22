module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/test/**/*.test.ts',
    '**/src/**/__tests__/**/*.test.ts'
  ],
  displayName: {
    name: 'AGI-CORE',
    color: 'blue',
  },
  verbose: true,
  testPathIgnorePatterns: [
    '/node_modules/',
    'test/customCommands.test.ts',
    'test/health-check.test.ts',
    'test/mcpConfig.test.ts',
    'test/providerFactory.test.ts',
    'test/safetyValidator.test.ts',
    'test/skillRepository.test.ts',
    'test/taskCompletionDetector.test.ts',
    'test/toolSuites.test.ts',
    'test/webTools.test.ts',
    'test/robustInputProcessor.test.ts',
    'test/isolated-verification.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coveragePathIgnorePatterns: [
    'src/core/agentOrchestrator.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/src', '<rootDir>/test'],
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
    '^chalk$': '<rootDir>/__mocks__/chalk.js',
    '^gradient-string$': '<rootDir>/__mocks__/gradient-string.js',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!chalk|gradient-string|ora|boxen)',
    '/dist/'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/jest-setup.cjs'],
};
