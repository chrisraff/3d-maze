'use strict';

// The cache name should be updated any time the cached files change
const CACHE_NAME = 'static-cache-v23';
const THIRD_PARTY_CACHE = 'third-party-cache-v6';

const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/js/game.js',
    '/js/maze/maze.js',
    '/js/input/controls.js',
    '/js/state/storage.js',
    '/js/input/detectmobilebrowser.js',
    '/js/render/THREE.MeshLine.js',
    '/js/ui/compassManager.js',
    '/js/render/sampleUniformSphere.js',
    '/js/render/dust.js',
    '/js/ui/MenuManager.js',
    '/js/render/trail.js',
    '/js/vr/VRButtonManager.js',
    '/js/ui/goalDots.js',
    '/js/ui/TutorialManager.js',
    '/js/vr/VRManager.js',
    '/js/breadcrumbs/BreadcrumbManager.js',
    '/js/breadcrumbs/breadcrumbHue.js',
    '/js/input/TouchArbiter.js',
    '/js/input/TouchJoystick.js',
    '/js/maze/checkCollisionOnAxis.js',
    '/js/maze/PlayerCollider.js',
    '/js/state/EventBus.js',
    '/js/state/analytics.js',
    '/js/state/GameSession.js',
    '/js/state/RunHistory.js',
    '/js/maze/MazeWorld.js',
    '/js/state/Settings.js',
    '/js/state/mazeOptions.js',
    '/js/state/markerFacing.js',
    '/js/decor/scenery.js',
    '/js/decor/sceneryClaims.js',
    '/js/decor/sceneryBudget.js',
    '/js/decor/branchSites.js',
    '/js/maze/mazeQuery.js',
    '/js/maze/mazeNexus.js',
    '/js/decor/DripsDecor.js',
    '/js/decor/LatticeStudsDecor.js',
    '/js/decor/SplotchesDecor.js',
    '/js/decor/SkylineDecor.js',
    '/js/decor/CircuitDecor.js',
    '/js/decor/MosaicDecor.js',
    '/js/decor/PipesDecor.js',
    '/js/breadcrumbs/BreadcrumbBaseDecor.js',
    '/js/breadcrumbs/BreadcrumbPlacementCue.js',
    '/js/render/glowMaterial.js',
    '/js/MazeIntroCinematic.js',
    '/js/ui/IconRenderer.js',
    '/js/ui/GoalDotIcon.js',
    '/js/breadcrumbs/BreadcrumbIcon.js',
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
