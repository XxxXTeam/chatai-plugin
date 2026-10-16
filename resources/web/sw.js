/* eslint-disable */

const BUILD_VERSION = 'adff9fe8616c'
const CACHE_NAME = 'chatai-assets-' + BUILD_VERSION
const BASE = '/chatai'
const PRECACHE = [
    "/chatai/_next/static/chunks/00fbcb1bf2017dcb.js",
    "/chatai/_next/static/chunks/02454b8be76c511a.js",
    "/chatai/_next/static/chunks/09ef38215fb3a0dc.js",
    "/chatai/_next/static/chunks/0d28ad2475c6bba9.js",
    "/chatai/_next/static/chunks/11cd05fcc2b6f01f.js",
    "/chatai/_next/static/chunks/18f67ae079fad45f.js",
    "/chatai/_next/static/chunks/1a0ffe0ed659bfc2.js",
    "/chatai/_next/static/chunks/1cbccc39b319e66a.js",
    "/chatai/_next/static/chunks/1fd6208bb729bcab.css",
    "/chatai/_next/static/chunks/250271728d2d959a.js",
    "/chatai/_next/static/chunks/2859f476bcae8cb4.js",
    "/chatai/_next/static/chunks/3365a731e1703f0c.js",
    "/chatai/_next/static/chunks/33cd15fe2021862b.js",
    "/chatai/_next/static/chunks/36bf899908015437.js",
    "/chatai/_next/static/chunks/375bbc7bec34379e.js",
    "/chatai/_next/static/chunks/3cfc945ce9b50881.js",
    "/chatai/_next/static/chunks/4390b240c9480e87.js",
    "/chatai/_next/static/chunks/59dc0458b01adbb4.js",
    "/chatai/_next/static/chunks/5c43c88de28f4e54.js",
    "/chatai/_next/static/chunks/5dfbd1d73aa099b3.js",
    "/chatai/_next/static/chunks/602b75ce7a69a1d7.js",
    "/chatai/_next/static/chunks/615074f2bacb9c2a.js",
    "/chatai/_next/static/chunks/664554ed729e29d1.js",
    "/chatai/_next/static/chunks/6a7dc2ad3fe2d898.js",
    "/chatai/_next/static/chunks/6d7fc8be57303293.js",
    "/chatai/_next/static/chunks/6eb13248133d59b4.js",
    "/chatai/_next/static/chunks/7be36e6ca4e90dfa.js",
    "/chatai/_next/static/chunks/7d6ec547e5681060.js",
    "/chatai/_next/static/chunks/8c7ba8a2f8dd2069.js",
    "/chatai/_next/static/chunks/8f8b3d5442df477b.js",
    "/chatai/_next/static/chunks/8fc1bb4ca179bba9.js",
    "/chatai/_next/static/chunks/902d01a8c4d34ece.js",
    "/chatai/_next/static/chunks/90cb6a09b09abc64.js",
    "/chatai/_next/static/chunks/920ddcad96e11999.css",
    "/chatai/_next/static/chunks/9b2c5451f0b67975.js",
    "/chatai/_next/static/chunks/9dbd38bea865cfc4.js",
    "/chatai/_next/static/chunks/9e2f1a4f5728f013.js",
    "/chatai/_next/static/chunks/a1a2df73fd9c32c0.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js.map",
    "/chatai/_next/static/chunks/af1264b170dd3b20.js",
    "/chatai/_next/static/chunks/b02c749caf088e45.js",
    "/chatai/_next/static/chunks/b203e5254519a3e8.js",
    "/chatai/_next/static/chunks/b42315604801a1f7.js",
    "/chatai/_next/static/chunks/b5a5d4d086b49c8e.js",
    "/chatai/_next/static/chunks/bd7e4b9e3aa192a7.js",
    "/chatai/_next/static/chunks/bda8e1e0334de360.js",
    "/chatai/_next/static/chunks/bfb3fe62b595528a.js",
    "/chatai/_next/static/chunks/c476a887dc6cc71d.js",
    "/chatai/_next/static/chunks/c80f5a16fd56b6cf.js",
    "/chatai/_next/static/chunks/cab3acaad70cfbe5.js",
    "/chatai/_next/static/chunks/cbc70aad74e394c1.js",
    "/chatai/_next/static/chunks/d0759a6af9d16f72.js",
    "/chatai/_next/static/chunks/d1800f46f072bd73.js",
    "/chatai/_next/static/chunks/d3918d3920394e7b.js",
    "/chatai/_next/static/chunks/d434cc25d150bf3e.js",
    "/chatai/_next/static/chunks/d4475ade747eb766.js",
    "/chatai/_next/static/chunks/d8631884e1cdeac7.js",
    "/chatai/_next/static/chunks/e1d4530e3a3a51d6.js",
    "/chatai/_next/static/chunks/e22f627f748fbac3.js",
    "/chatai/_next/static/chunks/e34f1471fea685cf.js",
    "/chatai/_next/static/chunks/e4a44689d2601248.js",
    "/chatai/_next/static/chunks/e4acc296f3f56d0c.js",
    "/chatai/_next/static/chunks/f0312924f60c26ea.js",
    "/chatai/_next/static/chunks/f4e83d87cf284a91.js",
    "/chatai/_next/static/chunks/f77677b4e0c1d981.js",
    "/chatai/_next/static/chunks/fb8bbad83c699e17.js",
    "/chatai/_next/static/chunks/fce408ba9f23929a.js",
    "/chatai/_next/static/chunks/ff1a16fafef87110.js",
    "/chatai/_next/static/chunks/ffc6f60fe91ac0a9.js",
    "/chatai/_next/static/chunks/turbopack-6f7fb830c500f7c9.js",
    "/chatai/_next/static/media/favicon.0b3bf435.ico",
    "/chatai/_next/static/qUD4JWr5hpl4yk9SJ9dw_/_buildManifest.js",
    "/chatai/_next/static/qUD4JWr5hpl4yk9SJ9dw_/_clientMiddlewareManifest.json",
    "/chatai/_next/static/qUD4JWr5hpl4yk9SJ9dw_/_ssgManifest.js",
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
