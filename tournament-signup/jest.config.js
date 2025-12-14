module.exports = {
    testEnvironment: 'node',
    transform: {},
    moduleFileExtensions: ['js', 'mjs'],
    testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    collectCoverageFrom: [
        'server.js',
        'public/js/**/*.js',
        '!**/node_modules/**'
    ],
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 50,
            lines: 50,
            statements: 50
        }
    },
    verbose: true,
    // Transform ES modules
    transformIgnorePatterns: [
        '/node_modules/(?!(chokidar)/)'
    ],
    // Mock chokidar to avoid ES module issues in tests
    moduleNameMapper: {
        '^chokidar$': '<rootDir>/__mocks__/chokidar.js'
    }
};
