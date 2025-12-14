/**
 * Flyer Display Controller
 *
 * Main controller for the flyer display.
 * Manages WebSocket connection, flyer loading, and display state.
 */

class FlyerDisplay {
    constructor(config) {
        this.userId = config.userId;
        this.adminUrl = config.adminUrl;
        this.adminWsUrl = config.adminWsUrl;
        this.debugMode = config.debugMode || false;

        // State
        this.currentFlyer = null;
        this.usingFallback = false;
        this.wsClient = null;

        // DOM elements
        this.loadingContainer = document.getElementById('loading-container');
        this.errorContainer = document.getElementById('error-container');
        this.flyerContainer = document.getElementById('flyer-container');
        this.connectionStatus = document.getElementById('connection-status');

        // Initialize
        this.init();
    }

    /**
     * Initialize the display
     */
    init() {
        this.log('init', { userId: this.userId, adminUrl: this.adminUrl });

        // Show debug status indicator in debug mode
        if (this.debugMode && this.connectionStatus) {
            this.connectionStatus.style.display = 'flex';
        }

        // Initialize WebSocket client
        this.wsClient = new WebSocketClient(this.adminWsUrl, this.userId);
        this.wsClient.setDebugMode(this.debugMode);

        // Setup event handlers
        this.setupEventHandlers();

        // Connect to WebSocket
        this.wsClient.connect();
    }

    /**
     * Log message if debug mode is enabled
     */
    log(action, data = {}) {
        if (this.debugMode) {
            console.log(`%c[FlyerDisplay] ${action}`, 'color: #10b981', data);
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        // Connection events
        this.wsClient.on('connect', () => {
            this.log('connected');
            this.updateConnectionStatus(true);
            this.showLoading(false);
            this.showError(false);

            // If no flyer yet, show the container (will be empty or show "no flyer")
            if (!this.currentFlyer) {
                this.showFlyer(true);
                this.showNoFlyerMessage();
            }
        });

        this.wsClient.on('disconnect', (reason) => {
            this.log('disconnected', { reason });
            this.updateConnectionStatus(false);
        });

        this.wsClient.on('reconnecting', (attempt) => {
            this.log('reconnecting', { attempt });
            if (attempt > 3) {
                this.showError(true);
            }
        });

        this.wsClient.on('error', (error) => {
            this.log('error', { error: error.message });
            this.showError(true);
        });

        // Flyer events
        this.wsClient.on('flyer:activated', (data) => {
            this.log('flyer:activated', data);
            this.handleFlyerUpdate(data);
        });

        this.wsClient.on('flyers:update', (data) => {
            this.log('flyers:update', data);
            // Handle general flyer updates (upload, delete)
            if (data.action === 'flyer:activated') {
                this.handleFlyerUpdate(data);
            }
        });

        // Emergency mode events
        this.wsClient.on('emergency:activated', (data) => {
            this.log('emergency:activated', data);
            this.showTechnicalDifficulties(data);
        });

        this.wsClient.on('emergency:deactivated', (data) => {
            this.log('emergency:deactivated', data);
            this.hideTechnicalDifficulties();
        });

        this.wsClient.on('emergency:status', (data) => {
            this.log('emergency:status', data);
            if (data.active) {
                this.showTechnicalDifficulties(data);
            } else {
                this.hideTechnicalDifficulties();
            }
        });
    }

    /**
     * Show Technical Difficulties overlay (emergency mode)
     */
    showTechnicalDifficulties(data = {}) {
        const overlay = document.getElementById('emergency-overlay');
        const timestamp = document.getElementById('emergency-timestamp');

        if (overlay) {
            overlay.classList.add('active');

            // Update timestamp
            if (timestamp) {
                const time = data.activatedAt ? new Date(data.activatedAt) : new Date();
                timestamp.textContent = `Emergency mode activated at ${time.toLocaleTimeString()}`;
            }

            this.log('showTechnicalDifficulties', { activatedAt: data.activatedAt });
        }
    }

    /**
     * Hide Technical Difficulties overlay (all clear)
     */
    hideTechnicalDifficulties() {
        const overlay = document.getElementById('emergency-overlay');

        if (overlay) {
            overlay.classList.remove('active');
            this.log('hideTechnicalDifficulties');
        }
    }

    /**
     * Handle flyer update event
     */
    handleFlyerUpdate(data) {
        const { flyer, userId } = data;

        // Check if this update is for our user
        if (userId && String(userId) !== String(this.userId)) {
            this.log('ignoringFlyerUpdate', { reason: 'different userId', expected: this.userId, received: userId });
            return;
        }

        if (!flyer) {
            this.log('noFlyerInUpdate');
            return;
        }

        // Check if flyer actually changed
        if (flyer === this.currentFlyer) {
            this.log('flyerUnchanged', { flyer });
            return;
        }

        this.log('updatingFlyer', { from: this.currentFlyer, to: flyer });
        this.currentFlyer = flyer;
        this.usingFallback = false;
        this.displayFlyer(flyer);
    }

    /**
     * Display a flyer (image or video)
     */
    displayFlyer(filename) {
        this.log('displayFlyer', { filename });

        // Construct the flyer URL
        // Flyers are served from admin dashboard at /api/flyers/preview/:userId/:filename
        const cacheBuster = Date.now();
        const flyerUrl = `${this.adminUrl}/api/flyers/preview/${this.userId}/${encodeURIComponent(filename)}?v=${cacheBuster}`;

        // Clear current content with fade out
        const currentContent = this.flyerContainer.firstChild;
        if (currentContent) {
            currentContent.classList.add('fade-out');
            setTimeout(() => {
                this.flyerContainer.innerHTML = '';
                this.createFlyerElement(filename, flyerUrl);
            }, 500);
        } else {
            this.createFlyerElement(filename, flyerUrl);
        }

        // Show the flyer container
        this.showFlyer(true);
    }

    /**
     * Create the appropriate element for the flyer
     */
    createFlyerElement(filename, flyerUrl) {
        const isVideo = this.isVideoFile(filename);

        if (isVideo) {
            this.createVideoElement(flyerUrl);
        } else {
            this.createImageElement(flyerUrl);
        }
    }

    /**
     * Create image element
     */
    createImageElement(flyerUrl) {
        const img = document.createElement('img');
        img.className = 'flyer-image fade-in';
        img.src = flyerUrl;
        img.alt = 'Tournament Flyer';

        img.onload = () => {
            this.log('imageLoaded', { src: flyerUrl });
        };

        img.onerror = () => {
            this.log('imageLoadError', { src: flyerUrl });
            this.handleLoadError();
        };

        this.flyerContainer.appendChild(img);
    }

    /**
     * Create video element
     */
    createVideoElement(flyerUrl) {
        const video = document.createElement('video');
        video.className = 'flyer-video fade-in';
        video.src = flyerUrl;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;

        video.onloadeddata = () => {
            this.log('videoLoaded', { src: flyerUrl });
            video.play().catch(err => {
                this.log('videoPlayError', { error: err.message });
            });
        };

        video.onerror = () => {
            this.log('videoLoadError', { src: flyerUrl });
            this.handleLoadError();
        };

        this.flyerContainer.appendChild(video);
    }

    /**
     * Check if file is a video
     */
    isVideoFile(filename) {
        if (!filename) return false;
        return filename.toLowerCase().endsWith('.mp4');
    }

    /**
     * Handle load error - show "no flyer" message
     */
    handleLoadError() {
        if (this.usingFallback) {
            // Already tried fallback, just show no flyer message
            this.log('fallbackAlsoFailed');
            this.showNoFlyerMessage();
            return;
        }

        this.usingFallback = true;
        this.log('loadErrorShowingNoFlyer');
        this.showNoFlyerMessage();
    }

    /**
     * Show "no flyer" message
     */
    showNoFlyerMessage() {
        this.flyerContainer.innerHTML = '';
        const message = document.createElement('div');
        message.className = 'no-flyer-message';
        message.textContent = 'No Flyer Selected';
        this.flyerContainer.appendChild(message);
    }

    /**
     * Show/hide loading state
     */
    showLoading(show) {
        if (this.loadingContainer) {
            this.loadingContainer.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide error state
     */
    showError(show) {
        if (this.errorContainer) {
            this.errorContainer.style.display = show ? 'flex' : 'none';
        }
        if (show && this.flyerContainer) {
            this.flyerContainer.style.display = 'none';
        }
    }

    /**
     * Show/hide flyer container
     */
    showFlyer(show) {
        if (this.flyerContainer) {
            this.flyerContainer.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Update connection status indicator
     */
    updateConnectionStatus(connected) {
        if (!this.connectionStatus) return;

        if (connected) {
            this.connectionStatus.classList.add('connected');
            this.connectionStatus.querySelector('.status-text').textContent = 'Connected';
        } else {
            this.connectionStatus.classList.remove('connected');
            this.connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
        }
    }

    /**
     * Get current state (for debugging)
     */
    getState() {
        return {
            userId: this.userId,
            currentFlyer: this.currentFlyer,
            usingFallback: this.usingFallback,
            wsConnected: this.wsClient ? this.wsClient.connected : false,
            debugMode: this.debugMode
        };
    }
}

// Export for use
window.FlyerDisplay = FlyerDisplay;
