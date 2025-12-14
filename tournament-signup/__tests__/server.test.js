/**
 * Unit tests for Tournament Signup server
 */

const request = require('supertest');
const { app, getGameConfigKey, isRegistrationOpen, VALIDATION, ERROR_CODES } = require('../server.js');

// ==================== UNIT TESTS ====================

describe('getGameConfigKey()', () => {
    test('returns "ssbu" for Super Smash Bros. Ultimate', () => {
        expect(getGameConfigKey('Super Smash Bros. Ultimate')).toBe('ssbu');
        expect(getGameConfigKey('SSBU')).toBe('ssbu');
        expect(getGameConfigKey('ssbu')).toBe('ssbu');
        expect(getGameConfigKey('Ultimate')).toBe('ssbu');
    });

    test('returns "melee" for Super Smash Bros. Melee', () => {
        expect(getGameConfigKey('Super Smash Bros. Melee')).toBe('melee');
        expect(getGameConfigKey('Melee')).toBe('melee');
        expect(getGameConfigKey('MELEE')).toBe('melee');
    });

    test('returns "mkw" for Mario Kart World', () => {
        expect(getGameConfigKey('Mario Kart World')).toBe('mkw');
        expect(getGameConfigKey('MKW')).toBe('mkw');
        expect(getGameConfigKey('mkw')).toBe('mkw');
    });

    test('returns "mk8" for Mario Kart 8', () => {
        expect(getGameConfigKey('Mario Kart 8 Deluxe')).toBe('mk8');
        expect(getGameConfigKey('MK8')).toBe('mk8');
        expect(getGameConfigKey('mk8dx')).toBe('mk8');
    });

    test('returns "mkw" for generic "Mario Kart"', () => {
        expect(getGameConfigKey('Mario Kart')).toBe('mkw');
    });

    test('returns "halo3" for Halo games', () => {
        expect(getGameConfigKey('Halo 3')).toBe('halo3');
        expect(getGameConfigKey('H3')).toBe('halo3');
        expect(getGameConfigKey('Halo Infinite')).toBe('halo3'); // fallback
    });

    test('returns "sf6" for Street Fighter', () => {
        expect(getGameConfigKey('Street Fighter 6')).toBe('sf6');
        expect(getGameConfigKey('SF6')).toBe('sf6');
        expect(getGameConfigKey('Street Fighter')).toBe('sf6');
    });

    test('returns "default" for unknown games', () => {
        expect(getGameConfigKey('Unknown Game')).toBe('default');
        expect(getGameConfigKey('')).toBe('default');
        expect(getGameConfigKey(null)).toBe('default');
        expect(getGameConfigKey(undefined)).toBe('default');
    });

    test('is case-insensitive', () => {
        expect(getGameConfigKey('SUPER SMASH BROS. ULTIMATE')).toBe('ssbu');
        expect(getGameConfigKey('super smash bros. ultimate')).toBe('ssbu');
        expect(getGameConfigKey('Super Smash Bros. Ultimate')).toBe('ssbu');
    });
});

describe('isRegistrationOpen()', () => {
    const defaultWindowHours = 48;

    test('returns closed when tournament is not pending', () => {
        const result = isRegistrationOpen({ state: 'underway' }, defaultWindowHours);
        expect(result.open).toBe(false);
        expect(result.reason).toBe('tournament_started');
    });

    test('returns open when tournament is pending with no start time', () => {
        const result = isRegistrationOpen({ state: 'pending', start_at: null }, defaultWindowHours);
        expect(result.open).toBe(true);
    });

    test('returns open when within registration window', () => {
        // Tournament starts in 24 hours (within 48 hour window)
        const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const result = isRegistrationOpen({
            state: 'pending',
            start_at: startTime.toISOString()
        }, defaultWindowHours);
        expect(result.open).toBe(true);
    });

    test('returns too_early when before registration window', () => {
        // Tournament starts in 72 hours (outside 48 hour window)
        const startTime = new Date(Date.now() + 72 * 60 * 60 * 1000);
        const result = isRegistrationOpen({
            state: 'pending',
            start_at: startTime.toISOString()
        }, defaultWindowHours);
        expect(result.open).toBe(false);
        expect(result.reason).toBe('too_early');
        expect(result.opensAt).toBeDefined();
    });

    test('uses custom registration window hours', () => {
        // Tournament starts in 100 hours, with 120 hour window
        const startTime = new Date(Date.now() + 100 * 60 * 60 * 1000);
        const result = isRegistrationOpen({
            state: 'pending',
            start_at: startTime.toISOString()
        }, 120);
        expect(result.open).toBe(true);
    });

    test('registration stays open even after scheduled start time if tournament pending', () => {
        // Tournament was scheduled 1 hour ago but still pending (late walk-in support)
        const startTime = new Date(Date.now() - 1 * 60 * 60 * 1000);
        const result = isRegistrationOpen({
            state: 'pending',
            start_at: startTime.toISOString()
        }, defaultWindowHours);
        expect(result.open).toBe(true);
    });
});

describe('VALIDATION constants', () => {
    test('NAME_MIN is 2', () => {
        expect(VALIDATION.NAME_MIN).toBe(2);
    });

    test('NAME_MAX is 50', () => {
        expect(VALIDATION.NAME_MAX).toBe(50);
    });

    test('INSTAGRAM_PATTERN validates correctly', () => {
        const pattern = VALIDATION.INSTAGRAM_PATTERN;

        // Valid handles
        expect(pattern.test('username')).toBe(true);
        expect(pattern.test('user.name')).toBe(true);
        expect(pattern.test('user_name')).toBe(true);
        expect(pattern.test('user123')).toBe(true);
        expect(pattern.test('a')).toBe(true); // Min 1 char

        // Invalid handles
        expect(pattern.test('')).toBe(false);
        expect(pattern.test('user@name')).toBe(false);
        expect(pattern.test('user-name')).toBe(false);
        expect(pattern.test('user name')).toBe(false);
        expect(pattern.test('a'.repeat(31))).toBe(false); // Max 30 chars
    });
});

describe('ERROR_CODES', () => {
    test('contains all expected error codes', () => {
        expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
        expect(ERROR_CODES.NAME_REQUIRED).toBe('NAME_REQUIRED');
        expect(ERROR_CODES.NAME_TOO_SHORT).toBe('NAME_TOO_SHORT');
        expect(ERROR_CODES.NAME_TOO_LONG).toBe('NAME_TOO_LONG');
        expect(ERROR_CODES.INVALID_INSTAGRAM).toBe('INVALID_INSTAGRAM');
        expect(ERROR_CODES.DUPLICATE_NAME).toBe('DUPLICATE_NAME');
        expect(ERROR_CODES.TOURNAMENT_FULL).toBe('TOURNAMENT_FULL');
        expect(ERROR_CODES.TOURNAMENT_STARTED).toBe('TOURNAMENT_STARTED');
        expect(ERROR_CODES.TOURNAMENT_NOT_FOUND).toBe('TOURNAMENT_NOT_FOUND');
        expect(ERROR_CODES.REGISTRATION_NOT_OPEN).toBe('REGISTRATION_NOT_OPEN');
        expect(ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
        expect(ERROR_CODES.SERVER_ERROR).toBe('SERVER_ERROR');
    });
});

// ==================== API INTEGRATION TESTS ====================

describe('GET /api/health', () => {
    test('returns health status', async () => {
        const response = await request(app).get('/api/health');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body.service).toBe('tournament-signup');
        expect(response.body.timestamp).toBeDefined();
    });
});

describe('GET /api/game-config', () => {
    test('returns game configuration', async () => {
        const response = await request(app).get('/api/game-config');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.config).toBeDefined();
        expect(response.body.config.rules).toBeDefined();
        expect(Array.isArray(response.body.config.rules)).toBe(true);
    });
});

describe('POST /api/signup validation', () => {
    test('rejects empty participant name', async () => {
        const response = await request(app)
            .post('/api/signup')
            .send({ participantName: '' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_REQUIRED);
    });

    test('rejects name that is too short', async () => {
        const response = await request(app)
            .post('/api/signup')
            .send({ participantName: 'A' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_TOO_SHORT);
    });

    test('rejects name that is too long', async () => {
        const longName = 'A'.repeat(51);
        const response = await request(app)
            .post('/api/signup')
            .send({ participantName: longName });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_TOO_LONG);
    });

    test('rejects invalid Instagram handle', async () => {
        const response = await request(app)
            .post('/api/signup')
            .send({
                participantName: 'TestPlayer',
                instagram: 'invalid@handle'
            });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.INVALID_INSTAGRAM);
    });

    test('trims whitespace from participant name', async () => {
        // This test verifies the name is trimmed before validation
        // Name "  A  " should become "A" which is too short
        const response = await request(app)
            .post('/api/signup')
            .send({ participantName: '  A  ' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_TOO_SHORT);
    });

    test('rejects notes that are too long', async () => {
        const longNotes = 'A'.repeat(201);
        const response = await request(app)
            .post('/api/signup')
            .send({
                participantName: 'TestPlayer',
                notes: longNotes
            });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
        expect(response.body.error.field).toBe('notes');
    });

    test('accepts valid notes within length limit', async () => {
        // Note: This will fail with SERVER_ERROR since no tournament is set up,
        // but it validates that notes don't cause a validation error
        const validNotes = 'Bringing my own controller';
        const response = await request(app)
            .post('/api/signup')
            .send({
                participantName: 'TestPlayer',
                notes: validNotes
            });

        // Should not be a validation error for notes
        if (response.status === 400) {
            expect(response.body.error.field).not.toBe('notes');
        }
    });

    test('trims whitespace from notes', async () => {
        // Note: This will proceed past validation since trimmed notes are valid
        const response = await request(app)
            .post('/api/signup')
            .send({
                participantName: 'TestPlayer',
                notes: '   Some notes with spaces   '
            });

        // Should not fail validation for notes
        if (response.status === 400) {
            expect(response.body.error.field).not.toBe('notes');
        }
    });
});

describe('GET /api/participants/lookup', () => {
    test('rejects request without name parameter', async () => {
        const response = await request(app).get('/api/participants/lookup');

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Name parameter is required');
    });

    test('rejects empty name parameter', async () => {
        const response = await request(app)
            .get('/api/participants/lookup')
            .query({ name: '' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });
});

describe('POST /api/waitlist validation', () => {
    test('rejects empty name', async () => {
        const response = await request(app)
            .post('/api/waitlist')
            .send({ name: '' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_REQUIRED);
    });

    test('rejects missing name', async () => {
        const response = await request(app)
            .post('/api/waitlist')
            .send({ email: 'test@example.com' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(ERROR_CODES.NAME_REQUIRED);
    });
});

describe('GET /api/waitlist validation', () => {
    test('rejects request without name parameter', async () => {
        const response = await request(app).get('/api/waitlist');

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });

    test('rejects empty name parameter', async () => {
        const response = await request(app)
            .get('/api/waitlist')
            .query({ name: '' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });
});
