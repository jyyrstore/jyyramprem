(function(){
  const LOGO='https://i.ibb.co.com/YFKtw7Pk/LOGO-PROFIL.png';
  const BRAND='https://i.ibb.co.com/1GwwBB5W/LOGO-NAMA.png';
  const BANNER='https://uploadin.web.id/f/jyybanner.mp4';
  const DONATE='https://sociabuzz.com/ajirhs/tribe';
  const socials=[
    ['TikTok','https://www.tiktok.com/@jyyr26','https://cdn-icons-png.flaticon.com/512/3046/3046121.png'],
    ['Instagram','https://instagram.com/jyy_rsh','https://cdn-icons-png.flaticon.com/512/2111/2111463.png'],
    ['WhatsApp','https://whatsapp.com/channel/0029VbCH7C0E50Uid8KYwG1f','https://cdn-icons-png.flaticon.com/512/733/733585.png'],
    ['Telegram','https://t.me/JyyR_Mentahan','https://cdn-icons-png.flaticon.com/512/2111/2111646.png']
  ];
  const q=s=>document.querySelector(s);
  function userName(user){return user?.user_metadata?.username||user?.user_metadata?.nickname||user?.email?.split('@')[0]||'User'}
  async function session(){return window.AMAuth?.getSession()||null}
  async function init(){
    const s=await session(); if(!s){location.replace('/login.html');return null}
    const user=s.user || await window.AMAuth.getUser();
    document.querySelectorAll('[data-user-name]').forEach(e=>e.textContent=userName(user));
    document.querySelectorAll('[data-user-email]').forEach(e=>e.textContent=user?.email||'-');
    const avatar=q('[data-user-avatar]'); if(avatar) avatar.src=LOGO;
    const backend=q('#backendPill'); const backendIcon=q('#backendIcon'); const backendLabel=q('#backendLabel');
    const popupState=q('#popupBackendState'); const health=q('#healthStatus');
    function applyBackendState(online){
      const label=online?'Backend On':'Backend Off';
      if(backendIcon) backendIcon.src=online?'/assets/Icon/Backend-Online.png':'/assets/Icon/Backend-ofline.png';
      if(backendLabel) backendLabel.textContent=label;
      if(backend){
        backend.classList.toggle('online',online);
        backend.classList.toggle('offline',!online);
        backend.title=online?'Backend aktif':'Backend offline';
        backend.setAttribute('aria-label',label);
      }
      if(popupState){
        popupState.classList.toggle('offline',!online);
        popupState.innerHTML=`<span class="state-dot"></span> ${label}`;
      }
      if(health){health.textContent=online?'Online':'Offline';health.className=`badge ${online?'green':'red'}`;}
    }
    async function healthCheck(){
      try{const r=await fetch('/api/health',{cache:'no-store'});const d=await r.json();applyBackendState(r.ok&&d.ok);}
      catch{applyBackendState(false);}
    }
    q('#settingsBtn')?.addEventListener('click',()=>{
      const popup=q('#accountPopup');
      if(!popup)return;
      const open=!popup.classList.contains('show');
      popup.classList.toggle('show',open);
      q('#settingsBtn')?.setAttribute('aria-expanded',String(open));
      popup.setAttribute('aria-hidden',String(!open));
    });
    q('#closePopup')?.addEventListener('click',()=>{
      const popup=q('#accountPopup');
      popup?.classList.remove('show');
      q('#settingsBtn')?.setAttribute('aria-expanded','false');
      popup?.setAttribute('aria-hidden','true');
    });
    document.addEventListener('click',e=>{
      const p=q('#accountPopup');
      if(p?.classList.contains('show')&&!p.contains(e.target)&&!q('#settingsBtn')?.contains(e.target)){
        p.classList.remove('show');
        q('#settingsBtn')?.setAttribute('aria-expanded','false');
        p.setAttribute('aria-hidden','true');
      }
    });
    q('#logoutAction')?.addEventListener('click',async()=>{await window.AMAuth.signOut();location.replace('/login.html')});
    q('#donateAction')?.addEventListener('click',()=>window.open(DONATE,'_blank','noopener,noreferrer'));
    q('#refreshPage')?.addEventListener('click',()=>location.reload());
    await healthCheck();
    setInterval(healthCheck,30000);
    return user;
  }
  function renderSocials(){const host=q('#socialLinks');if(!host)return;host.innerHTML=socials.map(([n,u,i])=>`<a class="social" href="${u}" target="_blank" rel="noopener noreferrer" aria-label="${n}"><img src="${i}" alt="${n}"></a>`).join('')}
  function setupBrandBanner(){
    const video=q('#brandBanner');
    if(!video || video.dataset.bannerReady==='1') return;

    video.dataset.bannerReady='1';
    video.autoplay=true;
    video.muted=true;
    video.defaultMuted=true;
    video.loop=true;
    video.playsInline=true;
    video.preload='metadata';

    const start=()=>{
      const attempt=video.play();
      if(attempt && typeof attempt.catch==='function') attempt.catch(()=>{});
    };

    video.addEventListener('loadeddata',start,{once:true});
    video.addEventListener('canplay',start,{once:true});
    video.addEventListener('playing',()=>{}, {once:true});

    video.src=BANNER;
    video.load();
    if(video.readyState>=2) start();
  }
  function renderShared(){
    document.querySelectorAll('[data-brand-logo]').forEach(e=>e.src=LOGO);
    document.querySelectorAll('[data-brand-name-logo]').forEach(e=>e.src=BRAND);
    setupBrandBanner();
    renderSocials();
    const currentPage=document.body.dataset.page||'';
    document.querySelectorAll('[data-nav]').forEach(a=>{const target=a.dataset.nav||''; const active=target===currentPage; a.classList.toggle('active',active); if(active){a.setAttribute('aria-current','page')}else{a.removeAttribute('aria-current')}});
  }
  window.JYYR={init,renderShared,userName,LOGO,BRAND,BANNER,DONATE};
  document.addEventListener('DOMContentLoaded',()=>{renderShared();init();});
})();
