/*!
 * BioCal · Service Worker
 * 策略：
 *   - 页面导航：network-first（保证拿到最新 HTML），离线回退缓存
 *   - 静态资源：stale-while-revalidate（秒开 + 后台更新）
 * 发布新版本时只需递增 VERSION，旧缓存会在 activate 阶段清理。
 */

'use strict';

const VERSION = 'v15';
const CACHE = 'chemcalc-' + VERSION;

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'calc.js',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map(function (url) {
      return new Request(url, { cache: 'reload' });
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(function (key) { return key !== CACHE; })
      .map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match('index.html')) ||
      Response.error();
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  const network = fetch(request)
    .then(async function (response) {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(function () { return null; });

  if (cached) {
    // 后台更新不阻塞本次响应，但要让浏览器保持 SW 存活
    event.waitUntil(network);
    return cached;
  }

  return (await network) || Response.error();
}
