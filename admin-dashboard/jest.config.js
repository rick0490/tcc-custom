module.exports = {
	testEnvironment: 'node',
	setupFilesAfterEnv: ['./__tests__/setup.js'],
	testMatch: ['**/__tests__/**/*.test.js'],
	testPathIgnorePatterns: ['/node_modules/'],
	collectCoverageFrom: [
		'server.js',
		'analytics-db.js',
		'system-monitor.js'
	],
	coverageThreshold: {
		global: {
			lines: 10  // Start low, increase as more tests are added
		}
	},
	// Don't run tests in parallel to avoid port conflicts
	maxWorkers: 1,
	// Increase timeout for API tests
	testTimeout: 10000,
	// Verbose output
	verbose: true
};
