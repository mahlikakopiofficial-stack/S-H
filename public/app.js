const $=s=>document.querySelector(s);
let session=localStorage.getItem('sh_session');if(!session){session=crypto.randomUUID();localStorage.setItem('sh_session',session)}
let products=[],wishlist=new Set(JSON.parse(localStorage.getItem('sh_wishlist')||'[]'));

async function api(url,opt={}){opt.headers={...(opt.headers||{}),'x-cart-session':session,'content-type':'application/json'};const r=await fetch('/api'+url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(v){return Number(v||0).toFixed(3)+' KWD'}
function saveWish(){localStorage.setItem('sh_wishlist',JSON.stringify([...wishlist]));$('#wishCount').textContent=wishlist.size}
function toggleWish(id){wishlist.has(id)?wishlist.delete(id):wishlist.add(id);saveWish();render()}
function clearFilters(){$('#search').value='';$('#catFilter').value='';$('#sizeFilter').value='';$('#conditionFilter').value='';$('#sort').value='new';render()}
function filterCat(c){$('#catFilter').value=c;render();location.hash='shop'}
function imgFor(p){return esc(p.image||((p.images||[])[0])||'/images/placeholder.svg')}
function renderCard(p){
 const disabled=p.status!=='available',fav=wishlist.has(p.id);
 const badge=disabled?p.status.toUpperCase():(p.available_quantity===1?'ONLY 1 LEFT':'AVAILABLE');
 return '<article class="card '+(disabled?'reserved':'')+'"><div class="photo"><img src="'+imgFor(p)+'" alt="'+esc(p.title)+'" loading="lazy"><span class="badge">'+badge+'</span><button class="heart" aria-label="Wishlist" onclick="toggleWish('+p.id+')">'+(fav?'♥':'♡')+'</button></div><div class="cardbody"><small>'+esc(p.brand)+' · '+esc(p.sku)+'</small><h3>'+esc(p.title)+'</h3><div class="cardmeta"><span>'+esc(p.category)+'</span><span>· '+esc(p.subcategory)+'</span><span>· '+esc(p.tagged_size||'Size not set')+'</span></div><p class="price">'+money(p.price)+'</p><div class="actions"><button onclick="preview('+p.id+')">Quick view</button><button class="add" '+(disabled?'disabled':'')+' onclick="add('+p.id+')">'+(disabled?'Unavailable':'Reserve 24h')+'</button></div></div></article>'
}
async function load(){
 const cats=await api('/categories');
 $('#cats').innerHTML=cats.map(c=>'<button class="catcard" onclick="filterCat(\''+esc(c.name)+'\')"><b>'+esc(c.name)+'</b><small>'+c.item_count+' pieces · Explore →</small></button>').join('');
 $('#catFilter').innerHTML='<option value="">All categories</option>'+cats.map(c=>'<option>'+esc(c.name)+'</option>').join('');
 products=await api('/products');buildFilters(cats);render()
}
function buildFilters(cats){
 const sizes=[...new Set(products.map(p=>p.tagged_size).filter(Boolean))].sort();
 $('#sizeFilter').innerHTML='<option value="">All sizes</option>'+sizes.map(x=>'<option>'+esc(x)+'</option>').join('');
 $('#conditionFilter').innerHTML='<option value="">All conditions</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>';
 $('#quickFilters').innerHTML='<button data-qcat="">All</button>'+cats.map(c=>'<button data-qcat="'+esc(c.name)+'">'+esc(c.name)+'</button>').join('');
 document.querySelectorAll('[data-qcat]').forEach(b=>b.onclick=()=>{ $('#catFilter').value=b.dataset.qcat;render() })
}
function render(){
 const cat=$('#catFilter').value,q=($('#search').value||'').trim().toLowerCase(),size=$('#sizeFilter').value,cond=$('#conditionFilter').value,sort=$('#sort').value;
 let list=products.filter(p=>(!cat||p.category===cat)&&(!size||p.tagged_size===size)&&(!cond||p.condition_grade===cond)&&(!q||[p.title,p.brand,p.sku,p.item_id,p.category,p.subcategory,p.tagged_size,p.color,p.material].join(' ').toLowerCase().includes(q)));
 if(sort==='price-low')list.sort((a,b)=>a.price-b.price);else if(sort==='price-high')list.sort((a,b)=>b.price-a.price);else if(sort==='size')list.sort((a,b)=>String(a.tagged_size).localeCompare(String(b.tagged_size)));else list.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 $('#resultCount').textContent='('+list.length+')';$('#grid').innerHTML=list.map(renderCard).join('');$('#empty').hidden=!!list.length;saveWish()
}
async function preview(id){
 const p=products.find(x=>x.id===id)||await api('/products/'+id), imgs=p.images?.length?p.images:[p.image||'/images/placeholder.svg'];
 $('#previewBody').innerHTML='<div class="previewgrid"><div><img id="previewImage" class="previewimage" src="'+esc(imgs[0])+'" alt="'+esc(p.title)+'"><div class="thumbs">'+imgs.map((im,i)=>'<button onclick="document.querySelector(\'#previewImage\').src=\''+esc(im)+'\'"><img src="'+esc(im)+'" alt=""></button>').join('')+'</div></div><div><p class="eyebrow">'+esc(p.category)+' / '+esc(p.subcategory)+'</p><h2>'+esc(p.title)+'</h2><p class="muted">'+esc(p.brand)+' · SKU '+esc(p.sku)+' · Item '+esc(p.item_id)+'</p><h3>'+money(p.price)+'</h3><span class="badge inline">'+esc(p.status.toUpperCase())+'</span><div class="detailsgrid">'+Object.entries({Size:p.tagged_size,'Actual size':p.actual_size,Fit:p.fit,Waist:p.waist,Rise:p.rise,Inseam:p.inseam,'Pit-to-pit':p.pit_to_pit,Chest:p.bust_chest,Shoulder:p.shoulder,Sleeve:p.sleeve,Length:p.length,Material:p.material,Stretch:p.stretch,Color:p.color,Pattern:p.pattern,Era:p.era,Condition:p.condition_grade,'Wear level':p.wear_level,Defects:p.defects||'None',Alterations:p.alterations||'None',Notes:p.notes||'—'}).map(([k,v])=>'<div class="detail"><b>'+esc(k)+'</b><br>'+esc(v||'—')+'</div>').join('')+'</div>'+(p.status==='available'?'<button class="button full" onclick="add('+p.id+');closePreview()">Reserve this piece for 24h</button>':'<p class="muted">This piece is currently unavailable. It remains visible so you can see its details.</p>')+'</div></div>';
 $('#preview').classList.add('open')
}
function closePreview(){$('#preview').classList.remove('open')}
async function add(id){try{await api('/cart/add',{method:'POST',body:JSON.stringify({product_id:id,quantity:1})});toast('Reserved for 24 hours');await loadCart();await load()}catch(e){toast(e.message)}}
async function removeCart(id){try{await api('/cart/'+id,{method:'DELETE'});toast('Reservation released');await loadCart();await load()}catch(e){toast(e.message)}}
function countdown(ts){const m=Math.max(0,new Date(ts).getTime()-Date.now());return Math.floor(m/3600000)+'h '+String(Math.floor(m%3600000/60000)).padStart(2,'0')+'m'}
async function loadCart(){const c=await api('/cart');$('#cartCount').textContent=c.items.length;$('#cartLines').innerHTML=c.items.length?c.items.map(x=>'<div class="line"><span><b>'+esc(x.title)+'</b><br><small>Reserved · '+countdown(x.expires_at)+' left</small></span><span><b>'+money(x.price)+'</b><br><button class="remove" onclick="removeCart('+x.product_id+')">Release</button></span></div>').join(''):'<p>Your bag is empty.</p>';$('#cartTotal').innerHTML=c.items.length?'<h3>Total '+money(c.total)+'</h3>':''}
function openCart(){$('#cart').classList.add('open');$('#overlay').classList.add('open');loadCart()}function closeCart(){$('#cart').classList.remove('open');$('#overlay').classList.remove('open')}
function toast(t){const x=$('#toast');x.textContent=t;x.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>x.classList.remove('show'),2800)}
$('#cartBtn').onclick=openCart;$('#wishBtn').onclick=()=>{if(!wishlist.size){toast('Your wishlist is empty');return}$('#search').value='';$('#catFilter').value='';const ids=new Set(wishlist);$('#grid').innerHTML=products.filter(p=>ids.has(p.id)).map(renderCard).join('');$('#resultCount').textContent='(wishlist)';location.hash='shop'};
['search','catFilter','sizeFilter','conditionFilter','sort'].forEach(id=>document.getElementById(id).addEventListener(id==='search'?'input':'change',render));
$('#checkout').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));const r=await api('/checkout',{method:'POST',body:JSON.stringify(body)});toast('Order '+r.order_no+' placed');e.target.reset();await loadCart();await load()}catch(err){toast(err.message);await loadCart();await load()}};
load().then(loadCart).catch(e=>toast(e.message));
setInterval(()=>loadCart().catch(()=>{}),60000);
