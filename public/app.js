const $=selector=>document.querySelector(selector);
let session=localStorage.getItem('sh_session');
if(!session){session=crypto.randomUUID();localStorage.setItem('sh_session',session)}
let products=[];
let visibleLimit=24;
let toastTimer;

const samplePhotos=[
	'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=82',
	'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=900&q=82',
];

async function api(url,options={}){
	const response=await fetch('/api'+url,{...options,headers:{...(options.headers||{}),'x-cart-session':session,'content-type':'application/json'}});
	const data=await response.json();
	if(!response.ok)throw Error(data.error||'Request failed');
	return data;
}
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function money(value){return Number(value).toFixed(3)+' KWD'}
function photoFor(product){return product.image&&!product.image.includes('placeholder.svg')?product.image:samplePhotos[product.id%samplePhotos.length]}
function titleFor(product){return product.title.replace(/ Thrift Find #/, ' · Archive ')}
function imageMarkup(product,className=''){
	return `<img class="${className}" src="${esc(photoFor(product))}" alt="Sample style reference for ${esc(titleFor(product))}" loading="lazy" onerror="this.onerror=null;this.src='/images/placeholder.svg'">`;
}
function renderCard(product,index){
	const available=product.status==='available';
	const statusClass=product.status==='reserved'?'reserved-tag':product.status==='sold'?'sold-tag':'';
	return `<article class="product-card" style="animation-delay:${Math.min(index%8,7)*35}ms"><div class="product-photo">${imageMarkup(product)}<span class="status-tag ${statusClass}">${esc(product.status==='available'?'AVAILABLE':product.status.toUpperCase())}</span></div><div class="product-info"><div class="product-meta"><span>${esc(product.brand||product.category)}</span><span>${esc(product.sku)}</span></div><h3>${esc(titleFor(product))}</h3><p class="product-size">${esc(product.category)} / ${esc(product.subcategory)} &middot; ${esc(product.tagged_size||'One size')}</p><div class="product-bottom"><span class="product-price">${money(product.price)}</span><div class="product-actions"><button class="small-action" type="button" data-action="preview" data-id="${product.id}">Details</button><button class="small-action add-action" type="button" data-action="add" data-id="${product.id}" ${available?'':'disabled'}>${available?'Add':'Unavailable'}</button></div></div></div></article>`;
}
async function loadProducts(){products=await api('/products');render()}
async function load(){
	const [categories,settings]=await Promise.all([api('/categories'),api('/storefront/settings')]);
	applyStorefrontSettings(settings);
	$('#cats').innerHTML=categories.map(category=>`<button class="category-chip" type="button" data-category="${esc(category.name)}">${esc(category.name)} <small>${category.item_count}</small></button>`).join('');
	$('#catFilter').innerHTML='<option value="">All categories</option>'+categories.map(category=>`<option value="${esc(category.name)}">${esc(category.name)}</option>`).join('');
	await loadProducts();
}
async function refreshStorefrontSettings(){try{applyStorefrontSettings(await api('/storefront/settings'))}catch{}}

function applyStorefrontSettings(settings){
	$('#announcement').textContent=settings.announcement;
	$('#announcement').hidden=!settings.announcement;
	$('#heroTitle').textContent=settings.hero_title;
	$('#heroSubtitle').textContent=settings.hero_subtitle;
	$('#heroCta').innerHTML=`${esc(settings.cta_label)} <span aria-hidden="true">&rarr;</span>`;
	document.querySelectorAll('[data-brand-name]').forEach(element=>element.textContent=settings.brand_name);
	document.documentElement.style.setProperty('--lime',settings.accent_color);
}
function render(){
	const category=$('#catFilter').value;
	const status=$('#statusFilter').value;
	const query=$('#searchInput').value.trim().toLowerCase();
	let visible=products.filter(product=>{
		const searchable=[product.title,product.brand,product.sku,product.item_id,product.category,product.subcategory,product.color,product.tagged_size].join(' ').toLowerCase();
		return (!category||product.category===category)&&(!status||product.status===status)&&(!query||searchable.includes(query));
	});
	if($('#sortFilter').value==='price-low')visible.sort((a,b)=>a.price-b.price);
	if($('#sortFilter').value==='price-high')visible.sort((a,b)=>b.price-a.price);
	const shown=visible.slice(0,visibleLimit);
	$('#grid').innerHTML=shown.map(renderCard).join('');
	$('#resultCount').textContent=visible.length>shown.length?`Showing ${shown.length} of ${visible.length.toLocaleString()} pieces`:`${visible.length.toLocaleString()} ${visible.length===1?'piece':'pieces'}`;
	$('#loadMore').hidden=visible.length<=visibleLimit;
	$('#emptyState').hidden=visible.length!==0;
	document.querySelectorAll('.category-chip').forEach(button=>button.classList.toggle('active',button.dataset.category===category));
}
function filterCategory(category){$('#catFilter').value=category;visibleLimit=24;render();location.hash='shop'}
async function preview(id){
	try{
		const product=products.find(item=>item.id===id)||await api('/products/'+id);
		const details={Category:product.category,Subcategory:product.subcategory,'Tagged size':product.tagged_size,'Actual size':product.actual_size,Fit:product.fit,Waist:product.waist,Rise:product.rise,Inseam:product.inseam,'Pit to pit':product.pit_to_pit,Chest:product.bust_chest,Shoulder:product.shoulder,Sleeve:product.sleeve,Length:product.length,Material:product.material,Stretch:product.stretch,Color:product.color,Pattern:product.pattern,Era:product.era,Condition:product.condition_grade,'Wear level':product.wear_level,Defects:product.defects||'None',Notes:product.notes};
		$('#previewBody').innerHTML=`<div class="preview-layout"><img class="preview-image" src="${esc(photoFor(product))}" alt="Sample style reference for ${esc(titleFor(product))}" onerror="this.onerror=null;this.src='/images/placeholder.svg'"><div class="preview-details"><p class="eyebrow eyebrow-dark">SAMPLE STYLE PHOTO</p><h2>${esc(titleFor(product))}</h2><p class="preview-ident">${esc(product.brand)} &middot; SKU ${esc(product.sku)} &middot; Item ${esc(product.item_id)}</p><p class="preview-price">${money(product.price)} &middot; ${esc(product.status.toUpperCase())}</p><div class="details-grid">${Object.entries(details).map(([label,value])=>`<div><b>${esc(label)}</b>${esc(value||'Not listed')}</div>`).join('')}</div>${product.status==='available'?`<button class="button button-dark preview-add" type="button" data-action="add" data-id="${product.id}">Reserve this piece <span aria-hidden="true">&rarr;</span></button>`:''}</div></div>`;
		$('#preview').classList.add('open');
	}catch(error){showToast(error.message)}
}
function closePreview(){$('#preview').classList.remove('open')}
async function add(id){
	try{
		const reservation=await api('/cart/add',{method:'POST',body:JSON.stringify({product_id:id,quantity:1})});
		showToast(`Reserved until ${new Date(reservation.expires_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`);
		await Promise.all([loadCart(),loadProducts()]);
	}catch(error){showToast(error.message);await loadProducts()}
}
async function removeFromCart(id){
	try{await api('/cart/'+id,{method:'DELETE'});await Promise.all([loadCart(),loadProducts()]);showToast('Piece removed from your bag')}catch(error){showToast(error.message)}
}
async function loadCart(){
	const cart=await api('/cart');
	$('#cartCount').textContent=cart.items.length;
	$('#drawerCount').textContent=`(${cart.items.length})`;
	$('#cartLines').innerHTML=cart.items.length?cart.items.map(item=>`<div class="cart-line">${imageMarkup(products.find(product=>product.id===item.product_id)||{id:item.product_id,image:item.image,title:item.title},'')}<div><h3>${esc(titleFor({title:item.title}))}</h3><p>Held until ${new Date(item.expires_at).toLocaleString()}</p><button class="remove-line" type="button" data-action="remove" data-id="${item.product_id}">Remove</button></div><strong>${money(item.price)}</strong></div>`).join(''):'<p class="cart-empty">Nothing in your bag yet. The good finds go quickly.</p>';
	$('#cartTotal').innerHTML=cart.items.length?`<span>Subtotal</span><span>${money(cart.total)}</span>`:'';
	$('#checkout').hidden=cart.items.length===0;
}
function openCart(){$('#cart').classList.add('open');$('#overlay').classList.add('open');$('#cart').setAttribute('aria-hidden','false');loadCart().catch(error=>showToast(error.message))}
function closeCart(){$('#cart').classList.remove('open');$('#overlay').classList.remove('open');$('#cart').setAttribute('aria-hidden','true')}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3000)}

$('#cartBtn').addEventListener('click',openCart);
$('#catFilter').addEventListener('change',()=>{visibleLimit=24;render()});
$('#statusFilter').addEventListener('change',()=>{visibleLimit=24;render()});
$('#sortFilter').addEventListener('change',()=>{visibleLimit=24;render()});
$('#searchInput').addEventListener('input',()=>{visibleLimit=24;render()});
$('#loadMore').addEventListener('click',()=>{visibleLimit+=24;render()});
$('#cats').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)filterCategory(button.dataset.category)});
$('#grid').addEventListener('click',event=>{
	const button=event.target.closest('[data-action]');
	if(!button)return;
	const id=Number(button.dataset.id);
	if(button.dataset.action==='preview')preview(id);
	if(button.dataset.action==='add')add(id);
});
$('#previewBody').addEventListener('click',event=>{const button=event.target.closest('[data-action="add"]');if(button){closePreview();add(Number(button.dataset.id))}});
$('#cartLines').addEventListener('click',event=>{const button=event.target.closest('[data-action="remove"]');if(button)removeFromCart(Number(button.dataset.id))});
$('#overlay').addEventListener('click',closeCart);
$('#checkout').addEventListener('submit',async event=>{
	event.preventDefault();
	const submit=event.submitter;
	submit.disabled=true;
	try{
		const result=await api('/checkout',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
		event.currentTarget.reset();
		await Promise.all([loadCart(),loadProducts()]);
		showToast(`Order ${result.order_no} placed`);
	}catch(error){showToast(error.message);await Promise.all([loadCart(),loadProducts()])}
	finally{submit.disabled=false}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeCart();closePreview()}});

load().then(loadCart).catch(error=>showToast(error.message));
setInterval(()=>loadProducts().catch(()=>{}),45000);
setInterval(()=>refreshStorefrontSettings(),45000);