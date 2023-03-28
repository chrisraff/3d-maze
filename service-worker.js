'use strict';

// The cache name should be updated any time the cached files change
const CACHE_NAME = 'static-cache-v14';
const THIRD_PARTY_CACHE = 'third-party-cache-v4';

const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/js/game.js',
    '/js/maze.js',
    '/js/controls.js',
    '/js/storage.js',
    '/js/detectmobilebrowser.js',
    '/js/THREE.MeshLine.js',
    '/models/wall.glb',
    '/models/arrow.glb',
    '/textures/dot.png',
];
const RESOURCES_TO_CACHE = [
    'https://unpkg.com/three@0.127.0/build/three.module.js',
    'https://unpkg.com/three@0.127.0/examples/jsm/loaders/GLTFLoader.js',
]

self.addEventListener('install', (evt) => {
    console.log('[ServiceWorker] Install');
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Pre-caching pages for offline');
            return cache.addAll(FILES_TO_CACHE);
        })
    );
    evt.waitUntil(
        caches.open(THIRD_PARTY_CACHE).then((cache) => {
            console.log('[ServiceWorker] Pre-caching external pages for offline');
            RESOURCES_TO_CACHE.forEach((url) => {
                fetch(url)
                    .then((response) => {
                        // If the response was good, clone it and store it in the cache.
                        if (response.status === 200) {
                            cache.put(url, response.clone());
                        } else {
                            return Promise.reject();
                        }
                    });
            });
            return Promise.resolve();
        })
    );

    self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  console.log('[ServiceWorker] Activate');

    evt.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME && key !== THIRD_PARTY_CACHE) {
                    console.log('[ServiceWorker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );

  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
    console.log('[ServiceWorker] Fetch', evt.request.url);
    evt.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(evt.request)
                .then((response) => {
                    return response || fetch(evt.request);
                });
        })
    );
});
