const CACHE_NAME='jyy-r-amprem-app-v3';
const APP_SHELL=[
  '/app-intro.html',
  '/home.html',
  '/manifest.webmanifest',
  "/assets/Foto/Jyy'R_PROFIL.png",
  '/assets/Icon/Download-App.png',
  '/assets/Font/jyyramprem.ttf',
  '/css/common.css',
  '/css/login.css',
  '/js/nav.js',
  '/js/ui-icons-assets.js',
  '/js/icons.js',
  '/js/auth-client.js'
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
      fetch(request).catch(()=>caches.match('/app-intro.html'))
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
