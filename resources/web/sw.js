/* eslint-disable */

const BUILD_VERSION = 'a6b76c3b5763'
const CACHE_NAME = 'chatai-assets-' + BUILD_VERSION
const BASE = '/chatai'
const PRECACHE = [
    "/chatai/_next/static/_yAGrAeUpWzafpkQ_IeXA/_buildManifest.js",
    "/chatai/_next/static/_yAGrAeUpWzafpkQ_IeXA/_clientMiddlewareManifest.json",
    "/chatai/_next/static/_yAGrAeUpWzafpkQ_IeXA/_ssgManifest.js",
    "/chatai/_next/static/chunks/08c50fa76aa9b4fb.js",
    "/chatai/_next/static/chunks/0c5ed3ae3e630310.js",
    "/chatai/_next/static/chunks/0e9552a4f5da982b.js",
    "/chatai/_next/static/chunks/1503555e6312795e.js",
    "/chatai/_next/static/chunks/151c3947c823bddb.js",
    "/chatai/_next/static/chunks/18f67ae079fad45f.js",
    "/chatai/_next/static/chunks/1bf5b41e948cca11.js",
    "/chatai/_next/static/chunks/1cbccc39b319e66a.js",
    "/chatai/_next/static/chunks/1de514bf31388e6e.js",
    "/chatai/_next/static/chunks/1ecc3aa3a335dc27.js",
    "/chatai/_next/static/chunks/211a057a9f44822d.js",
    "/chatai/_next/static/chunks/250271728d2d959a.js",
    "/chatai/_next/static/chunks/2859f476bcae8cb4.js",
    "/chatai/_next/static/chunks/28af3cff079e4919.js",
    "/chatai/_next/static/chunks/2ab531ed1a00e36e.js",
    "/chatai/_next/static/chunks/34d1219374870213.js",
    "/chatai/_next/static/chunks/355bb872143ef3d1.js",
    "/chatai/_next/static/chunks/36bf899908015437.js",
    "/chatai/_next/static/chunks/375bbc7bec34379e.js",
    "/chatai/_next/static/chunks/3ee97f41e0627a77.js",
    "/chatai/_next/static/chunks/3f1a724c60cc37d9.js",
    "/chatai/_next/static/chunks/5147aa98213b7a37.js",
    "/chatai/_next/static/chunks/5716711855e6e33c.js",
    "/chatai/_next/static/chunks/5f05aac0e718da06.js",
    "/chatai/_next/static/chunks/5fdce2803ac44aec.js",
    "/chatai/_next/static/chunks/61cea0e84817836a.js",
    "/chatai/_next/static/chunks/63143f5aaed73e41.js",
    "/chatai/_next/static/chunks/63b77121fd018343.js",
    "/chatai/_next/static/chunks/647ad35edf429aa2.js",
    "/chatai/_next/static/chunks/6a3cd32935b7b832.js",
    "/chatai/_next/static/chunks/6d7fc8be57303293.js",
    "/chatai/_next/static/chunks/6eb13248133d59b4.js",
    "/chatai/_next/static/chunks/7be36e6ca4e90dfa.js",
    "/chatai/_next/static/chunks/7c771a45c0c2579f.js",
    "/chatai/_next/static/chunks/87fe6adc69d5a3a3.css",
    "/chatai/_next/static/chunks/8de848174c0eec17.js",
    "/chatai/_next/static/chunks/8fc1bb4ca179bba9.js",
    "/chatai/_next/static/chunks/902d01a8c4d34ece.js",
    "/chatai/_next/static/chunks/90cb6a09b09abc64.js",
    "/chatai/_next/static/chunks/910b6abe6aa1aa4a.js",
    "/chatai/_next/static/chunks/920ddcad96e11999.css",
    "/chatai/_next/static/chunks/975d596a52cde54a.js",
    "/chatai/_next/static/chunks/9b2c5451f0b67975.js",
    "/chatai/_next/static/chunks/9f46749ac97b863a.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js.map",
    "/chatai/_next/static/chunks/af1264b170dd3b20.js",
    "/chatai/_next/static/chunks/b203e5254519a3e8.js",
    "/chatai/_next/static/chunks/b633746c61f97021.js",
    "/chatai/_next/static/chunks/b9683c2050736825.js",
    "/chatai/_next/static/chunks/bc47e5b5617f8433.js",
    "/chatai/_next/static/chunks/bf728d22cf07951e.js",
    "/chatai/_next/static/chunks/c058d8a3eabc7149.js",
    "/chatai/_next/static/chunks/c37377ce197afcd2.js",
    "/chatai/_next/static/chunks/c476a887dc6cc71d.js",
    "/chatai/_next/static/chunks/c4f2d8b57682f633.js",
    "/chatai/_next/static/chunks/c80f5a16fd56b6cf.js",
    "/chatai/_next/static/chunks/d0d03ea8bce14dee.js",
    "/chatai/_next/static/chunks/d1800f46f072bd73.js",
    "/chatai/_next/static/chunks/d197ba225e9386d8.js",
    "/chatai/_next/static/chunks/d19e0b5de21468ba.js",
    "/chatai/_next/static/chunks/d742f3e813296f40.js",
    "/chatai/_next/static/chunks/d8631884e1cdeac7.js",
    "/chatai/_next/static/chunks/d94e460bdfa8b197.js",
    "/chatai/_next/static/chunks/e1d4530e3a3a51d6.js",
    "/chatai/_next/static/chunks/e22f627f748fbac3.js",
    "/chatai/_next/static/chunks/f1ab86f6205d9b07.js",
    "/chatai/_next/static/chunks/f2b9bd3d7dd29b78.js",
    "/chatai/_next/static/chunks/ff1a16fafef87110.js",
    "/chatai/_next/static/chunks/ffc6f60fe91ac0a9.js",
    "/chatai/_next/static/chunks/turbopack-6f7fb830c500f7c9.js",
    "/chatai/_next/static/media/favicon.0b3bf435.ico",
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
