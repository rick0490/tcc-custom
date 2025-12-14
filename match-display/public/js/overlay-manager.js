/**
 * Overlay Manager for Match Display
 *
 * Manages ticker messages, QR code overlays, sponsor overlays, and audio announcements.
 * Extracted from MMM-TournamentNowPlaying.js
 */

class OverlayManager {
    constructor() {
        this.tickerTimeout = null;
        this.qrTimeout = null;
        this.sponsorState = {
            enabled: false,
            config: {},
            sponsors: {}
        };
        this.debugMode = false;
        this.adminUrl = null;
    }

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Set admin dashboard URL for sponsor images
     */
    setAdminUrl(url) {
        this.adminUrl = url;
    }

    /**
     * Log message if debug mode is enabled
     */
    log(action, data = {}) {
        if (this.debugMode) {
            console.log(`%c[OverlayManager] ${action}`, 'color: #ec4899', data);
        }
    }

    // ==========================================
    // TICKER MESSAGE OVERLAY
    // ==========================================

    /**
     * Display a temporary ticker message at the bottom of the screen
     * @param {string} message - The message to display
     * @param {number} duration - Duration in milliseconds
     */
    showTickerMessage(message, duration) {
        this.log('showTickerMessage', { message, duration });

        // Clear any existing ticker timeout
        if (this.tickerTimeout) {
            clearTimeout(this.tickerTimeout);
            this.tickerTimeout = null;
        }

        // Remove existing ticker if present
        const existingTicker = document.getElementById('tourney-ticker');
        if (existingTicker) {
            existingTicker.remove();
        }

        // Create ticker container
        const ticker = document.createElement('div');
        ticker.id = 'tourney-ticker';
        ticker.className = 'tourney-ticker tourney-ticker--entering';

        // Create message content
        const messageEl = document.createElement('div');
        messageEl.className = 'tourney-ticker-message';
        messageEl.innerHTML = message;

        ticker.appendChild(messageEl);

        // Append to container or body
        const container = document.getElementById('ticker-container') || document.body;
        container.appendChild(ticker);

        // Trigger enter animation after a brief delay
        setTimeout(() => {
            ticker.classList.remove('tourney-ticker--entering');
            ticker.classList.add('tourney-ticker--visible');
        }, 50);

        // Set timeout to hide ticker
        this.tickerTimeout = setTimeout(() => {
            ticker.classList.remove('tourney-ticker--visible');
            ticker.classList.add('tourney-ticker--exiting');

            // Remove from DOM after exit animation
            setTimeout(() => {
                if (ticker.parentNode) {
                    ticker.parentNode.removeChild(ticker);
                }
                this.tickerTimeout = null;
            }, 500);
        }, duration);
    }

    /**
     * Handle ticker message event from WebSocket
     * @param {Object} payload - Event payload with message and duration
     */
    handleTickerMessage(payload) {
        if (payload && payload.message) {
            // Convert duration from seconds to milliseconds if needed
            const duration = payload.duration > 100 ? payload.duration : payload.duration * 1000;
            this.showTickerMessage(payload.message, duration);
        }
    }

    // ==========================================
    // QR CODE OVERLAY
    // ==========================================

    /**
     * Display a QR code overlay
     * @param {string} qrCode - Data URL of the QR code image
     * @param {string} url - The URL the QR code points to
     * @param {string} label - Label to display under the QR code
     * @param {number} duration - Optional duration in ms (null = permanent)
     */
    showQRCode(qrCode, url, label, duration) {
        this.log('showQRCode', { url, label, duration });

        // Clear any existing QR timeout
        if (this.qrTimeout) {
            clearTimeout(this.qrTimeout);
            this.qrTimeout = null;
        }

        // Remove existing QR if present
        const existingQR = document.getElementById('tourney-qr-overlay');
        if (existingQR) {
            existingQR.remove();
        }

        // Create QR overlay container
        const overlay = document.createElement('div');
        overlay.id = 'tourney-qr-overlay';
        overlay.className = 'tourney-qr-overlay tourney-qr-overlay--entering';

        // Create QR code container
        const qrContainer = document.createElement('div');
        qrContainer.className = 'tourney-qr-container';

        // Create QR code image
        const qrImage = document.createElement('img');
        qrImage.className = 'tourney-qr-image';
        qrImage.src = qrCode;
        qrImage.alt = 'Scan QR Code';
        qrContainer.appendChild(qrImage);

        // Create label
        const labelEl = document.createElement('div');
        labelEl.className = 'tourney-qr-label';
        labelEl.innerHTML = label || 'SCAN TO JOIN';
        qrContainer.appendChild(labelEl);

        // Create URL display (smaller, underneath)
        const urlEl = document.createElement('div');
        urlEl.className = 'tourney-qr-url';
        urlEl.innerHTML = url || '';
        qrContainer.appendChild(urlEl);

        overlay.appendChild(qrContainer);

        // Append to container or body
        const container = document.getElementById('qr-container') || document.body;
        container.appendChild(overlay);

        // Trigger enter animation
        setTimeout(() => {
            overlay.classList.remove('tourney-qr-overlay--entering');
            overlay.classList.add('tourney-qr-overlay--visible');
        }, 50);

        // If duration is set, auto-hide after duration
        if (duration && duration > 0) {
            this.qrTimeout = setTimeout(() => {
                this.hideQRCode();
            }, duration);
        }
    }

    /**
     * Hide the QR code overlay
     */
    hideQRCode() {
        this.log('hideQRCode');

        // Clear any existing timeout
        if (this.qrTimeout) {
            clearTimeout(this.qrTimeout);
            this.qrTimeout = null;
        }

        const overlay = document.getElementById('tourney-qr-overlay');
        if (overlay) {
            overlay.classList.remove('tourney-qr-overlay--visible');
            overlay.classList.add('tourney-qr-overlay--exiting');

            // Remove from DOM after exit animation
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 500);
        }
    }

    /**
     * Handle QR show event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleQRShow(payload) {
        if (payload && payload.qrCode) {
            this.showQRCode(
                payload.qrCode,
                payload.url,
                payload.label,
                payload.duration
            );
        }
    }

    /**
     * Handle QR hide event from WebSocket
     */
    handleQRHide() {
        this.hideQRCode();
    }

    // ==========================================
    // SPONSOR OVERLAYS
    // ==========================================

    /**
     * Show sponsor overlays at specified positions
     * @param {Object} sponsors - Object keyed by position with sponsor data
     * @param {Object} config - Sponsor configuration
     */
    showSponsors(sponsors, config) {
        this.log('showSponsors', { sponsors, config });

        // Update state
        this.sponsorState.enabled = config && config.enabled !== false;
        this.sponsorState.config = config || {};

        if (!this.sponsorState.enabled) {
            this.hideAllSponsors();
            return;
        }

        // Create or update sponsor overlays for each position
        Object.keys(sponsors).forEach(position => {
            const sponsor = sponsors[position];
            if (sponsor && sponsor.active) {
                this.createOrUpdateSponsorOverlay(position, sponsor);
                this.sponsorState.sponsors[position] = sponsor;
            }
        });
    }

    /**
     * Create or update a sponsor overlay at a specific position
     * @param {string} position - Position
     * @param {Object} sponsor - Sponsor data object
     */
    createOrUpdateSponsorOverlay(position, sponsor) {
        const overlayId = 'sponsor-overlay-' + position;
        let overlay = document.getElementById(overlayId);

        // Determine if this is a corner or banner position
        const isBanner = position === 'top-banner' || position === 'bottom-banner';

        if (!overlay) {
            // Create new overlay
            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.className = 'tourney-sponsor-overlay tourney-sponsor-overlay--' + position;

            if (isBanner) {
                overlay.classList.add('tourney-sponsor-overlay--banner');
            } else {
                overlay.classList.add('tourney-sponsor-overlay--corner');
            }

            overlay.classList.add('tourney-sponsor-overlay--entering');

            const container = document.getElementById('sponsor-container') || document.body;
            container.appendChild(overlay);

            // Trigger visible animation after brief delay
            setTimeout(() => {
                overlay.classList.remove('tourney-sponsor-overlay--entering');
                overlay.classList.add('tourney-sponsor-overlay--visible');
            }, 50);
        } else {
            // Existing overlay - ensure it's visible
            overlay.classList.remove('tourney-sponsor-overlay--exiting');
            overlay.classList.remove('tourney-sponsor-overlay--entering');
            overlay.classList.add('tourney-sponsor-overlay--visible');
        }

        // Update overlay content
        overlay.innerHTML = '';

        // Apply offset styling
        if (sponsor.offsetX || sponsor.offsetY) {
            const offsetX = sponsor.offsetX || 0;
            const offsetY = sponsor.offsetY || 0;

            // Apply offset based on position
            if (position.includes('left')) {
                overlay.style.marginLeft = offsetX + 'px';
            } else if (position.includes('right')) {
                overlay.style.marginRight = (-offsetX) + 'px';
            }

            if (position.includes('top')) {
                overlay.style.marginTop = offsetY + 'px';
            } else if (position.includes('bottom')) {
                overlay.style.marginBottom = (-offsetY) + 'px';
            }
        }

        if (isBanner) {
            // Banner: container for logo(s)
            const bannerContainer = document.createElement('div');
            bannerContainer.className = 'tourney-sponsor-banner-logos';

            const img = document.createElement('img');
            img.className = 'tourney-sponsor-banner-logo';
            img.src = this.getSponsorImageUrl(sponsor.filename);
            img.alt = sponsor.name || 'Sponsor';
            img.onerror = () => {
                console.error('Failed to load sponsor image:', sponsor.filename);
            };

            // Apply size scaling
            const scale = (sponsor.size || 100) / 100;
            img.style.transform = 'scale(' + scale + ')';

            // Apply opacity
            img.style.opacity = (sponsor.opacity || 100) / 100;

            // Apply border radius
            if (sponsor.borderRadius && sponsor.borderRadius > 0) {
                img.style.borderRadius = sponsor.borderRadius + 'px';
            }

            bannerContainer.appendChild(img);
            overlay.appendChild(bannerContainer);
        } else {
            // Corner: single logo
            const img = document.createElement('img');
            img.className = 'tourney-sponsor-logo';
            img.src = this.getSponsorImageUrl(sponsor.filename);
            img.alt = sponsor.name || 'Sponsor';
            img.onerror = () => {
                console.error('Failed to load sponsor image:', sponsor.filename);
            };

            // Apply size scaling (default 100%, base is 200x100px)
            const scale = (sponsor.size || 100) / 100;
            overlay.style.width = (200 * scale) + 'px';
            overlay.style.height = (100 * scale) + 'px';

            // Apply opacity
            img.style.opacity = (sponsor.opacity || 100) / 100;

            // Apply border radius
            if (sponsor.borderRadius && sponsor.borderRadius > 0) {
                img.style.borderRadius = sponsor.borderRadius + 'px';
            }

            overlay.appendChild(img);
        }
    }

    /**
     * Get sponsor image URL
     * @param {string} filename - Sponsor filename
     * @returns {string} Full URL to sponsor image
     */
    getSponsorImageUrl(filename) {
        if (this.adminUrl) {
            return this.adminUrl + '/api/sponsors/preview/' + filename;
        }
        return '/api/sponsors/image/' + filename;
    }

    /**
     * Hide sponsor at a specific position
     * @param {string} position - Position to hide
     */
    hideSponsor(position) {
        const overlayId = 'sponsor-overlay-' + position;
        const overlay = document.getElementById(overlayId);

        if (overlay) {
            overlay.classList.remove('tourney-sponsor-overlay--visible');
            overlay.classList.add('tourney-sponsor-overlay--exiting');

            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 500);
        }

        // Remove from state
        delete this.sponsorState.sponsors[position];
    }

    /**
     * Hide all sponsor overlays
     */
    hideAllSponsors() {
        this.log('hideAllSponsors');

        const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
        positions.forEach(position => {
            this.hideSponsor(position);
        });

        this.sponsorState.enabled = false;
    }

    /**
     * Rotate sponsor at a specific position
     * @param {string} position - Position to rotate
     * @param {Object} sponsor - New sponsor data
     */
    rotateSponsor(position, sponsor) {
        this.log('rotateSponsor', { position, sponsor });

        if (!sponsor || !sponsor.active) {
            this.hideSponsor(position);
            return;
        }

        // Get existing overlay
        const overlayId = 'sponsor-overlay-' + position;
        const overlay = document.getElementById(overlayId);

        if (overlay) {
            // Fade out existing
            overlay.classList.add('tourney-sponsor-overlay--exiting');

            setTimeout(() => {
                // Update with new sponsor
                this.createOrUpdateSponsorOverlay(position, sponsor);
                this.sponsorState.sponsors[position] = sponsor;
            }, 500);
        } else {
            // Create new overlay
            this.createOrUpdateSponsorOverlay(position, sponsor);
            this.sponsorState.sponsors[position] = sponsor;
        }
    }

    /**
     * Update sponsor configuration
     * @param {Object} config - New configuration
     */
    updateSponsorConfig(config) {
        this.log('updateSponsorConfig', config);
        this.sponsorState.config = config;

        if (config && config.enabled === false) {
            this.hideAllSponsors();
        }
    }

    /**
     * Handle sponsor show event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleSponsorShow(payload) {
        if (payload && payload.sponsors) {
            this.showSponsors(payload.sponsors, payload.config);
        }
    }

    /**
     * Handle sponsor hide event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleSponsorHide(payload) {
        if (payload && payload.position) {
            this.hideSponsor(payload.position);
        } else {
            this.hideAllSponsors();
        }
    }

    /**
     * Handle sponsor rotate event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleSponsorRotate(payload) {
        if (payload && payload.position) {
            this.rotateSponsor(payload.position, payload.sponsor);
        }
    }

    /**
     * Handle sponsor config event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleSponsorConfig(payload) {
        this.updateSponsorConfig(payload);
    }

    // ==========================================
    // AUDIO ANNOUNCEMENTS
    // ==========================================

    /**
     * Play audio announcement using Web Speech API
     * @param {string} text - Text to speak
     * @param {string} voice - Voice name (optional)
     * @param {number} rate - Speech rate 0.5-2.0 (default 1.0)
     * @param {number} volume - Volume 0.0-1.0 (default 1.0)
     */
    playAudioAnnouncement(text, voice, rate, volume) {
        this.log('playAudioAnnouncement', { text, voice, rate, volume });

        // Check if speech synthesis is available
        if (!window.speechSynthesis) {
            console.error('Speech synthesis not available in this browser');
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        // Create utterance
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate || 1.0;
        utterance.volume = volume || 1.0;
        utterance.pitch = 1.0;

        // Find voice if specified
        if (voice && voice !== 'default') {
            const voices = window.speechSynthesis.getVoices();
            const selectedVoice = voices.find(v =>
                v.name.toLowerCase().includes(voice.toLowerCase()) ||
                v.lang.toLowerCase().includes(voice.toLowerCase())
            );
            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }
        }

        // Log events for debugging
        utterance.onstart = () => {
            this.log('speechStarted', { text });
        };
        utterance.onend = () => {
            this.log('speechEnded');
        };
        utterance.onerror = (event) => {
            console.error('Speech error:', event.error);
        };

        // Speak the utterance
        window.speechSynthesis.speak(utterance);
    }

    /**
     * Handle audio announce event from WebSocket
     * @param {Object} payload - Event payload
     */
    handleAudioAnnounce(payload) {
        if (payload && payload.text) {
            this.playAudioAnnouncement(
                payload.text,
                payload.voice,
                payload.rate,
                payload.volume
            );
        }
    }

    // ==========================================
    // CLEANUP
    // ==========================================

    /**
     * Clear all overlays (cleanup on disconnect)
     */
    clearAll() {
        // Clear ticker
        if (this.tickerTimeout) {
            clearTimeout(this.tickerTimeout);
        }
        const ticker = document.getElementById('tourney-ticker');
        if (ticker) ticker.remove();

        // Clear QR
        if (this.qrTimeout) {
            clearTimeout(this.qrTimeout);
        }
        const qr = document.getElementById('tourney-qr-overlay');
        if (qr) qr.remove();

        // Clear sponsors
        this.hideAllSponsors();
    }
}

// Export for use in other modules
window.OverlayManager = OverlayManager;
