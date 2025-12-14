/**
 * Mock chokidar module for testing
 * Provides a no-op watcher that doesn't actually watch files
 */

const mockWatcher = {
    on: function(event, callback) {
        return this;
    },
    close: function() {
        return Promise.resolve();
    },
    add: function(paths) {
        return this;
    },
    unwatch: function(paths) {
        return this;
    }
};

module.exports = {
    watch: function(paths, options) {
        return mockWatcher;
    }
};
