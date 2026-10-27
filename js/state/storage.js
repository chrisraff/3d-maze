const localStorage = window.localStorage;

function storageGetItem(key, defaultValue)
{
    if (localStorage == undefined)
        return defaultValue;

    var result = localStorage.getItem(key);
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

    return localStorage.setItem(key, value);
}

export {storageGetItem, storageSetItem}
