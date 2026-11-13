// Which way a placement aims a marker, as values: the modes, what a stored
// string coerces to, the key each context stores under, and the reverse the
// double gesture aims instead.
import { describe, it, expect } from 'vitest';
import {
    MARKER_FACING_CONTEXT_BY_KEY, MARKER_FACING_DEFAULT, MARKER_FACING_MODES,
    MARKER_FACING_STORAGE_KEYS, coerceMarkerFacing, markerFacingContext,
    reverseMarkerFacing,
} from '../js/state/markerFacing.js';

describe('modes', () => {
    it('offers the two the menu does, defaulting to pointing back at the player', () => {
        expect(MARKER_FACING_MODES).toEqual(['toward', 'away']);
        expect(MARKER_FACING_DEFAULT).toBe('toward');
    });

    it('stores a value per context under its own key, each resolving back', () => {
        expect(Object.keys(MARKER_FACING_STORAGE_KEYS)).toEqual(['screen', 'vr']);
        for (const [context, key] of Object.entries(MARKER_FACING_STORAGE_KEYS))
            expect(MARKER_FACING_CONTEXT_BY_KEY[key]).toBe(context);
    });

    // the two halves of one control have to edit a value each, which a shared
    // name would not let them do
    it('names the two keys differently', () => {
        expect(MARKER_FACING_STORAGE_KEYS.screen)
            .not.toBe(MARKER_FACING_STORAGE_KEYS.vr);
    });
});

describe('markerFacingContext', () => {
    it('is whichever context the player is playing through', () => {
        expect(markerFacingContext(true)).toBe('vr');
        expect(markerFacingContext(false)).toBe('screen');
    });
});

describe('coerceMarkerFacing', () => {
    it('keeps a value that is one of the modes', () => {
        for (const mode of MARKER_FACING_MODES)
            expect(coerceMarkerFacing(mode)).toBe(mode);
    });

    it('falls back to the default for anything else', () => {
        // nothing stored, a value left behind by an older build, a different
        // case, and a mode belonging to another setting
        for (const value of [undefined, null, '', 'Away', 'true', 'on'])
            expect(coerceMarkerFacing(value), String(value)).toBe(MARKER_FACING_DEFAULT);
    });
});

describe('reverseMarkerFacing', () => {
    it('is the other mode, so the double gesture is always a reversal', () => {
        expect(reverseMarkerFacing('toward')).toBe('away');
        expect(reverseMarkerFacing('away')).toBe('toward');
    });

    it('reverses the default for a value that is not a mode at all', () => {
        expect(reverseMarkerFacing('sideways')).toBe('away');
    });
});
