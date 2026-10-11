/* eslint-disable */

const BUILD_VERSION = 'd742b69bc29e'
const CACHE_NAME = 'chatai-assets-' + BUILD_VERSION
const BASE = '/chatai'
const PRECACHE = [
    "/chatai/_next/static/ECS2zcGmVet3n5Sb_AAN0/_buildManifest.js",
    "/chatai/_next/static/ECS2zcGmVet3n5Sb_AAN0/_clientMiddlewareManifest.json",
    "/chatai/_next/static/ECS2zcGmVet3n5Sb_AAN0/_ssgManifest.js",
    "/chatai/_next/static/chunks/02454b8be76c511a.js",
    "/chatai/_next/static/chunks/03be4d689ff431f0.js",
    "/chatai/_next/static/chunks/1654321341345cb5.js",
    "/chatai/_next/static/chunks/17d2d2d8b109c29f.js",
    "/chatai/_next/static/chunks/1bb405c8e9d78422.js",
    "/chatai/_next/static/chunks/1cbccc39b319e66a.js",
    "/chatai/_next/static/chunks/1fd6208bb729bcab.css",
    "/chatai/_next/static/chunks/2859f476bcae8cb4.js",
    "/chatai/_next/static/chunks/3365a731e1703f0c.js",
    "/chatai/_next/static/chunks/375bbc7bec34379e.js",
    "/chatai/_next/static/chunks/391971540d079569.js",
    "/chatai/_next/static/chunks/3b9e6b1ee52dcf05.js",
    "/chatai/_next/static/chunks/3cfc945ce9b50881.js",
    "/chatai/_next/static/chunks/47a62dc1e5db60c4.js",
    "/chatai/_next/static/chunks/4ef554a12e380171.js",
    "/chatai/_next/static/chunks/50b33da6d3702276.js",
    "/chatai/_next/static/chunks/51c012be8916aeb2.js",
    "/chatai/_next/static/chunks/52e9f854f69b847d.js",
    "/chatai/_next/static/chunks/59dc0458b01adbb4.js",
    "/chatai/_next/static/chunks/5a477585a9172e32.js",
    "/chatai/_next/static/chunks/5b673c60b8ffa8b1.js",
    "/chatai/_next/static/chunks/605036bceda22f7e.js",
    "/chatai/_next/static/chunks/664554ed729e29d1.js",
    "/chatai/_next/static/chunks/6d7fc8be57303293.js",
    "/chatai/_next/static/chunks/6eedc3d04ad97761.js",
    "/chatai/_next/static/chunks/70d45e9aba1f0248.js",
    "/chatai/_next/static/chunks/74fd1dedd7163973.js",
    "/chatai/_next/static/chunks/767ae3dd85457a06.js",
    "/chatai/_next/static/chunks/779a421c4df215de.js",
    "/chatai/_next/static/chunks/7be36e6ca4e90dfa.js",
    "/chatai/_next/static/chunks/8684f1dab52aa687.js",
    "/chatai/_next/static/chunks/8fc1bb4ca179bba9.js",
    "/chatai/_next/static/chunks/920ddcad96e11999.css",
    "/chatai/_next/static/chunks/94d0f55d154f6085.js",
    "/chatai/_next/static/chunks/97d1731ff7d1a26f.js",
    "/chatai/_next/static/chunks/9a40cb43d7b5f307.js",
    "/chatai/_next/static/chunks/9b2c5451f0b67975.js",
    "/chatai/_next/static/chunks/9dbd38bea865cfc4.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js",
    "/chatai/_next/static/chunks/a6dad97d9634a72d.js.map",
    "/chatai/_next/static/chunks/aac8ad9cc54a691c.js",
    "/chatai/_next/static/chunks/af1264b170dd3b20.js",
    "/chatai/_next/static/chunks/b02622a1fef64c53.js",
    "/chatai/_next/static/chunks/b02c749caf088e45.js",
    "/chatai/_next/static/chunks/b9ad00f8bab09db1.js",
    "/chatai/_next/static/chunks/bd7e4b9e3aa192a7.js",
    "/chatai/_next/static/chunks/c476a887dc6cc71d.js",
    "/chatai/_next/static/chunks/c809238e3eb20aa2.js",
    "/chatai/_next/static/chunks/c9a74f9e3207860b.js",
    "/chatai/_next/static/chunks/cab3acaad70cfbe5.js",
    "/chatai/_next/static/chunks/ceedc8cc7bc46ba6.js",
    "/chatai/_next/static/chunks/cf0be635f12b9b63.js",
    "/chatai/_next/static/chunks/d1800f46f072bd73.js",
    "/chatai/_next/static/chunks/d434cc25d150bf3e.js",
    "/chatai/_next/static/chunks/d7d7e238f8cdc451.js",
    "/chatai/_next/static/chunks/d8631884e1cdeac7.js",
    "/chatai/_next/static/chunks/d93b9117fb66b228.js",
    "/chatai/_next/static/chunks/e22f627f748fbac3.js",
    "/chatai/_next/static/chunks/ea243f95cb4105fa.js",
    "/chatai/_next/static/chunks/ef5aa683763fff3f.js",
    "/chatai/_next/static/chunks/f0312924f60c26ea.js",
    "/chatai/_next/static/chunks/f327c969a27ef65a.js",
    "/chatai/_next/static/chunks/f3807185e2d607e6.js",
    "/chatai/_next/static/chunks/f4930e62852e0ba5.js",
    "/chatai/_next/static/chunks/f4e83d87cf284a91.js",
    "/chatai/_next/static/chunks/fb8bbad83c699e17.js",
    "/chatai/_next/static/chunks/fce408ba9f23929a.js",
    "/chatai/_next/static/chunks/fe1d7cc77c315304.js",
    "/chatai/_next/static/chunks/fef25a02b5243842.js",
    "/chatai/_next/static/chunks/ff1a16fafef87110.js",
    "/chatai/_next/static/chunks/turbopack-116fa6931d85daf2.js",
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
