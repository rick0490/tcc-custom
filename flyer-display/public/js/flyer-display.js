/**
 * Flyer Display Controller
 *
 * Main controller for the flyer display.
 * Manages WebSocket connection, flyer loading, video playback control,
 * playlist mode, and display state.
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
        this.videoElement = null;
        this.statusInterval = null;

        // Media settings (synced from admin dashboard)
        this.mediaSettings = {
            loop: true,
            autoplay: true,
            muted: true,
            volume: 100
        };

        // Playlist state
        this.playlist = {
            enabled: false,
            items: [],
            currentIndex: 0,
            loop: true,
            autoAdvance: true
        };

        // Image rotation timer for playlist
        this.imageRotationTimer = null;

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

        // Fetch initial settings
        this.fetchInitialSettings();
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
     * Fetch initial settings from server
     */
    async fetchInitialSettings() {
        try {
            const response = await fetch(`${this.adminUrl}/api/displays/flyer/settings`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.settings) {
                    this.applySettings(data.settings);
                    this.applyPlaylist({
                        enabled: data.settings.playlistEnabled,
                        items: data.settings.playlistItems || [],
                        currentIndex: data.settings.playlistCurrentIndex || 0,
                        loop: data.settings.playlistLoop,
                        autoAdvance: data.settings.playlistAutoAdvance
                    });
                    this.log('initialSettingsFetched', data.settings);
                }
            }
        } catch (error) {
            this.log('fetchSettingsError', { error: error.message });
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
            this.startStatusReporting();

            // If no flyer yet, show the container (will be empty or show "no flyer")
            if (!this.currentFlyer) {
                this.showFlyer(true);
                this.showNoFlyerMessage();
            }
        });

        this.wsClient.on('disconnect', (reason) => {
            this.log('disconnected', { reason });
            this.updateConnectionStatus(false);
            this.stopStatusReporting();
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
            if (data.action === 'flyer:activated') {
                this.handleFlyerUpdate(data);
            }
        });

        // Media control events
        this.wsClient.on('flyer:control', (data) => {
            this.log('flyer:control', data);
            this.handleControl(data.action);
        });

        this.wsClient.on('flyer:volume', (data) => {
            this.log('flyer:volume', data);
            this.setVolume(data.volume);
        });

        this.wsClient.on('flyer:settings', (data) => {
            this.log('flyer:settings', data);
            this.applySettings(data);
        });

        this.wsClient.on('flyer:playlist', (data) => {
            this.log('flyer:playlist', data);
            this.handlePlaylistUpdate(data);
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

    // ============================================
    // MEDIA CONTROL METHODS
    // ============================================

    /**
     * Handle control command (play/pause/restart/mute/unmute)
     */
    handleControl(action) {
        this.log('handleControl', { action });

        switch (action) {
            case 'play':
                this.play();
                break;
            case 'pause':
                this.pause();
                break;
            case 'restart':
                this.restart();
                break;
            case 'mute':
                this.mute();
                break;
            case 'unmute':
                this.unmute();
                break;
            default:
                this.log('unknownAction', { action });
        }
    }

    /**
     * Play video
     */
    play() {
        if (this.videoElement) {
            this.videoElement.play().catch(err => {
                this.log('playError', { error: err.message });
            });
        }
    }

    /**
     * Pause video
     */
    pause() {
        if (this.videoElement) {
            this.videoElement.pause();
        }
    }

    /**
     * Restart video from beginning
     */
    restart() {
        if (this.videoElement) {
            this.videoElement.currentTime = 0;
            this.videoElement.play().catch(err => {
                this.log('restartError', { error: err.message });
            });
        }
    }

    /**
     * Mute video
     */
    mute() {
        if (this.videoElement) {
            this.videoElement.muted = true;
            this.mediaSettings.muted = true;
        }
    }

    /**
     * Unmute video
     */
    unmute() {
        if (this.videoElement) {
            this.videoElement.muted = false;
            this.mediaSettings.muted = false;
        }
    }

    /**
     * Set volume (0-100)
     */
    setVolume(level) {
        this.mediaSettings.volume = level;
        if (this.videoElement) {
            this.videoElement.volume = level / 100;
        }
        this.log('volumeSet', { level });
    }

    /**
     * Apply media settings
     */
    applySettings(settings) {
        if (settings.loop !== undefined) {
            this.mediaSettings.loop = settings.loop;
        }
        if (settings.autoplay !== undefined) {
            this.mediaSettings.autoplay = settings.autoplay;
        }
        if (settings.defaultMuted !== undefined) {
            this.mediaSettings.muted = settings.defaultMuted;
        }
        if (settings.defaultVolume !== undefined) {
            this.mediaSettings.volume = settings.defaultVolume;
        }

        // Apply to current video if exists
        if (this.videoElement) {
            // Only update loop if not in playlist mode
            if (!this.playlist.enabled) {
                this.videoElement.loop = this.mediaSettings.loop;
            }
            this.videoElement.muted = this.mediaSettings.muted;
            this.videoElement.volume = this.mediaSettings.volume / 100;
        }

        this.log('settingsApplied', this.mediaSettings);
    }

    // ============================================
    // PLAYLIST METHODS
    // ============================================

    /**
     * Handle playlist update from server
     */
    handlePlaylistUpdate(data) {
        const oldEnabled = this.playlist.enabled;
        const oldIndex = this.playlist.currentIndex;

        this.applyPlaylist(data);

        // Handle specific actions
        if (data.action === 'next' || data.action === 'prev' || data.action === 'goto') {
            this.playCurrentPlaylistItem();
        } else if (data.action === 'toggle') {
            if (this.playlist.enabled && !oldEnabled) {
                // Just enabled, start playing
                this.playCurrentPlaylistItem();
            } else if (!this.playlist.enabled && oldEnabled) {
                // Just disabled, stop rotation
                this.clearImageRotationTimer();
            }
        } else if (data.enabled && data.currentIndex !== oldIndex) {
            // Index changed, play new item
            this.playCurrentPlaylistItem();
        }
    }

    /**
     * Apply playlist settings
     */
    applyPlaylist(playlist) {
        if (playlist.enabled !== undefined) {
            this.playlist.enabled = playlist.enabled;
        }
        if (playlist.items !== undefined) {
            this.playlist.items = playlist.items;
        }
        if (playlist.currentIndex !== undefined) {
            this.playlist.currentIndex = playlist.currentIndex;
        }
        if (playlist.loop !== undefined) {
            this.playlist.loop = playlist.loop;
        }
        if (playlist.autoAdvance !== undefined) {
            this.playlist.autoAdvance = playlist.autoAdvance;
        }

        // Update video loop setting based on playlist mode
        if (this.videoElement) {
            this.videoElement.loop = !this.playlist.enabled && this.mediaSettings.loop;
        }

        this.log('playlistApplied', this.playlist);
    }

    /**
     * Play current playlist item
     */
    playCurrentPlaylistItem() {
        if (!this.playlist.enabled || this.playlist.items.length === 0) {
            return;
        }

        const item = this.playlist.items[this.playlist.currentIndex];
        if (!item) {
            this.log('playlistItemNotFound', { index: this.playlist.currentIndex });
            return;
        }

        this.log('playingPlaylistItem', { index: this.playlist.currentIndex, item });
        this.currentFlyer = item.filename;
        this.displayFlyer(item.filename, item.duration);
    }

    /**
     * Advance to next playlist item
     */
    playlistNext() {
        if (!this.playlist.enabled || this.playlist.items.length === 0) {
            return;
        }

        const nextIndex = this.playlist.currentIndex + 1;
        if (nextIndex >= this.playlist.items.length) {
            if (this.playlist.loop) {
                this.playlist.currentIndex = 0;
            } else {
                this.log('playlistEnded');
                return;
            }
        } else {
            this.playlist.currentIndex = nextIndex;
        }

        this.playCurrentPlaylistItem();
        this.reportStatus(); // Report new index
    }

    /**
     * Clear image rotation timer
     */
    clearImageRotationTimer() {
        if (this.imageRotationTimer) {
            clearTimeout(this.imageRotationTimer);
            this.imageRotationTimer = null;
        }
    }

    /**
     * Handle video ended (for playlist auto-advance)
     */
    handleVideoEnded() {
        this.log('videoEnded');

        if (this.playlist.enabled && this.playlist.autoAdvance) {
            this.playlistNext();
        } else if (this.mediaSettings.loop && !this.playlist.enabled) {
            // Should loop, restart
            this.restart();
        }
    }

    // ============================================
    // STATUS REPORTING
    // ============================================

    /**
     * Start status reporting interval
     */
    startStatusReporting() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }

        // Report status every second
        this.statusInterval = setInterval(() => {
            this.reportStatus();
        }, 1000);

        this.log('statusReportingStarted');
    }

    /**
     * Stop status reporting
     */
    stopStatusReporting() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
        this.log('statusReportingStopped');
    }

    /**
     * Report current status to server
     */
    reportStatus() {
        if (!this.wsClient || !this.wsClient.connected) {
            return;
        }

        let state = 'stopped';
        let currentTime = 0;
        let duration = 0;
        let volume = this.mediaSettings.volume;
        let muted = this.mediaSettings.muted;

        if (this.videoElement) {
            state = this.videoElement.paused ? 'paused' : 'playing';
            currentTime = this.videoElement.currentTime || 0;
            duration = this.videoElement.duration || 0;
            volume = Math.round(this.videoElement.volume * 100);
            muted = this.videoElement.muted;
        }

        // Emit status to server
        this.wsClient.emit('flyer:status', {
            userId: this.userId,
            filename: this.currentFlyer,
            state: state,
            currentTime: currentTime,
            duration: isNaN(duration) ? 0 : duration,
            volume: volume,
            muted: muted,
            playlistIndex: this.playlist.currentIndex
        });
    }

    // ============================================
    // FLYER DISPLAY METHODS
    // ============================================

    /**
     * Show Technical Difficulties overlay (emergency mode)
     */
    showTechnicalDifficulties(data = {}) {
        const overlay = document.getElementById('emergency-overlay');
        const timestamp = document.getElementById('emergency-timestamp');

        if (overlay) {
            overlay.classList.add('active');

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

        // If playlist is enabled, don't override from direct flyer:activated
        if (this.playlist.enabled) {
            this.log('playlistActiveIgnoringDirectFlyer', { flyer });
            return;
        }

        this.log('updatingFlyer', { from: this.currentFlyer, to: flyer });
        this.currentFlyer = flyer;
        this.usingFallback = false;
        this.displayFlyer(flyer);
    }

    /**
     * Display a flyer (image or video)
     * @param {string} filename - The flyer filename
     * @param {number} duration - Optional duration for playlist items (images only)
     */
    displayFlyer(filename, duration = null) {
        this.log('displayFlyer', { filename, duration });

        // Clear any existing image rotation timer
        this.clearImageRotationTimer();

        // Construct the flyer URL
        const cacheBuster = Date.now();
        const flyerUrl = `${this.adminUrl}/api/flyers/preview/${this.userId}/${encodeURIComponent(filename)}?v=${cacheBuster}`;

        // Clear current content with fade out
        const currentContent = this.flyerContainer.firstChild;
        if (currentContent) {
            currentContent.classList.add('fade-out');
            setTimeout(() => {
                this.flyerContainer.innerHTML = '';
                this.createFlyerElement(filename, flyerUrl, duration);
            }, 500);
        } else {
            this.createFlyerElement(filename, flyerUrl, duration);
        }

        // Show the flyer container
        this.showFlyer(true);
    }

    /**
     * Create the appropriate element for the flyer
     */
    createFlyerElement(filename, flyerUrl, duration = null) {
        const isVideo = this.isVideoFile(filename);

        if (isVideo) {
            this.createVideoElement(flyerUrl);
        } else {
            this.createImageElement(flyerUrl, duration);
        }
    }

    /**
     * Create image element
     */
    createImageElement(flyerUrl, duration = null) {
        this.videoElement = null; // Clear video reference

        const img = document.createElement('img');
        img.className = 'flyer-image fade-in';
        img.src = flyerUrl;
        img.alt = 'Tournament Flyer';

        img.onload = () => {
            this.log('imageLoaded', { src: flyerUrl });

            // Set up image rotation timer for playlist mode
            if (this.playlist.enabled && this.playlist.autoAdvance && duration) {
                this.imageRotationTimer = setTimeout(() => {
                    this.playlistNext();
                }, duration * 1000);
                this.log('imageRotationTimerSet', { duration });
            }
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
        video.playsInline = true;

        // Apply settings instead of hardcoded values
        video.autoplay = this.mediaSettings.autoplay;
        video.muted = this.mediaSettings.muted;
        video.volume = this.mediaSettings.volume / 100;

        // Loop only if not in playlist mode
        video.loop = !this.playlist.enabled && this.mediaSettings.loop;

        // Store reference for control
        this.videoElement = video;

        video.onloadeddata = () => {
            this.log('videoLoaded', { src: flyerUrl });
            if (this.mediaSettings.autoplay) {
                video.play().catch(err => {
                    this.log('videoPlayError', { error: err.message });
                });
            }
        };

        video.onerror = () => {
            this.log('videoLoadError', { src: flyerUrl });
            this.handleLoadError();
        };

        // Handle video ended for playlist auto-advance
        video.onended = () => {
            this.handleVideoEnded();
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
        this.videoElement = null;
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
            debugMode: this.debugMode,
            mediaSettings: this.mediaSettings,
            playlist: this.playlist,
            videoState: this.videoElement ? {
                paused: this.videoElement.paused,
                currentTime: this.videoElement.currentTime,
                duration: this.videoElement.duration,
                muted: this.videoElement.muted,
                volume: this.videoElement.volume
            } : null
        };
    }
}

// Export for use
window.FlyerDisplay = FlyerDisplay;
