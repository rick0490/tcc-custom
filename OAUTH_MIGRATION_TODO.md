# OAuth Migration To-Do List

## Status: COMPLETED (2025-12-05)

OAuth 2.0 migration has been implemented and tested. The admin dashboard now uses OAuth Bearer tokens for all Challonge API calls.

### What Was Implemented:
- OAuth 2.0 authorization flow (`/auth/challonge`, `/auth/challonge/callback`)
- Token storage with AES-256-GCM encryption in SQLite
- Automatic token refresh before expiration (5-minute threshold)
- Settings UI for OAuth connection management
- 17 unit tests for OAuth functionality
- Updated CLAUDE.md documentation

### How to Connect:
1. Go to Settings > Challonge Account
2. Click "Connect Challonge Account"
3. Authorize on Challonge
4. You'll be redirected back to the dashboard

---

## Original Plan (for reference)

## Overview

Challonge is deprecating v1 API keys in favor of OAuth 2.0. This document outlines the migration plan for implementing OAuth authentication across the tournament dashboard system.

## Migration To-Do List

### **Phase 1: Research & Setup**

1. **Research Challonge OAuth v2 API documentation and requirements**
   - Review Challonge's OAuth 2.0 implementation
   - Identify authorization endpoints, token endpoints, and scopes
   - Understand token expiration and refresh token flow
   - Document API endpoint changes from v1 to v2

2. **Add OAuth library dependencies to admin-dashboard package.json**
   - Install `simple-oauth2` or `passport` for OAuth flow handling
   - Add token encryption library (e.g., `crypto` or `node-jose`)
   - Consider database library if moving from file-based storage (e.g., `better-sqlite3`)

3. **Update admin-dashboard/.env with OAuth credentials**
   - Replace `DEFAULT_CHALLONGE_KEY` with:
     - `CHALLONGE_CLIENT_ID` - OAuth application client ID
     - `CHALLONGE_CLIENT_SECRET` - OAuth application client secret
     - `CHALLONGE_REDIRECT_URI` - OAuth callback URL (e.g., `https://admin.despairhardware.com/auth/challonge/callback`)
   - Add optional `OAUTH_TOKEN_ENCRYPTION_KEY` for secure token storage

### **Phase 2: Admin Dashboard OAuth Core**

4. **Implement OAuth flow endpoints in admin-dashboard/server.js**
   - `GET /auth/challonge` - Initiates OAuth authorization flow
   - `GET /auth/challonge/callback` - Handles OAuth callback with authorization code
   - `POST /auth/challonge/refresh` - Manually refreshes access token
   - `GET /auth/challonge/status` - Returns current OAuth connection status

5. **Add token storage mechanism to admin dashboard**
   - **Option A (simple):** In-memory storage (lost on restart)
   - **Option B (recommended):** File-based encrypted JSON storage
   - **Option C (production):** SQLite or PostgreSQL database
   - Store: access token, refresh token, expiration timestamp, token type

6. **Implement automatic token refresh logic with expiration handling**
   - Create middleware to check token expiration before API calls
   - Automatically refresh token when expired or within 5 minutes of expiration
   - Implement retry logic for API calls that fail with 401 Unauthorized
   - Handle refresh token expiration (require user re-authentication)

### **Phase 3: Admin Dashboard UI**

7. **Update admin-dashboard/public/index.html with OAuth connection status UI**
   - Add OAuth status indicator (connected/disconnected)
   - Add "Connect Challonge Account" button (redirects to `/auth/challonge`)
   - Add "Reconnect" button for expired/invalid tokens
   - Show token expiration time and last refresh timestamp
   - Remove API key input field from tournament setup form

8. **Modify admin dashboard API routes to pass OAuth tokens instead of API keys**
   - Update `/api/tournament/setup` to use stored OAuth token
   - Update `/api/test-connection` to use OAuth token
   - Remove API key parameter from all request payloads
   - Add token validation before making requests to MagicMirror modules

### **Phase 4: MagicMirror Module Updates**

9. **Update MMM-TournamentNowPlaying/node_helper.js to accept OAuth tokens**
   - Modify `/api/tournament/update` endpoint to accept `token` field instead of `apiKey`
   - Store token in `tournament-state.json` alongside other config
   - Update internal state management to use tokens

10. **Update MMM-TournamentNowPlaying API request headers to use Bearer token authentication**
    - Change Challonge API requests from:
      ```javascript
      headers: { 'Authorization-Type': 'v1', 'Authorization': apiKey }
      ```
    - To:
      ```javascript
      headers: { 'Authorization': `Bearer ${token}` }
      ```
    - Update Challonge API base URL if v2 uses different endpoints

11. **Add 401 error handling and token refresh notification to MMM-TournamentNowPlaying**
    - Detect 401 Unauthorized responses from Challonge API
    - Log token expiration errors
    - Optionally: notify admin dashboard to refresh token (requires websocket or polling)
    - Pause tournament polling until valid token is provided

12. **Update tournament-state.json structure to store OAuth tokens**
    - Migrate state file format from:
      ```json
      { "apiKey": "...", "tournamentId": "...", ... }
      ```
    - To:
      ```json
      { "token": "...", "tokenExpiration": "...", "tournamentId": "...", ... }
      ```
    - Add migration logic to handle old state files during upgrade

### **Phase 5: Testing & Documentation**

13. **Update test_integration.py and test_tournament_update.py for OAuth token testing**
    - Replace API key parameters with OAuth token simulation
    - Add test cases for token expiration scenarios
    - Add test cases for token refresh flow
    - Test 401 error handling and recovery

14. **Test OAuth flow end-to-end with Challonge sandbox/test environment**
    - Create test Challonge OAuth application
    - Verify authorization flow works correctly
    - Test token refresh mechanism
    - Test tournament setup with OAuth tokens
    - Verify both MagicMirror modules work with tokens
    - Test error handling for expired/invalid tokens

15. **Update CLAUDE.md documentation with OAuth setup instructions**
    - Add OAuth configuration section to Admin Dashboard documentation
    - Document new environment variables
    - Update API endpoint documentation
    - Add OAuth troubleshooting section
    - Update system architecture diagram to show OAuth flow

16. **Add OAuth migration guide for existing deployments**
    - Create `OAUTH_MIGRATION.md` in admin-dashboard directory
    - Document step-by-step upgrade process
    - Provide rollback instructions
    - Include common issues and solutions
    - Add FAQ section

## Implementation Strategy

### Recommended approach: System-wide OAuth (simpler)
- Admin dashboard handles OAuth once for the entire system
- Single access token stored securely
- All tournament API calls use this shared token
- **Pros:** Simple implementation, single auth flow, minimal UI changes
- **Cons:** Single Challonge account only, token tied to one user

### Alternative approach: Per-tournament OAuth (complex)
- Each tournament setup could use different Challonge accounts
- Store multiple tokens with tournament associations
- **Pros:** Multi-account support, flexible permissions
- **Cons:** Complex token management, requires more UI work

## Token Security Considerations

- **Never log tokens** to console or log files
- **Encrypt tokens at rest** using AES-256 or similar
- **Use HTTPS** for all OAuth redirects (admin.despairhardware.com already has SSL)
- **Validate redirect URIs** to prevent authorization code interception
- **Implement PKCE** (Proof Key for Code Exchange) if Challonge supports it
- **Rotate tokens regularly** by using refresh tokens proactively

## Critical Path

The implementation should follow this order:
1. **Phase 1** (Research & Setup) - Understand Challonge's OAuth requirements
2. **Phase 2** (Admin Dashboard OAuth Core) - Build the OAuth infrastructure
3. **Phase 4** (MagicMirror Module Updates) - Update modules to consume tokens
4. **Phase 3** (Admin Dashboard UI) - Add user-facing OAuth controls
5. **Phase 5** (Testing & Documentation) - Validate and document everything

## Files That Will Be Modified

- `/root/tournament-dashboard/admin-dashboard/.env` - OAuth credentials
- `/root/tournament-dashboard/admin-dashboard/server.js` - OAuth endpoints and logic
- `/root/tournament-dashboard/admin-dashboard/package.json` - Add OAuth dependencies
- `/root/tournament-dashboard/admin-dashboard/public/index.html` - OAuth UI
- `/root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/node_helper.js` - Token handling
- `/root/tournament-dashboard/test_integration.py` - OAuth testing
- `/root/tournament-dashboard/test_tournament_update.py` - OAuth testing
- `/root/tournament-dashboard/CLAUDE.md` - Documentation updates (this file)

## Timeline Considerations

- **Before Challonge v1 API deprecation:** Complete Phases 1-4
- **Before production rollout:** Complete Phase 5 (testing)
- **After migration:** Monitor for token expiration issues and API changes

## Backward Compatibility

During the transition period, consider:
- Supporting both API key and OAuth token authentication temporarily
- Automatic detection of token vs. API key format
- Graceful fallback if OAuth is not configured
- Clear error messages guiding users to migrate

## Questions to Answer During Phase 1

- Does Challonge OAuth support refresh tokens?
- What is the token expiration time?
- Are there rate limits on token refresh requests?
- Do API v2 endpoints differ from v1 endpoints?
- Does Challonge support PKCE for enhanced security?
- What OAuth scopes are required for tournament management?
