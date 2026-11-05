const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CATS=['Wardrobes','Modular Kitchens','Beds','Sofas & Seating','Dining Sets','TV Units & Panels','Office Furniture','Shop Fit-outs','Temple & Doors','Ceilings & Partitions'];
const toast=t=>{const e=$('#toast');e.textContent=t;e.classList.add('on');setTimeout(()=>e.classList.remove('on'),3500)};
$('#y').textContent=new Date().getFullYear();
// header, menu
addEventListener('scroll',()=>$('#hd').classList.toggle('s',scrollY>10),{passive:true});
$('#mb').onclick=()=>$('#mb').setAttribute('aria-expanded',$('#nav').classList.toggle('open'));
$('#nav').onclick=()=>$('#nav').classList.remove('open');
// turnkey steps fill as you scroll
const steps=$('#steps'),lis=[...steps.children];
function prog(){const r=steps.getBoundingClientRect(),p=Math.min(1,Math.max(0,(innerHeight*.85-r.top)/(r.height+innerHeight*.3)));
 steps.style.setProperty('--p',p);lis.forEach((l,i)=>l.classList.toggle('on',p>=(i+.4)/lis.length-.05))}
addEventListener('scroll',prog,{passive:true});prog();
// lightbox
let lbImgs=[],lbI=0;
const lbShow=()=>{$('#li').src=lbImgs[lbI];$('#lp').hidden=$('#ln').hidden=lbImgs.length<2};
function openLb(imgs,i){lbImgs=imgs;lbI=i;lbShow();$('#lb').hidden=false;document.body.style.overflow='hidden'}
function closeLb(){$('#lb').hidden=true;document.body.style.overflow=''}
const step=d=>{lbI=(lbI+d+lbImgs.length)%lbImgs.length;lbShow()};
$('#lx').onclick=closeLb;$('#lp').onclick=()=>step(-1);$('#ln').onclick=()=>step(1);
$('#lb').onclick=e=>{if(e.target.id==='lb')closeLb()};
addEventListener('keydown',e=>{if($('#lb').hidden)return;if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')step(-1);if(e.key==='ArrowRight')step(1)});
// cards
let all=[],cat='All';
const card=(i,enq)=>{const im=i.images.map(x=>x.url);
 return `<article class="card"><${im.length?'button':'div'} class="pic ${im.length?'':'ph'}" ${im.length?`data-g="${esc(JSON.stringify(im))}" aria-label="View photos of ${esc(i.title)}"`:''}>
 ${im.length?`<img loading="lazy" src="${esc(im[0])}" alt="${esc(i.title)}">${im.length>1?`<em>${im.length} photos</em>`:''}`:esc(i.title[0])}</${im.length?'button':'div'}>
 <div class="body"><small>${esc(i.category||'')}${i.location?' · '+esc(i.location):''}</small><h3>${esc(i.title)}</h3><p>${esc(i.description)}</p>${i.details?`<p>${esc(i.details)}</p>`:''}
 ${enq?`<button class="btn" data-q="${esc(i.title)}">Ask about this</button>`:''}</div></article>`};
function drawProducts(){const g=all.filter(i=>i.kind==='product'&&(cat==='All'||i.category===cat));
 $('#products').innerHTML=g.map(i=>card(i,true)).join('')||'<p>More furniture is being added. Please call us for any design.</p>'}
document.addEventListener('click',e=>{
 const p=e.target.closest('[data-g]');if(p)openLb(JSON.parse(p.dataset.g),0);
 const b=e.target.closest('[data-q]');if(b){$('#msg').value=`I am interested in: ${b.dataset.q}. `;$('#contact').scrollIntoView();$('#f [name=name]').focus()}});
// load data
fetch('/api/items').then(r=>r.json()).then(d=>{all=d;
 const cs=['All',...new Set([...CATS,...d.filter(i=>i.kind==='product').map(i=>i.category).filter(Boolean)])];
 $('#chips').innerHTML=cs.map(c=>`<button aria-pressed="${c===cat}">${esc(c)}</button>`).join('');
 $('#chips').onclick=e=>{if(e.target.tagName!=='BUTTON')return;cat=e.target.textContent;[...$('#chips').children].forEach(b=>b.setAttribute('aria-pressed',b===e.target));drawProducts()};
 drawProducts();$('#projs').innerHTML=d.filter(i=>i.kind==='project').map(i=>card(i,false)).join('')||'<p>Our project gallery is coming soon.</p>'})
 .catch(()=>toast('Could not load content. Please refresh.'));
fetch('/api/documents').then(r=>r.json()).then(d=>{$('#docs').innerHTML=d.map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join('')||'<span>Brochures and catalogues will be listed here.</span>'});
fetch('/api/settings').then(r=>r.json()).then(s=>{
 $('#cPhone').textContent=s.phone;$('#cPhone').href='tel:'+s.phone.replace(/[^\d+]/g,'');
 $('#cMail').textContent=s.email;$('#cMail').href='mailto:'+s.email;$('#cAddr').textContent=s.address;$('#cHrs').textContent=s.hours;
 $('#wa').href=`https://wa.me/${s.whatsapp}?text=${encodeURIComponent('Hello, I want a furniture quote')}`});
// enquiry form
$('#f').onsubmit=async e=>{e.preventDefault();const b=$('#send');b.disabled=true;b.textContent='Sending…';
 try{const r=await fetch('/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
  if(!r.ok)throw 0;e.target.reset();toast('Thank you. We will call you soon.')}catch{toast('Could not send. Please check your details or call us.')}
 b.disabled=false;b.textContent='Send request'};
