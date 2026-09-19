'use strict';

// The cache name should be updated any time the cached files change
const CACHE_NAME = 'static-cache-v22';
const THIRD_PARTY_CACHE = 'third-party-cache-v6';

const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/js/game.js',
    '/js/maze.js',
    '/js/controls.js',
    '/js/storage.js',
    '/js/detectmobilebrowser.js',
    '/js/THREE.MeshLine.js',
    '/js/compassManagager.js',
    '/js/sampleUniformSphere.js',
    '/js/dust.js',
    '/js/MenuManager.js',
    '/js/trail.js',
    '/js/VRButtonManager.js',
    '/js/goalDots.js',
    '/js/TutorialManager.js',
    '/js/VRManager.js',
    '/js/BreadcrumbManager.js',
    '/js/TouchArbiter.js',
    '/js/checkCollisionOnAxis.js',
    '/js/PlayerCollider.js',
    '/js/EventBus.js',
    '/js/analytics.js',
    '/js/GameSession.js',
    '/js/RunHistory.js',
    '/js/MazeWorld.js',
    '/js/Settings.js',
    '/js/BreadcrumbBaseDecor.js',
    '/js/glowMaterial.js',
    '/js/MazeIntroCinematic.js',
    '/js/IconRenderer.js',
    '/js/GoalDotIcon.js',
    '/js/BreadcrumbIcon.js',
    '/models/wall.glb',
    '/models/arrow.glb',
    '/models/pointer.glb',
    '/textures/dot.png',
];
const RESOURCES_TO_CACHE = [
    'https://unpkg.com/three@0.181.0/build/three.module.js',
    'https://unpkg.com/three@0.181.0/examples/jsm/loaders/GLTFLoader.js',
    'https://unpkg.com/es-module-shims@1.3.6/dist/es-module-shims.js',
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
