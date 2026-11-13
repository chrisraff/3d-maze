/**
 * localStorage, namespaced. The game shares an origin with the rest of the
 * site, so a setting goes in under STORAGE_PREFIX rather than claiming a bare
 * name of its own; callers pass the bare name and never see the prefix, which
 * is what lets a radio group's `name` go on doubling as its storage key.
 *
 * SHIPPED_BARE_KEYS went out before the prefix existed and stay bare, since a
 * rename reads as a player who has never played - the VR settings would snap
 * back to their defaults and the 30-day lapse would re-arm the intro. Nothing
 * added since has shipped, so there is no migration to carry.
 */
const STORAGE_PREFIX = '3dmaze-';

const SHIPPED_BARE_KEYS = new Set([
    'lastMazeCompletionDate',
    'vr-setting-movement',
    'vr-setting-rotation',
    'vr-setting-rotation-speed',
    'vr-setting-mirror',
]);

function storageKey(name)
{
    return SHIPPED_BARE_KEYS.has(name) ? name : STORAGE_PREFIX + name;
}

const localStorage = window.localStorage;

function storageGetItem(key, defaultValue)
{
    if (localStorage == undefined)
        return defaultValue;

    var result = localStorage.getItem(storageKey(key));
    if (result !== null)
    {
        return result;
    }
    return defaultValue;
}

function storageSetItem(key, value)
{
    if (localStorage == undefined)
        return;

    return localStorage.setItem(storageKey(key), value);
}

export {storageGetItem, storageSetItem, storageKey, STORAGE_PREFIX}
