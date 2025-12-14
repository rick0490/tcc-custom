/**
 * Match Display - Main Controller
 *
 * Central controller for the match display.
 * Ties together WebSocket client, timers, overlays, and podium display.
 */

class MatchDisplay {
    constructor(config) {
        this.config = {
            adminWsUrl: config.adminWsUrl || 'http://localhost:3000',
            userId: config.userId || '1',
            pollInterval: config.pollInterval || 30000,
            ...config
        };

        // State
        this.matches = [];
        this.mode = 'live'; // 'live' | 'podium'
        this.podium = null;
        this.availableStations = [];
        this.lastPayloadJson = '';

        // Winner animation tracking
        this.completedMatchHold = {};
        this.lastMatchState = {};
        this.matchStationTracking = {};

        // Debug mode
        this.debugMode = localStorage.getItem('debug_mode') === 'true' ||
                         new URLSearchParams(window.location.search).has('debug');

        // DOM elements
        this.container = document.getElementById('match-display');
        this.loadingScreen = document.getElementById('loading-screen');
        this.errorScreen = document.getElementById('error-screen');

        // Initialize managers
        this.wsClient = null;
        this.timerManager = null;
        this.overlayManager = null;
        this.podiumDisplay = null;

        this.init();
    }

    /**
     * Initialize the match display
     */
    init() {
        console.log('[MatchDisplay] Initializing...', this.config);
        this.log('init', { config: this.config });

        // Initialize managers
        this.timerManager = new TimerManager();
        this.timerManager.setDebugMode(this.debugMode);

        this.overlayManager = new OverlayManager();
        this.overlayManager.setDebugMode(this.debugMode);

        this.podiumDisplay = new PodiumDisplay();
        this.podiumDisplay.setDebugMode(this.debugMode);

        // Initialize WebSocket client
        this.wsClient = new WebSocketClient(this.config.adminWsUrl, this.config.userId);
        this.wsClient.setDebugMode(this.debugMode);

        // Register event handlers
        this.setupEventHandlers();

        // Connect to WebSocket
        this.wsClient.connect();
    }

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        if (this.wsClient) this.wsClient.setDebugMode(enabled);
        if (this.timerManager) this.timerManager.setDebugMode(enabled);
        if (this.overlayManager) this.overlayManager.setDebugMode(enabled);
        if (this.podiumDisplay) this.podiumDisplay.setDebugMode(enabled);
    }

    /**
     * Log message if debug mode is enabled
     */
    log(action, data = {}) {
        if (this.debugMode) {
            console.log(`%c[MatchDisplay] ${action}`, 'color: #10b981', data);
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        const self = this;

        this.wsClient.onMany({
            // Connection events
            'connect': () => {
                self.log('connected');
                self.showDisplay();
            },
            'disconnect': (reason) => {
                self.log('disconnected', { reason });
                if (reason === 'io server disconnect') {
                    self.showError('Disconnected from server');
                }
            },
            'reconnecting': (attempt) => {
                self.log('reconnecting', { attempt });
            },
            'error': (error) => {
                self.log('error', { error: error.message });
                self.showError('Connection error: ' + error.message);
            },

            // Match updates
            'matches:update': (data) => {
                self.handleMatchesUpdate(data);
            },

            // Tournament events
            'tournament:update': (data) => {
                self.log('tournament:update', data);
            },
            'tournament:deployed': (data) => {
                self.log('tournament:deployed', data);
            },

            // Ticker messages
            'ticker:message': (data) => {
                self.overlayManager.handleTickerMessage(data);
            },

            // Timer events
            'timer:dq': (data) => {
                self.timerManager.handleTimerEvent('dq', data);
            },
            'timer:tournament': (data) => {
                self.timerManager.handleTimerEvent('tournament', data);
            },
            'timer:hide': (data) => {
                self.timerManager.handleTimerHide(data);
            },

            // QR code events
            'qr:show': (data) => {
                self.overlayManager.showQRCode(data.qrCode, data.url, data.label, data.duration);
            },
            'qr:hide': () => {
                self.overlayManager.hideQRCode();
            },

            // Sponsor events
            'sponsor:show': (data) => {
                self.overlayManager.showSponsors(data.sponsors, data.config);
            },
            'sponsor:hide': (data) => {
                if (data && data.position) {
                    self.overlayManager.hideSponsor(data.position);
                } else {
                    self.overlayManager.hideAllSponsors();
                }
            },
            'sponsor:rotate': (data) => {
                self.overlayManager.rotateSponsor(data.position, data.sponsor);
            },
            'sponsor:config': (data) => {
                self.overlayManager.updateSponsorConfig(data);
            },

            // Audio events
            'audio:announce': (data) => {
                self.overlayManager.playAudioAnnouncement(
                    data.text,
                    data.voice,
                    data.rate,
                    data.volume
                );
            },

            // Emergency mode events
            'emergency:activated': (data) => {
                self.log('emergency:activated', data);
                self.showTechnicalDifficulties(data);
            },
            'emergency:deactivated': (data) => {
                self.log('emergency:deactivated', data);
                self.hideTechnicalDifficulties();
            },
            'emergency:status': (data) => {
                self.log('emergency:status', data);
                if (data.active) {
                    self.showTechnicalDifficulties(data);
                } else {
                    self.hideTechnicalDifficulties();
                }
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
     * Normalize match data to internal snake_case format
     * Backend consistently sends camelCase - map to internal snake_case
     */
    normalizeMatch(m) {
        return {
            id: m.id,
            state: m.state,
            round: m.round,
            identifier: m.identifier,
            player1_id: m.player1Id,
            player2_id: m.player2Id,
            player1_name: m.player1Name || 'TBD',
            player2_name: m.player2Name || 'TBD',
            winner_id: m.winnerId,
            winner_name: m.winnerName,
            player1_score: m.player1Score,
            player2_score: m.player2Score,
            station_id: m.stationId,
            station_name: m.stationName,
            underway_at: m.underwayAt,
            suggested_play_order: m.suggestedPlayOrder
        };
    }

    /**
     * Handle matches update from WebSocket
     */
    handleMatchesUpdate(payload) {
        this.log('handleMatchesUpdate', {
            matchCount: payload.matches?.length,
            podiumComplete: payload.podium?.isComplete
        });

        const self = this;
        // Normalize all matches to snake_case format
        const newMatches = (payload.matches || []).map(m => this.normalizeMatch(m));

        // Detect newly completed matches and add them to hold
        newMatches.forEach(function(match) {
            const matchId = match.id;
            const prevState = self.lastMatchState[matchId];
            const currentState = self.getMatchState(match);

            // Track station name when match is assigned to a TV
            if ((currentState === 'underway' || currentState === 'next-up') && match.station_name) {
                if (!self.matchStationTracking[matchId]) {
                    self.log('trackStation', { matchId, station: match.station_name, state: currentState });
                }
                self.matchStationTracking[matchId] = match.station_name;
            }

            // If match just completed (transition from any state to complete)
            if (prevState && prevState !== 'complete' && currentState === 'complete') {
                const originalStation = self.matchStationTracking[matchId] || match.station_name || null;
                self.log('matchCompleted', { matchId, prevState, originalStation });

                self.completedMatchHold[matchId] = {
                    match: match,
                    originalStation: originalStation,
                    timestamp: Date.now(),
                    fadingOut: false,
                    animationPlayed: false,  // Track if winner animation has been shown
                    timeoutId: setTimeout(function() {
                        self.log('startingFadeOut', { matchId });

                        // Find the winner container and fade it out
                        const winnerContainer = document.querySelector(
                            '.tourney-winner-container[data-match-id="' + matchId + '"]'
                        );
                        if (winnerContainer) {
                            winnerContainer.classList.add('tourney-winner-container--fadeout');
                        }

                        // After fade completes, refresh the quadrant
                        setTimeout(function() {
                            const holdData = self.completedMatchHold[matchId];
                            const tvLabel = holdData ? holdData.originalStation : null;

                            delete self.completedMatchHold[matchId];
                            delete self.matchStationTracking[matchId];
                            self.log('holdExpired', { matchId, tvLabel });

                            if (tvLabel) {
                                self.refreshSingleQuadrant(tvLabel);
                            } else {
                                self.render();
                            }
                        }, 600);
                    }, 3400)
                };
            }

            // If a held completed match is no longer complete, release it
            if (self.completedMatchHold[matchId] && currentState !== 'complete') {
                self.log('releaseHold', { matchId, newState: currentState });
                clearTimeout(self.completedMatchHold[matchId].timeoutId);
                delete self.completedMatchHold[matchId];
            }

            // Update last state
            self.lastMatchState[matchId] = currentState;
        });

        // Check for payload changes (use normalized matches for comparison)
        const normalizedPayload = { ...payload, matches: newMatches };
        const jsonStr = JSON.stringify(normalizedPayload || {});
        if (jsonStr === this.lastPayloadJson) {
            // Payload unchanged - skip re-render to prevent animation replay
            // (completed match holds are already being displayed from previous render)
            return;
        }
        this.lastPayloadJson = jsonStr;

        this.matches = newMatches;
        this.availableStations = payload.availableStations || [];

        // Determine new mode
        const newMode = (payload.podium && payload.podium.isComplete) ? 'podium' : 'live';
        const modeChanged = (this.mode !== newMode);

        if (modeChanged) {
            this.log('modeChange', { from: this.mode, to: newMode });
            this.mode = newMode;
            this.podium = newMode === 'podium' ? payload.podium : null;
            this.animateModeTransition();
        } else {
            this.podium = newMode === 'podium' ? payload.podium : null;
            this.render();
        }
    }

    /**
     * Animate transition between modes
     */
    animateModeTransition() {
        const self = this;
        const container = this.container;

        // Fade out
        container.style.transition = 'opacity 800ms ease-out';
        container.style.opacity = '0';

        setTimeout(function() {
            self.render();
            setTimeout(function() {
                container.style.opacity = '1';
            }, 50);
        }, 800);
    }

    /**
     * Show the main display
     */
    showDisplay() {
        if (this.loadingScreen) {
            this.loadingScreen.style.display = 'none';
        }
        if (this.errorScreen) {
            this.errorScreen.style.display = 'none';
        }
        if (this.container) {
            this.container.style.display = 'flex';
        }
    }

    /**
     * Show error screen
     */
    showError(message) {
        if (this.loadingScreen) {
            this.loadingScreen.style.display = 'none';
        }
        if (this.container) {
            this.container.style.display = 'none';
        }
        if (this.errorScreen) {
            this.errorScreen.style.display = 'flex';
            const msgEl = this.errorScreen.querySelector('.error-message');
            if (msgEl) {
                msgEl.textContent = message || 'Connection error';
            }
        }
    }

    /**
     * Main render function
     */
    render() {
        if (!this.container) return;

        this.container.innerHTML = '';

        if (this.mode === 'podium' && this.podium && this.podium.isComplete) {
            const podiumEl = this.podiumDisplay.render(this.podium);
            this.container.appendChild(podiumEl);
        } else {
            const liveEl = this.renderLive();
            this.container.appendChild(liveEl);
        }
    }

    /**
     * Render live match view
     */
    renderLive() {
        const self = this;
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.color = 'white';
        wrapper.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapper.style.boxSizing = 'border-box';
        wrapper.style.padding = '20px 40px';
        wrapper.style.backgroundColor = 'black';

        const allMatches = this.matches || [];

        function isActiveState(m) {
            return m.state === 'open' || m.state === 'pending' || m.state === 'underway';
        }

        // Get TV matches
        let tv1Matches = allMatches.filter(m => m.station_name === 'TV 1' && isActiveState(m))
            .sort((a, b) => {
                if (a.round !== b.round) return Math.abs(a.round) - Math.abs(b.round);
                if (a.suggested_play_order !== b.suggested_play_order) {
                    return a.suggested_play_order - b.suggested_play_order;
                }
                return (a.identifier || '').localeCompare(b.identifier || '');
            });

        let tv2Matches = allMatches.filter(m => m.station_name === 'TV 2' && isActiveState(m))
            .sort((a, b) => {
                if (a.round !== b.round) return Math.abs(a.round) - Math.abs(b.round);
                if (a.suggested_play_order !== b.suggested_play_order) {
                    return a.suggested_play_order - b.suggested_play_order;
                }
                return (a.identifier || '').localeCompare(b.identifier || '');
            });

        let tv1Current = tv1Matches[0] || null;
        let tv2Current = tv2Matches[0] || null;

        // Up Next queue - only matches with known players, sorted by round then play order
        let queue = allMatches.filter(m => {
            return isActiveState(m) &&
                   (!m.station_name || m.station_name === '') &&
                   m.identifier !== '3RD' &&
                   m.player1_id != null && m.player2_id != null;  // Only show matches with known players
        }).sort((a, b) => {
            // Sort by round first (earlier rounds first, using abs for losers bracket negative rounds)
            if (a.round !== b.round) return Math.abs(a.round) - Math.abs(b.round);
            // Then by suggested play order
            if (a.suggested_play_order !== b.suggested_play_order) {
                return a.suggested_play_order - b.suggested_play_order;
            }
            // Finally by identifier
            const idA = a.identifier || '';
            const idB = b.identifier || '';
            return idA.localeCompare(idB);
        });

        let next1 = queue[0] || null;
        let next2 = queue[1] || null;

        // Endgame logic for 3rd place and finals
        const thirdMatch = allMatches.find(m => m.identifier === '3RD');
        const has3rdPlaceMatch = !!thirdMatch;

        let finalsMatch = null;
        allMatches.forEach(m => {
            if (m.identifier === '3RD') return;
            const r = typeof m.round === 'number' ? m.round : 0;
            if (!finalsMatch || r > (finalsMatch.round || 0)) {
                finalsMatch = m;
            }
        });

        let endgameActive = false;
        let finalsOnlyMode = false;

        if (has3rdPlaceMatch && thirdMatch && finalsMatch &&
            thirdMatch.player1_id != null && thirdMatch.player2_id != null &&
            finalsMatch.player1_id != null && finalsMatch.player2_id != null) {
            // Tournament WITH 3rd place match - check if only 3rd/finals remain
            const otherActiveMatches = allMatches.filter(m =>
                m.id !== thirdMatch.id && m.id !== finalsMatch.id && m.state !== 'complete'
            );

            if (otherActiveMatches.length === 0) {
                endgameActive = true;
                this.log('endgameActivated', { mode: 'with3rdPlace' });
            }
        } else if (!has3rdPlaceMatch && finalsMatch &&
            finalsMatch.player1_id != null && finalsMatch.player2_id != null) {
            // Tournament WITHOUT 3rd place match - check if only finals remains
            const otherActiveMatches = allMatches.filter(m =>
                m.id !== finalsMatch.id && m.state !== 'complete'
            );

            if (otherActiveMatches.length === 0) {
                finalsOnlyMode = true;
                this.log('endgameActivated', { mode: 'finalsOnly' });
            }
        }

        if (endgameActive) {
            // 3rd place + finals mode
            if (thirdMatch.state !== 'complete') {
                tv1Current = thirdMatch;
                tv2Current = null;
                queue = [finalsMatch];
                next1 = queue[0] || null;
                next2 = queue[1] || null;
            } else if (finalsMatch.state !== 'complete') {
                tv1Current = finalsMatch;
                tv2Current = null;
                queue = [];
                next1 = null;
                next2 = null;
            }
        } else if (finalsOnlyMode) {
            // Finals only mode (no 3rd place match)
            tv1Current = finalsMatch;
            tv2Current = null;
            queue = [];
            next1 = null;
            next2 = null;
        }

        // Completed match hold override
        Object.keys(this.completedMatchHold).forEach(matchId => {
            const holdData = self.completedMatchHold[matchId];
            const heldMatch = holdData.match;
            const originalStation = holdData.originalStation;

            let actualTV = null;
            if (tv1Current && tv1Current.id == matchId) {
                actualTV = 'TV 1';
            } else if (tv2Current && tv2Current.id == matchId) {
                actualTV = 'TV 2';
            }

            if (actualTV && actualTV !== originalStation) {
                holdData.originalStation = actualTV;
            }

            if (originalStation === 'TV 1') {
                tv1Current = heldMatch;
            } else if (originalStation === 'TV 2') {
                tv2Current = heldMatch;
            }
        });

        // Determine which TVs to show
        let showTV1 = false;
        let showTV2 = false;

        if (this.availableStations && this.availableStations.length > 0) {
            showTV1 = this.availableStations.includes('TV 1');
            showTV2 = this.availableStations.includes('TV 2');
        } else {
            showTV1 = true;
            showTV2 = true;
        }

        if (endgameActive || finalsOnlyMode) {
            showTV2 = false;
        }

        // Top row (60%)
        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.flex = '3';
        topRow.style.boxSizing = 'border-box';

        if (showTV1) {
            const tv1Quad = this.createTvQuadrant('TV 1', tv1Current);
            topRow.appendChild(tv1Quad);
        }

        if (showTV2) {
            const tv2Quad = this.createTvQuadrant('TV 2', tv2Current);
            topRow.appendChild(tv2Quad);
        }

        if ((showTV1 && !showTV2) || (!showTV1 && showTV2)) {
            topRow.style.justifyContent = 'center';
        }

        // Bottom row (40%)
        const bottomRow = document.createElement('div');
        bottomRow.style.display = 'flex';
        bottomRow.style.flex = '2';
        bottomRow.style.boxSizing = 'border-box';
        bottomRow.style.marginTop = '25px';
        bottomRow.style.borderRadius = '12px';
        bottomRow.style.border = '4px solid #ffffff';
        bottomRow.style.background = '#000000';
        bottomRow.style.flexDirection = 'column';
        bottomRow.style.justifyContent = 'center';
        bottomRow.style.alignItems = 'center';
        bottomRow.style.padding = '30px 50px';

        // Check if we're in finals-only endgame (no more matches after current)
        const isGrandFinals = (endgameActive || finalsOnlyMode) && !next1;

        if (isGrandFinals) {
            // Show "Grand Finals" message instead of Up Next
            const finalsTitle = document.createElement('div');
            finalsTitle.innerHTML = '🏆 Grand Finals 🏆';
            finalsTitle.style.fontSize = '72px';
            finalsTitle.style.fontWeight = '900';
            finalsTitle.style.textAlign = 'center';
            finalsTitle.style.textTransform = 'uppercase';
            finalsTitle.style.letterSpacing = '6px';
            finalsTitle.style.color = '#ffd700';
            finalsTitle.style.textShadow = '0 0 30px rgba(255, 215, 0, 0.5)';
            finalsTitle.style.animation = 'matchFadeIn 0.5s ease-out';
            bottomRow.appendChild(finalsTitle);

            const finalsSubtitle = document.createElement('div');
            finalsSubtitle.innerHTML = 'Final Match in Progress';
            finalsSubtitle.style.fontSize = '36px';
            finalsSubtitle.style.fontWeight = '700';
            finalsSubtitle.style.marginTop = '20px';
            finalsSubtitle.style.color = '#ffffff';
            finalsSubtitle.style.opacity = '0.8';
            finalsSubtitle.style.textTransform = 'uppercase';
            finalsSubtitle.style.letterSpacing = '4px';
            bottomRow.appendChild(finalsSubtitle);
        } else {
            const upNextTitle = document.createElement('div');
            upNextTitle.innerHTML = 'Up Next';
            upNextTitle.className = 'tourney-upnext-title';
            upNextTitle.style.fontSize = '54px';
            upNextTitle.style.fontWeight = '900';
            upNextTitle.style.marginBottom = '20px';
            upNextTitle.style.textAlign = 'center';
            upNextTitle.style.textTransform = 'uppercase';
            upNextTitle.style.letterSpacing = '5px';
            upNextTitle.style.color = '#ff2e2e';
            bottomRow.appendChild(upNextTitle);

            const list = document.createElement('div');
            list.style.fontSize = '48px';
            list.style.lineHeight = '1.7';
            list.style.textAlign = 'center';
            list.style.fontWeight = '800';
            list.style.color = '#ffffff';
            list.style.animation = 'matchFadeIn 0.5s ease-out';

            // Only show matches if there are any in the queue
            if (next1) {
                const line1 = document.createElement('div');

                // Check if next1 is the finals match (during 3rd place phase)
                const isNextFinals = endgameActive && finalsMatch && next1.id === finalsMatch.id;
                if (isNextFinals) {
                    line1.innerHTML = '<span style="color: #ffd700; font-weight: 900;">FINALS:</span> ' + this.formatMatchLine(next1);
                    line1.style.color = '#ffd700';
                    line1.style.textShadow = '0 0 20px rgba(255, 215, 0, 0.4)';
                } else {
                    line1.innerHTML = '<span style="color: #ff2e2e; font-weight: 900;">1.</span> ' + this.formatMatchLine(next1);
                }
                line1.style.marginBottom = '10px';
                list.appendChild(line1);

                const showSecondMatch = next2 && (next2.player1_id != null || next2.player2_id != null);
                if (showSecondMatch) {
                    const line2 = document.createElement('div');
                    line2.innerHTML = '<span style="color: #ff2e2e; font-weight: 900;">2.</span> ' + this.formatMatchLine(next2);
                    list.appendChild(line2);
                }
            } else {
                // No matches in queue but not in endgame mode
                const noMatches = document.createElement('div');
                noMatches.innerHTML = 'No matches waiting';
                noMatches.style.opacity = '0.5';
                list.appendChild(noMatches);
            }

            bottomRow.appendChild(list);
        }

        wrapper.appendChild(topRow);
        wrapper.appendChild(bottomRow);

        return wrapper;
    }

    /**
     * Create a TV quadrant element
     */
    createTvQuadrant(tvLabel, match) {
        const self = this;
        const quad = document.createElement('div');
        quad.setAttribute('data-tv-label', tvLabel);
        quad.style.flex = '1';
        quad.style.display = 'flex';
        quad.style.flexDirection = 'column';
        quad.style.alignItems = 'center';
        quad.style.justifyContent = 'center';
        quad.style.borderRadius = '12px';
        quad.style.boxSizing = 'border-box';
        quad.style.margin = '15px';
        quad.style.padding = '40px 30px';
        quad.style.position = 'relative';
        quad.style.background = '#000000';

        // Apply state-based CSS classes
        if (match) {
            const matchState = this.getMatchState(match);

            if (matchState === 'underway') {
                quad.className = 'tourney-tv-card tourney-tv-card--underway';
            } else if (matchState === 'next-up') {
                quad.className = 'tourney-tv-card tourney-tv-card--next-up';
            } else if (matchState === 'complete') {
                quad.className = 'tourney-tv-card tourney-tv-card--complete';
            } else {
                quad.className = 'tourney-tv-card tourney-tv-card--pending';
            }

            // Add state badge
            const badge = document.createElement('div');
            badge.className = 'tourney-match-state-badge tourney-match-state-badge--' + matchState;

            const badgeText = matchState === 'underway' ? '&#128308; LIVE' :
                             matchState === 'next-up' ? '&#128993; NEXT' :
                             matchState === 'complete' ? '&#10003;' : '';

            if (badgeText) {
                badge.innerHTML = badgeText;
                quad.appendChild(badge);
            }

            // Show winner or normal display
            if (matchState === 'complete') {
                this.buildWinnerDisplay(quad, match);
            } else {
                this.buildNormalDisplay(quad, tvLabel, match);
            }
        } else {
            quad.className = 'tourney-tv-card tourney-tv-card--pending';
            this.buildNormalDisplay(quad, tvLabel, null);
        }

        return quad;
    }

    /**
     * Build winner display content
     * Match data is already normalized to snake_case by normalizeMatch()
     */
    buildWinnerDisplay(quad, match) {
        let displayName = 'Unknown';
        if (match.winner_name) {
            // Use winner_name directly if available
            displayName = match.winner_name;
        } else if (match.winner_id) {
            // Otherwise determine from player IDs
            if (match.winner_id === match.player1_id) {
                displayName = match.player1_name || 'TBD';
            } else if (match.winner_id === match.player2_id) {
                displayName = match.player2_name || 'TBD';
            }
        }

        // Check if animation has already been played for this held match
        const holdData = this.completedMatchHold[match.id];
        const skipAnimation = holdData && holdData.animationPlayed;

        const winnerContainer = document.createElement('div');
        winnerContainer.className = 'tourney-winner-container' + (skipAnimation ? ' tourney-winner-container--no-anim' : '');
        winnerContainer.setAttribute('data-match-id', match.id);

        const winnerLabel = document.createElement('div');
        winnerLabel.className = 'tourney-winner-label' + (skipAnimation ? ' tourney-winner-label--no-anim' : '');
        winnerLabel.innerHTML = 'Winner';
        winnerContainer.appendChild(winnerLabel);

        const winnerNameDiv = document.createElement('div');
        winnerNameDiv.className = 'tourney-winner-name' + (skipAnimation ? ' tourney-winner-name--no-anim' : '');
        winnerNameDiv.innerHTML = displayName;
        winnerContainer.appendChild(winnerNameDiv);

        quad.appendChild(winnerContainer);

        // Mark animation as played for future renders
        if (holdData && !holdData.animationPlayed) {
            holdData.animationPlayed = true;
        }
    }

    /**
     * Build normal display content
     */
    buildNormalDisplay(quad, tvLabel, match) {
        const normalContent = document.createElement('div');
        normalContent.className = 'tourney-normal-content';

        const title = document.createElement('div');
        title.innerHTML = tvLabel;
        title.style.fontSize = '72px';
        title.style.color = '#ffffff';
        title.style.marginBottom = '15px';
        title.style.fontWeight = '900';
        title.style.letterSpacing = '6px';
        title.style.textTransform = 'uppercase';
        normalContent.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.innerHTML = 'Now Playing';
        subtitle.style.fontSize = '42px';
        subtitle.style.marginBottom = '25px';
        subtitle.style.color = '#ff2e2e';
        subtitle.style.textTransform = 'uppercase';
        subtitle.style.letterSpacing = '3px';
        subtitle.style.fontWeight = '700';
        normalContent.appendChild(subtitle);

        const content = document.createElement('div');
        content.innerHTML = match ? this.formatMatch(match) : 'Waiting...';
        content.style.fontSize = '58px';
        content.style.textAlign = 'center';
        content.style.fontWeight = '900';
        content.style.color = '#ffffff';
        content.style.lineHeight = '1.4';
        content.style.animation = 'matchFadeIn 0.5s ease-out';
        normalContent.appendChild(content);

        quad.appendChild(normalContent);
    }

    /**
     * Refresh only a specific TV quadrant
     */
    refreshSingleQuadrant(tvLabel) {
        this.log('refreshQuadrant', { tvLabel });

        const allMatches = this.matches || [];
        const tvMatches = allMatches.filter(m =>
            m.station_name === tvLabel && (m.state === 'open' || m.state === 'pending')
        ).sort((a, b) => {
            if (a.round !== b.round) return Math.abs(a.round) - Math.abs(b.round);
            if (a.suggested_play_order !== b.suggested_play_order) {
                return a.suggested_play_order - b.suggested_play_order;
            }
            return (a.identifier || '').localeCompare(b.identifier || '');
        });

        const nextMatch = tvMatches[0] || null;
        const targetQuad = document.querySelector('[data-tv-label="' + tvLabel + '"]');

        if (!targetQuad) {
            this.log('quadrantNotFound', { tvLabel });
            return;
        }

        const self = this;

        // Fade out
        targetQuad.style.transition = 'opacity 300ms ease-out';
        targetQuad.style.opacity = '0';

        setTimeout(function() {
            targetQuad.innerHTML = '';
            self.rebuildQuadrantContent(targetQuad, tvLabel, nextMatch);
            setTimeout(function() {
                targetQuad.style.opacity = '1';
            }, 50);
        }, 300);
    }

    /**
     * Rebuild quadrant content
     */
    rebuildQuadrantContent(quad, tvLabel, match) {
        // Reset classes
        if (match) {
            const matchState = this.getMatchState(match);
            if (matchState === 'underway') {
                quad.className = 'tourney-tv-card tourney-tv-card--underway';
            } else if (matchState === 'next-up') {
                quad.className = 'tourney-tv-card tourney-tv-card--next-up';
            } else if (matchState === 'complete') {
                quad.className = 'tourney-tv-card tourney-tv-card--complete';
            } else {
                quad.className = 'tourney-tv-card tourney-tv-card--pending';
            }

            const badge = document.createElement('div');
            badge.className = 'tourney-match-state-badge tourney-match-state-badge--' + matchState;
            const badgeText = matchState === 'underway' ? '&#128308; LIVE' :
                             matchState === 'next-up' ? '&#128993; NEXT' :
                             matchState === 'complete' ? '&#10003;' : '';
            if (badgeText) {
                badge.innerHTML = badgeText;
                quad.appendChild(badge);
            }
        } else {
            quad.className = 'tourney-tv-card tourney-tv-card--pending';
        }

        this.buildNormalDisplay(quad, tvLabel, match);
    }

    /**
     * Format match for display
     */
    formatMatch(match) {
        if (!match) return '';
        return (match.player1_name || 'TBD') + ' vs ' + (match.player2_name || 'TBD');
    }

    /**
     * Format match line for Up Next list
     */
    formatMatchLine(match) {
        if (!match) return 'TBD vs TBD';
        return this.formatMatch(match);
    }

    /**
     * Determine match state for highlighting
     * Match lifecycle: pending -> open -> underway -> complete
     */
    getMatchState(match) {
        if (!match) return 'pending';

        if (match.state === 'complete') {
            return 'complete';
        }

        // Check for underway state (preferred) or underway_at timestamp (backwards compatibility)
        if (match.state === 'underway' || match.underway_at) {
            return 'underway';
        }

        // Next up if assigned to station or open with both players
        if (match.station_name ||
            (match.state === 'open' && match.player1_id != null && match.player2_id != null)) {
            return 'next-up';
        }

        return 'pending';
    }

    /**
     * Format elapsed time since match started
     */
    formatElapsedTime(underwayAt) {
        if (!underwayAt) return '00:00';

        try {
            const startTime = new Date(underwayAt);
            const now = new Date();
            let elapsedMs = now - startTime;

            if (elapsedMs < 0) return '00:00';

            const elapsedSeconds = Math.floor(elapsedMs / 1000);
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;

            return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        } catch (err) {
            console.error('[MatchDisplay] Error formatting elapsed time:', err);
            return '00:00';
        }
    }

    /**
     * Retry connection
     */
    retry() {
        if (this.errorScreen) {
            this.errorScreen.style.display = 'none';
        }
        if (this.loadingScreen) {
            this.loadingScreen.style.display = 'flex';
        }
        this.wsClient.connect();
    }
}

// Export for use in other modules (initialization done in EJS template)
window.MatchDisplay = MatchDisplay;
