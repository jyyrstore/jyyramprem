const CACHE_NAME='jyy-r-amprem-app-v4';
const APP_SHELL=[
  '/',
  '/index.html',
  '/manifest.webmanifest',
  "/assets/Foto/Jyy'R_PROFIL.png",
  '/assets/Foto/app_icon.png',
  '/assets/Icon/jyyr-amprem-icon-192.png',
  '/assets/Icon/jyyr-amprem-icon-512.png',
  '/assets/Font/jyyramprem.ttf',
  '/css/common.css',
  '/css/uiux-final.css',
  '/css/login.css',
  '/css/home.css',
  '/css/dashboard.css',
  '/css/setting.css',
  '/css/owner.css',
  '/css/help.css',
  '/css/reset-password.css',
  '/css/app-center.css',
  '/js/auth-client.js',
  '/js/auth.js',
  '/js/home.js',
  '/js/dashboard.js',
  '/js/setting.js',
  '/js/help.js',
  '/js/reset-password.js',
  '/js/icons.js',
  '/js/ui-icons-assets.js',
  '/js/notifications.js',
  '/js/nav.js',
  '/js/apk-metadata.js',
  '/js/owner/core.js',
  '/js/owner/members.js',
  '/js/owner/portal-token.js',
  '/js/owner/dashboard.js',
  '/js/owner/broadcasts.js',
  '/js/owner/messaging.js',
  '/js/owner/content.js',
  '/js/owner/events.js',
  '/js/owner/releases.js',
  '/js/owner.js',
  '/js/ui-protection.js',
  '/js/app-center.js',
  '/js/app-runtime.js'
];

const APP_SHELL_SET=new Set(APP_SHELL);

self.addEventListener('install',(event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache)=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',(event)=>{
  event.waitUntil(
    caches.keys()
      .then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',(event)=>{
  const request=event.request;
  if(request.method!=='GET') return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  // Navigation stays network-first so updated HTML is always preferred.
  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request).catch(()=>caches.match('/'))
    );
    return;
  }

  // Only explicit app-shell assets are cacheable. Dynamic JS/CSS/HTML such as
  // setting.js must always come from the current deployment/source, preventing
  // stale feature code from being served by an old service-worker cache.
  if(APP_SHELL_SET.has(url.pathname)){
    event.respondWith(
      fetch(request)
        .then((response)=>{
          if(response.ok){
            const clone=response.clone();
            caches.open(CACHE_NAME).then((cache)=>cache.put(request,clone));
          }
          return response;
        })
        .catch(()=>caches.match(request))
    );
  }
});
