const icon=(n)=>window.icon?.(n)||'';
[['refreshIcon','refresh'],['userAvatarIcon','user'],['homeIcon','home'],['logoutIcon','logout'],['deleteAccountIcon','trash'],['deleteAccountModalIcon','trash'],['navHome','home'],['navDashboard','dashboard'],['navSetting','settings']].forEach(([id,n])=>{const e=document.querySelector('#'+id);if(e)e.innerHTML=icon(n)});

let accounts=[];
const HISTORY_PAGE_SIZE=5;
let historyPage=1;
let accessStatusTimer=null;
let accessStatusData=null;
let accessStatusLastFocused=null;

function normalizeAccessPayload(data){
  const candidate=data?.tokenLifetime||data?.token_lifetime||null;
  if(!candidate||typeof candidate!=='object') return {owner:data?.owner===true, life:null};
  const durationMode=String(candidate.duration_mode??candidate.durationMode??'').trim().toLowerCase()||null;
  const accessExpiresAt=candidate.access_expires_at??candidate.accessExpiresAt??null;
  const status=String(candidate.status??'').trim().toLowerCase()||null;
  return {
    owner:data?.owner===true,
    access:data?.access===true,
    status:data?.status?String(data.status).trim().toLowerCase():null,
    life:{durationMode,accessExpiresAt,status,isPermanent:durationMode==='permanent'&&accessExpiresAt===null},
  };
}

function remainingParts(expiresAt, now=Date.now()){
  const expiry=Date.parse(expiresAt||'');
  if(!Number.isFinite(expiry)) return null;
  const diff=expiry-now;
  const safeDiff=Math.max(0,diff);
  const totalMinutes=Math.floor(safeDiff/60000);
  return {
    expired:diff<=0,
    days:Math.floor(totalMinutes/1440),
    hours:Math.floor((totalMinutes%1440)/60),
    minutes:totalMinutes%60,
    milliseconds:safeDiff,
  };
}

function toneForDays(days){
  if(days===null||days===undefined) return 'purple';
  if(days<=0) return 'expired';
  if(days<=5) return 'red';
  if(days<=10) return 'orange';
  if(days<=15) return 'blue';
  return 'green';
}

function formatExpiry(expiresAt){
  if(!expiresAt) return '—';
  const d=new Date(expiresAt);
  if(Number.isNaN(d.getTime())) return '—';
  const date=d.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
  const time=d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false});
  return `${date} · ${time}`;
}

function pad2(value){return String(value).padStart(2,'0')}

function setAccessTrigger(label,tone,disabled=false){
  const trigger=document.querySelector('#accessStatusTrigger');
  const labelEl=document.querySelector('#accessStatusLabel');
  if(!trigger||!labelEl) return;
  trigger.dataset.tone=tone||'purple';
  labelEl.textContent=label;
  trigger.disabled=disabled;
}

function resetCountdown(){
  ['accessDays','accessHours','accessMinutes'].forEach(id=>{const el=document.querySelector('#'+id);if(el)el.textContent='—'});
}

function paintAccessModal(){
  const payload=accessStatusData||{};
  const body=document.querySelector('#accessStatusBody');
  const stateText=document.querySelector('#accessStatusStateText');
  const countdown=document.querySelector('#accessStatusCountdown');
  const unlimited=document.querySelector('#accessStatusUnlimited');
  const message=document.querySelector('#accessStatusMessage');
  const expiry=document.querySelector('#accessStatusExpiry');
  const expiryValue=document.querySelector('#accessExpiryValue');
  if(!body||!stateText||!countdown||!unlimited||!message||!expiry||!expiryValue) return;

  if(payload.owner){
    body.dataset.tone='purple';
    stateText.textContent='Owner Access';
    countdown.hidden=true;
    unlimited.hidden=false;
    message.hidden=false;
    message.textContent='Token redemption is not required.';
    expiry.hidden=true;
    return;
  }

  const life=payload.life;
  if(!life){
    body.dataset.tone='expired';
    stateText.textContent='Access Unavailable';
    countdown.hidden=true;
    unlimited.hidden=true;
    message.hidden=false;
    message.textContent='No active portal access.';
    expiry.hidden=true;
    resetCountdown();
    return;
  }

  if(life.isPermanent){
    body.dataset.tone='purple';
    stateText.textContent='Permanent Access';
    countdown.hidden=true;
    unlimited.hidden=false;
    message.hidden=true;
    expiry.hidden=true;
    return;
  }

  if(!life.accessExpiresAt){
    body.dataset.tone='expired';
    stateText.textContent='Access Unavailable';
    countdown.hidden=true;
    unlimited.hidden=true;
    message.hidden=false;
    message.textContent='No active portal access.';
    expiry.hidden=true;
    resetCountdown();
    return;
  }

  const parts=remainingParts(life.accessExpiresAt);
  if(!parts||parts.expired||life.status==='revoked'){
    body.dataset.tone='expired';
    stateText.textContent='Access Expired';
    countdown.hidden=true;
    unlimited.hidden=true;
    message.hidden=false;
    message.textContent=life.status==='revoked'?'Portal access has been revoked.':'Your portal access has ended.';
    expiry.hidden=true;
    resetCountdown();
    return;
  }

  const tone=toneForDays(parts.days);
  body.dataset.tone=tone;
  stateText.textContent='Access Active';
  countdown.hidden=false;
  unlimited.hidden=true;
  message.hidden=true;
  expiry.hidden=false;
  document.querySelector('#accessDays').textContent=String(parts.days);
  document.querySelector('#accessHours').textContent=pad2(parts.hours);
  document.querySelector('#accessMinutes').textContent=pad2(parts.minutes);
  expiryValue.textContent=formatExpiry(life.accessExpiresAt);
  setAccessTrigger(`[ ${parts.days} D ]`,tone,false);
}

function paintAccessTrigger(){
  const payload=accessStatusData||{};
  if(payload.owner){setAccessTrigger('[ OWNER ]','purple');return}
  const life=payload.life;
  if(!life){setAccessTrigger('[ — ]','expired');return}
  if(life.isPermanent){setAccessTrigger('[ ∞ ]','purple');return}
  const parts=remainingParts(life.accessExpiresAt);
  if(!parts||parts.expired||life.status==='revoked'){setAccessTrigger('[ EXPIRED ]','expired');return}
  setAccessTrigger(`[ ${parts.days} D ]`,toneForDays(parts.days));
}

function renderAccessStatus(data){
  accessStatusData=normalizeAccessPayload(data);
  if(accessStatusTimer){clearInterval(accessStatusTimer);accessStatusTimer=null;}
  paintAccessTrigger();
  paintAccessModal();
  if(!accessStatusData.owner && accessStatusData.life?.accessExpiresAt && !accessStatusData.life?.isPermanent){
    accessStatusTimer=setInterval(()=>{
      paintAccessTrigger();
      const modal=document.querySelector('#accessStatusModal');
      if(modal&&!modal.hidden) paintAccessModal();
    },1000);
  }
}

function openAccessStatus(){
  const modal=document.querySelector('#accessStatusModal');
  const dialog=modal?.querySelector('.access-status-dialog');
  const trigger=document.querySelector('#accessStatusTrigger');
  if(!modal||!dialog||!trigger||trigger.disabled) return;
  accessStatusLastFocused=document.activeElement;
  paintAccessModal();
  modal.hidden=false;
  trigger.setAttribute('aria-expanded','true');
  document.body.classList.add('access-modal-open');
  requestAnimationFrame(()=>dialog.focus());
}

function closeAccessStatus(){
  const modal=document.querySelector('#accessStatusModal');
  const trigger=document.querySelector('#accessStatusTrigger');
  if(!modal||modal.hidden) return;
  modal.hidden=true;
  trigger?.setAttribute('aria-expanded','false');
  document.body.classList.remove('access-modal-open');
  accessStatusLastFocused?.focus?.();
}

function bindAccessStatusModal(){
  document.querySelector('#accessStatusTrigger')?.addEventListener('click',openAccessStatus);
  document.querySelector('#accessStatusClose')?.addEventListener('click',closeAccessStatus);
  document.querySelector('#accessStatusModal')?.addEventListener('click',(event)=>{
    if(event.target.matches('[data-access-close]')) closeAccessStatus();
  });
  document.addEventListener('keydown',(event)=>{
    const modal=document.querySelector('#accessStatusModal');
    if(!modal||modal.hidden) return;
    if(event.key==='Escape'){event.preventDefault();closeAccessStatus();return}
    if(event.key!=='Tab') return;
    const dialog=modal.querySelector('.access-status-dialog');
    const focusable=[...dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&!el.hidden);
    if(!focusable.length) return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
}

async function load(){
  const s=await AMAuth.getSession();
  if(!s){window.JYYRApp?.navigate("login");return;}
  const gate=await AMAuth.getPortalAccess().catch(()=>null);
  if(!gate?.response?.ok||(gate.data?.access!==true&&gate.data?.owner!==true)){await AMAuth.signOut().catch(()=>{});window.JYYRApp?.navigate("login", { tokenRequired: true });return}
  const h={Authorization:`Bearer ${s.access_token}`,Accept:'application/json'};
  const [u,a]=await Promise.all([fetch('/api/usage',{headers:h,cache:'no-store'}),fetch('/api/accounts',{headers:h,cache:'no-store'})]);
  const ud=await u.json(),ad=await a.json();
  const usage=ud.usage||{};
  accounts=ad.accounts||[];
  const limit=Number(ud.limit||5),used=Number(usage.request_count||usage.consumed_count||0);
  document.querySelector('#activeQuota').textContent=Math.max(limit-used,0);
  document.querySelector('#limitedQuota').textContent=limit;
  document.querySelector('#usedQuota').textContent=used;
  document.querySelector('#created').textContent=accounts.length;
  document.querySelector('#success').textContent=accounts.filter(x=>x.status==='success').length;
  document.querySelector('#failed').textContent=accounts.filter(x=>x.status==='failed').length;
  document.querySelector('#registeredAt').textContent=s.user?.created_at?new Date(s.user.created_at).toLocaleDateString('id-ID',{dateStyle:'medium'}):'—';
  document.querySelector('#lastLogin').textContent=s.user?.last_sign_in_at?new Date(s.user.last_sign_in_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'—';
  document.querySelector('#profileRole').textContent=gate.data?.owner===true?'ACCOUNT OWNER':'ACCOUNT MEMBER';
  document.querySelector('#profileAccessType').textContent=gate.data?.owner===true?'Owner':'Member';
  renderAccessStatus(gate.data);
  render();
}

function getFilteredAccounts(){const q=document.querySelector('#search').value.trim().toLowerCase(),st=document.querySelector('#statusFilter').value;return accounts.filter(a=>(!q||String(a.email||'').toLowerCase().includes(q))&&(!st||a.status===st));}
function render(){const list=getFilteredAccounts(),totalPages=Math.max(1,Math.ceil(list.length/HISTORY_PAGE_SIZE));historyPage=Math.min(Math.max(historyPage,1),totalPages);const start=(historyPage-1)*HISTORY_PAGE_SIZE,pageItems=list.slice(start,start+HISTORY_PAGE_SIZE);document.querySelector('#total').textContent=`Total akun: ${list.length} • Halaman ${historyPage} dari ${totalPages}`;document.querySelector('#history').innerHTML=pageItems.map(a=>`<tr><td>${esc(a.email||'—')}</td><td><span class="badge ${a.status==='success'?'green':a.status==='failed'?'red':'blue'}">${esc(a.status||'pending')}</span></td><td>${esc(fmt(a.created_at))}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Belum ada riwayat.</td></tr>';renderPagination(totalPages);}
function renderPagination(totalPages){const el=document.querySelector('#historyPagination');if(!el)return;el.innerHTML='';if(totalPages<=1)return;const add=(label,page,disabled=false,aria='')=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.disabled=disabled;if(aria)b.setAttribute('aria-label',aria);if(!disabled)b.addEventListener('click',()=>{historyPage=page;render()});el.appendChild(b)};const showPrevious=historyPage>=4;const showFirst=historyPage>=5;if(showPrevious)add('‹',historyPage-1,false,'Halaman sebelumnya');if(showFirst)add('«',1,false,'Halaman pertama');let start;if(totalPages<=3){start=1}else if(historyPage<=3){start=1}else{start=Math.min(historyPage-1,totalPages-2)}const end=Math.min(totalPages,start+2);for(let p=start;p<=end;p++)add(String(p),p,p===historyPage,`Halaman ${p}`);if(historyPage<totalPages)add('›',historyPage+1,false,'Halaman berikutnya');if(historyPage<totalPages)add('»',totalPages,false,'Halaman terakhir');}
function fmt(v){return v?new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'—'}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const statusDropdown=document.querySelector('#statusDropdown'),statusToggle=document.querySelector('#statusFilterToggle'),statusMenu=document.querySelector('#statusFilterMenu'),statusLabel=document.querySelector('#statusFilterLabel'),statusFilter=document.querySelector('#statusFilter');
const statusOptions=[...document.querySelectorAll('.status-dropdown-option')];
function setStatusFilter(value){statusFilter.value=value;const option=statusOptions.find(x=>x.dataset.value===value);statusLabel.textContent=option?.textContent||'Semua Status';statusOptions.forEach(x=>{const active=x.dataset.value===value;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active))});historyPage=1;render()}
statusToggle.addEventListener('click',()=>{const open=!statusMenu.hidden;statusMenu.hidden=open;statusToggle.setAttribute('aria-expanded',String(!open))});
statusOptions.forEach(option=>option.addEventListener('click',()=>{setStatusFilter(option.dataset.value||'');statusMenu.hidden=true;statusToggle.setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!statusDropdown.contains(e.target)){statusMenu.hidden=true;statusToggle.setAttribute('aria-expanded','false')}});
document.querySelector('#search').addEventListener('input',()=>{historyPage=1;render()});
document.querySelector('#logoutBtn').addEventListener('click',async()=>{await AMAuth.signOut();window.JYYRApp?.navigate("login")});
document.querySelector('#refreshPage').addEventListener('click',()=>location.reload());
bindAccessStatusModal();
load().catch(console.error);


/* =========================================================
   SELF ACCOUNT DELETE
========================================================= */

const deleteAccountModal = document.querySelector("#deleteAccountModal");
const deleteAccountBtn = document.querySelector("#deleteAccountBtn");
const cancelDeleteAccountBtn = document.querySelector("#cancelDeleteAccountBtn");
const confirmDeleteAccountBtn = document.querySelector("#confirmDeleteAccountBtn");
const deleteAccountEmail = document.querySelector("#deleteAccountEmail");
const deleteAccountPhrase = document.querySelector("#deleteAccountPhrase");
const deleteAccountStatus = document.querySelector("#deleteAccountStatus");

let deleteAccountLastFocused = null;

function setDeleteAccountStatus(message = "", type = "") {
  if (!deleteAccountStatus) return;
  deleteAccountStatus.textContent = message;
  deleteAccountStatus.dataset.type = type;
}

function canConfirmDeleteAccount() {
  const email = String(deleteAccountEmail?.value || "").trim();
  const phrase = String(deleteAccountPhrase?.value || "").trim().toUpperCase();

  return email.includes("@") && phrase === "HAPUS AKUN";
}

function syncDeleteAccountButton() {
  if (!confirmDeleteAccountBtn) return;
  confirmDeleteAccountBtn.disabled = !canConfirmDeleteAccount();
}

function openDeleteAccountModal() {
  if (!deleteAccountModal) return;

  deleteAccountLastFocused = document.activeElement;

  if (deleteAccountEmail) deleteAccountEmail.value = "";
  if (deleteAccountPhrase) deleteAccountPhrase.value = "";

  setDeleteAccountStatus("");
  syncDeleteAccountButton();

  deleteAccountModal.hidden = false;
  deleteAccountBtn?.setAttribute("aria-expanded", "true");
  document.body.classList.add("account-delete-modal-open");

  requestAnimationFrame(() => deleteAccountEmail?.focus());
}

function closeDeleteAccountModal() {
  if (!deleteAccountModal || deleteAccountModal.hidden) return;

  deleteAccountModal.hidden = true;
  deleteAccountBtn?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("account-delete-modal-open");
  setDeleteAccountStatus("");

  deleteAccountLastFocused?.focus?.();
}

deleteAccountBtn?.addEventListener("click", openDeleteAccountModal);
cancelDeleteAccountBtn?.addEventListener("click", closeDeleteAccountModal);

deleteAccountModal?.addEventListener("click", (event) => {
  if (event.target.matches("[data-delete-account-close]")) {
    closeDeleteAccountModal();
  }
});

deleteAccountEmail?.addEventListener("input", syncDeleteAccountButton);
deleteAccountPhrase?.addEventListener("input", syncDeleteAccountButton);

document.addEventListener("keydown", (event) => {
  if (!deleteAccountModal || deleteAccountModal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeDeleteAccountModal();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = [
    ...deleteAccountModal.querySelectorAll(
      `button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`
    ),
  ];

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

confirmDeleteAccountBtn?.addEventListener("click", async () => {
  if (!canConfirmDeleteAccount()) return;

  confirmDeleteAccountBtn.disabled = true;
  setDeleteAccountStatus("Menghapus akun…");

  try {
    const confirmationEmail = String(deleteAccountEmail.value || "")
      .trim()
      .toLowerCase();

    const result = await AMAuth.deleteAccount(confirmationEmail);

    if (!result?.response?.ok || result?.data?.deleted !== true) {
      throw new Error(
        result?.data?.error || "Akun tidak dapat dihapus."
      );
    }

    setDeleteAccountStatus(
      "Akun berhasil dihapus.",
      "success"
    );

    await AMAuth.signOut().catch(() => {});

    setTimeout(() => {
      window.JYYRApp?.navigate("login", { replaceUrl: true });
    }, 250);
  } catch (error) {
    setDeleteAccountStatus(
      error?.message || "Gagal menghapus akun.",
      "error"
    );

    confirmDeleteAccountBtn.disabled = false;
    syncDeleteAccountButton();
  }
});
