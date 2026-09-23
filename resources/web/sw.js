/* eslint-disable */

const BUILD_VERSION = '3ed1457c6001'
const CACHE_NAME = 'chatai-assets-' + BUILD_VERSION
const BASE = '/chatai'
const PRECACHE = [
    "/chatai/_next/static/chunks/1cbccc39b319e66a.js",
    "/chatai/_next/static/chunks/1de6a45627b906d0.js",
    "/chatai/_next/static/chunks/2859f476bcae8cb4.js",
    "/chatai/_next/static/chunks/3365a731e1703f0c.js",
    "/chatai/_next/static/chunks/385a773366f255d8.js",
    "/chatai/_next/static/chunks/3bd2124b8d9ee298.js",
    "/chatai/_next/static/chunks/3da0694bd9a318a7.js",
    "/chatai/_next/static/chunks/3f1b44f91f087274.js",
    "/chatai/_next/static/chunks/49c18f8b59454c9c.js",
    "/chatai/_next/static/chunks/5360380437a526d4.js",
    "/chatai/_next/static/chunks/5601c55d3f433fb5.js",
    "/chatai/_next/static/chunks/561ade5a53de9983.js",
    "/chatai/_next/static/chunks/565910b1126e4102.js",
    "/chatai/_next/static/chunks/5928a4ead036b4d4.js",
    "/chatai/_next/static/chunks/59dc0458b01adbb4.js",
    "/chatai/_next/static/chunks/5a477585a9172e32.js",
    "/chatai/_next/static/chunks/5ac6523a1e84b470.js",
    "/chatai/_next/static/chunks/5f5dc4b91b5fa8cb.js",
    "/chatai/_next/static/chunks/605036bceda22f7e.js",
    "/chatai/_next/static/chunks/626c285c6c3817a8.js",
    "/chatai/_next/static/chunks/6283992fb1af450c.js",
    "/chatai/_next/static/chunks/664554ed729e29d1.js",
    "/chatai/_next/static/chunks/680b44981a701c96.js",
    "/chatai/_next/static/chunks/6d7fc8be57303293.js",
    "/chatai/_next/static/chunks/6eedc3d04ad97761.js",
    "/chatai/_next/static/chunks/70a46ec71ad97ee4.js",
    "/chatai/_next/static/chunks/74fd1dedd7163973.js",
    "/chatai/_next/static/chunks/7be36e6ca4e90dfa.js",
    "/chatai/_next/static/chunks/7d9c0e5cf15ff6b1.js",
    "/chatai/_next/static/chunks/8684f1dab52aa687.js",
    "/chatai/_next/static/chunks/8958d6cd78042dbf.js",
    "/chatai/_next/static/chunks/8dd8e80754cf6ace.js",
    "/chatai/_next/static/chunks/8f173180f7aef5c2.js",
    "/chatai/_next/static/chunks/920ddcad96e11999.css",
    "/chatai/_next/static/chunks/98a47abd9ae06c90.js",
    "/chatai/_next/static/chunks/9b2c5451f0b67975.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js.map",
    "/chatai/_next/static/chunks/aab32bf8401d8230.js",
    "/chatai/_next/static/chunks/aac8ad9cc54a691c.js",
    "/chatai/_next/static/chunks/af1264b170dd3b20.js",
    "/chatai/_next/static/chunks/b02c749caf088e45.js",
    "/chatai/_next/static/chunks/ba9ccc7bcdd48e75.js",
    "/chatai/_next/static/chunks/baf7dc3d204fed26.js",
    "/chatai/_next/static/chunks/bd7e4b9e3aa192a7.js",
    "/chatai/_next/static/chunks/c06955e2755ede11.js",
    "/chatai/_next/static/chunks/c2fba871b679a3d4.js",
    "/chatai/_next/static/chunks/c476a887dc6cc71d.js",
    "/chatai/_next/static/chunks/c681471dc3472481.js",
    "/chatai/_next/static/chunks/c9a74f9e3207860b.js",
    "/chatai/_next/static/chunks/c9c5c1b0c522ce56.css",
    "/chatai/_next/static/chunks/cab3acaad70cfbe5.js",
    "/chatai/_next/static/chunks/cc75bd3718d4b850.js",
    "/chatai/_next/static/chunks/d1800f46f072bd73.js",
    "/chatai/_next/static/chunks/d434cc25d150bf3e.js",
    "/chatai/_next/static/chunks/d4edc9cb04363b93.js",
    "/chatai/_next/static/chunks/d5d8c8c785200296.js",
    "/chatai/_next/static/chunks/d7d7e238f8cdc451.js",
    "/chatai/_next/static/chunks/d93b9117fb66b228.js",
    "/chatai/_next/static/chunks/e22f627f748fbac3.js",
    "/chatai/_next/static/chunks/e80d4a48e71d8e12.js",
    "/chatai/_next/static/chunks/e8e35a80c6d71978.js",
    "/chatai/_next/static/chunks/f3807185e2d607e6.js",
    "/chatai/_next/static/chunks/f395d4077dbc6386.js",
    "/chatai/_next/static/chunks/f4930e62852e0ba5.js",
    "/chatai/_next/static/chunks/fb1c05d6491fbd81.js",
    "/chatai/_next/static/chunks/fb8bbad83c699e17.js",
    "/chatai/_next/static/chunks/fe1d7cc77c315304.js",
    "/chatai/_next/static/chunks/fef25a02b5243842.js",
    "/chatai/_next/static/chunks/ff1a16fafef87110.js",
    "/chatai/_next/static/chunks/turbopack-116fa6931d85daf2.js",
    "/chatai/_next/static/media/favicon.0b3bf435.ico",
    "/chatai/_next/static/wz9GYsHLehI8x9mLVhvxV/_buildManifest.js",
    "/chatai/_next/static/wz9GYsHLehI8x9mLVhvxV/_clientMiddlewareManifest.json",
    "/chatai/_next/static/wz9GYsHLehI8x9mLVhvxV/_ssgManifest.js",
    "/chatai/favicon.ico",
    "/chatai/file.svg",
    "/chatai/globe.svg",
    "/chatai/next.svg",
    "/chatai/vercel.svg",
    "/chatai/window.svg"
]
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key.startsWith('chatai-assets-') && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    )
})

function isAppRequest(request) {
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return false
    return url.pathname === BASE || url.pathname.startsWith(BASE + '/')
}

function isHtmlRequest(request) {
    const url = new URL(request.url)
    return (
        request.mode === 'navigate' ||
        url.pathname.endsWith('.html') ||
        (request.headers.get('accept') || '').includes('text/html')
    )
}

function isApiRequest(request) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(BASE + '/')) return false
    return url.pathname.startsWith(BASE + '/api/') || request.headers.get('x-requested-with') === 'XMLHttpRequest'
}

/**
 * 判断请求路径是否为可预缓存的静态资源。可预缓存资源 cache-first,命中即离线可读。
 * @param {string} urlPathname - 请求路径
 * @returns {boolean} 是否为可预缓存的静态资源
 */
function isCacheableAsset(urlPathname) {
    return urlPathname.startsWith(BASE + '/_next/') || urlPathname.endsWith('.ico') ||
        urlPathname.endsWith('.png') || urlPathname.endsWith('.svg')
}

self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)
    if (url.pathname === BASE + '/' + 'sw.js') return
    if (request.method !== 'GET' || !isAppRequest(request)) return
    if (isApiRequest(request)) return
    if (isCacheableAsset(url.pathname)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached
                return fetch(request).then(response => {
                    if (response && response.ok) {
                        const copy = response.clone()
                        void caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
                    }
                    return response
                })
            })
        )
        return
    }
    const cacheUpdate = response => {
        if (response && response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
    }

    if (isHtmlRequest(request)) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    cacheUpdate(response)
                    return response
                })
                .catch(() =>
                    caches
                        .match(request)
                        .then(cached => cached || caches.match(BASE + '/'))
                        .then(cached => cached || Response.error())
                )
        )
        return
    }
    event.respondWith(
        fetch(request)
            .then(response => {
                cacheUpdate(response)
                return response
            })
            .catch(() =>
                caches.match(BASE + '/').then(fallback => fallback || Response.error())
            )
    )
})
