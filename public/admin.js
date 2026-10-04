const $=selector=>document.querySelector(selector);
const pageSize=40;
let password='';
let inventory=[];
let orders=[];
let categories=[];
let currentPage=0;

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function setStatus(message,isError=false){const status=$('#adminStatus');status.textContent=message;status.classList.toggle('error',isError)}
function money(value){return `${Number(value).toFixed(3)} KWD`}
function safeMapUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:''}catch{return ''}}
async function request(path,options={}){
	const response=await fetch('/api'+path,{...options,headers:{...(options.headers||{}),'x-admin-password':password,'content-type':'application/json'}});
	const data=await response.json();
	if(!response.ok)throw Error(data.error||'Request failed');
	return data;
}
async function loadInventory(){inventory=await request('/admin/inventory');renderSummary();renderInventory()}
function renderSummary(){
	$('#availableTotal').textContent=inventory.reduce((sum,item)=>sum+Math.max(0,item.available_quantity),0).toLocaleString();
	$('#reservedTotal').textContent=inventory.reduce((sum,item)=>sum+item.reserved_quantity,0).toLocaleString();
	$('#soldTotal').textContent=inventory.reduce((sum,item)=>sum+item.sold_quantity,0).toLocaleString();
}
function filteredInventory(){
	const query=$('#inventorySearch').value.trim().toLowerCase();
	const status=$('#inventoryFilter').value;
	const category=$('#inventoryCategory').value;
	const items=inventory.filter(item=>{
		const text=[item.title,item.sku,item.item_id,item.brand,item.category,item.subcategory].join(' ').toLowerCase();
		return (!query||text.includes(query))&&(!status||item.status===status)&&(!category||String(item.category_id)===category);
	});
	const sort=$('#inventorySort').value;
	items.sort((a,b)=>{
		if(sort==='newest')return b.id-a.id;
		if(sort==='title')return a.title.localeCompare(b.title);
		if(sort==='price-low')return a.price-b.price;
		if(sort==='price-high')return b.price-a.price;
		return a.category.localeCompare(b.category)||a.subcategory.localeCompare(b.subcategory)||a.title.localeCompare(b.title);
	});
	return items;
}
function renderInventory(){
	const filtered=filteredInventory();
	const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
	currentPage=Math.min(currentPage,pageCount-1);
	const start=currentPage*pageSize;
	const rows=filtered.slice(start,start+pageSize);
	const tableRows=rows.map(item=>`<tr data-id="${item.id}"><td><input class="sku-edit" data-field="sku" type="text" maxlength="64" value="${escapeHtml(item.sku)}" aria-label="SKU for ${escapeHtml(item.title)}"><input data-field="title" type="text" maxlength="180" value="${escapeHtml(item.title)}" aria-label="Item title for ${escapeHtml(item.sku)}"></td><td>${escapeHtml(item.category)} / ${escapeHtml(item.subcategory)}</td><td><input data-field="quantity" type="number" min="0" step="1" value="${item.quantity}" aria-label="Quantity for ${escapeHtml(item.sku)}"></td><td>${item.available_quantity}</td><td>${item.reserved_quantity}</td><td>${item.sold_quantity}</td><td><input data-field="price" type="number" min="0.001" step="0.001" value="${Number(item.price).toFixed(3)}" aria-label="Price for ${escapeHtml(item.sku)}"></td><td><input data-field="active" type="checkbox" ${item.active?'checked':''} aria-label="Live listing for ${escapeHtml(item.sku)}"></td><td class="inventory-actions"><button class="admin-save" type="button" data-action="save">Save</button><button class="admin-archive" type="button" data-action="archive">Archive</button></td></tr>`).join('');
	$('#inventoryTable').innerHTML=rows.length?`<table class="admin-table"><thead><tr><th>SKU / Piece</th><th>Category</th><th>Qty</th><th>Available</th><th>Reserved</th><th>Sold</th><th>Price</th><th>Live</th><th></th></tr></thead><tbody>${tableRows}</tbody></table>`:'<p class="orders-empty">No pieces match this search.</p>';
	$('#inventoryPagination').innerHTML=`<button type="button" data-page="previous" ${currentPage===0?'disabled':''}>Previous</button><span>${filtered.length?start+1:0}-${Math.min(start+pageSize,filtered.length)} of ${filtered.length.toLocaleString()}</span><button type="button" data-page="next" ${currentPage>=pageCount-1?'disabled':''}>Next</button>`;
}
function renderOrders(){
	const statuses=['Placed','Confirmed','Preparing','Out for delivery','Delivered','Cancelled'];
	$('#ordersTable').innerHTML=orders.length?`<table class="admin-table order-table"><thead><tr><th>Order / items</th><th>Customer</th><th>Delivery details</th><th>Order state</th><th>Total</th><th></th></tr></thead><tbody>${orders.map(order=>{const mapUrl=safeMapUrl(order.map_url);return `<tr data-order-id="${order.id}"><td><b>${escapeHtml(order.order_no)}</b><small>${new Date(order.created_at).toLocaleString()}</small><div class="order-items">${order.items.map(item=>`${escapeHtml(item.title)} &times; ${item.quantity}`).join('<br>')}</div><details class="order-history"><summary>Status history (${order.history.length})</summary>${order.history.map(event=>`<p><b>${escapeHtml(event.status)}</b> &middot; ${new Date(event.created_at).toLocaleString()}${event.note?`<br>${escapeHtml(event.note)}`:''}</p>`).join('')}</details></td><td>${escapeHtml(order.customer_name||order.name)}<small>${escapeHtml(order.customer_email||order.email||'Guest checkout')}<br>${escapeHtml(order.phone)}</small></td><td>${escapeHtml(order.address)}${order.paci?`<small>PACI: ${escapeHtml(order.paci)}</small>`:''}${mapUrl?`<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer">Open map</a>`:''}</td><td><select data-field="status" aria-label="Status for order ${escapeHtml(order.order_no)}">${statuses.map(status=>`<option ${status===order.status?'selected':''}>${status}</option>`).join('')}</select><input data-field="status-note" maxlength="300" placeholder="Delivery note (optional)" aria-label="Status note for ${escapeHtml(order.order_no)}"></td><td>${money(order.total)}</td><td><button class="admin-save" type="button" data-action="update-order">Update</button></td></tr>`}).join('')}</tbody></table>`:'<p class="orders-empty">Orders will appear here after checkout.</p>';
}
async function loadAdmin(){
	password=$('#pw').value;
	if(!password){setStatus('Enter the admin password.',true);return}
	setStatus('Loading inventory...');
	try{
		const [items,orderRows,categoryRows,settings]=await Promise.all([request('/admin/inventory'),request('/admin/orders'),fetch('/api/categories').then(response=>response.json()),request('/admin/settings')]);
		inventory=items;orders=orderRows;categories=categoryRows;
		$('#adminPanel').hidden=false;
		$('#newCategory').innerHTML=categories.map(category=>`<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
		$('#inventoryCategory').innerHTML='<option value="">All categories</option>'+categories.map(category=>`<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
		for(const [key,value] of Object.entries(settings))$('#storefrontSettingsForm').elements.namedItem(key).value=value;
		await loadSubcategories();
		renderSummary();renderInventory();renderOrders();setStatus(`${inventory.length.toLocaleString()} inventory pieces loaded.`);
	}catch(error){password='';setStatus(error.message,true)}
}
async function loadSubcategories(){
	const categoryId=$('#newCategory').value;
	if(!categoryId)return;
	const subcategories=await fetch(`/api/subcategories/${encodeURIComponent(categoryId)}`).then(response=>response.json());
	$('#newSubcategory').innerHTML=subcategories.map(category=>`<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
}
async function saveProduct(row){
	const button=row.querySelector('[data-action="save"]');
	button.disabled=true;
	try{
		await request('/admin/product',{method:'POST',body:JSON.stringify({id:Number(row.dataset.id),sku:row.querySelector('[data-field="sku"]').value,title:row.querySelector('[data-field="title"]').value,quantity:Number(row.querySelector('[data-field="quantity"]').value),price:Number(row.querySelector('[data-field="price"]').value),active:row.querySelector('[data-field="active"]').checked})});
		await loadInventory();setStatus('Inventory updated.');
	}catch(error){setStatus(error.message,true)}
	finally{button.disabled=false}
}

$('#adminLogin').addEventListener('submit',event=>{event.preventDefault();loadAdmin()});
$('#newCategory').addEventListener('change',()=>loadSubcategories().catch(error=>setStatus(error.message,true)));
$('#inventorySearch').addEventListener('input',()=>{currentPage=0;renderInventory()});
$('#inventoryFilter').addEventListener('change',()=>{currentPage=0;renderInventory()});
$('#inventoryCategory').addEventListener('change',()=>{currentPage=0;renderInventory()});
$('#inventorySort').addEventListener('change',()=>{currentPage=0;renderInventory()});
$('#inventoryTable').addEventListener('click',async event=>{
	const button=event.target.closest('[data-action]');
	if(!button)return;
	const row=button.closest('tr');
	if(button.dataset.action==='save')await saveProduct(row);
	if(button.dataset.action==='archive'&&window.confirm('Archive this piece? It will disappear from the storefront, while past orders remain intact.')){
		button.disabled=true;
		try{await request(`/admin/products/${row.dataset.id}`,{method:'DELETE'});await loadInventory();setStatus('Piece archived and removed from the storefront.')}
		catch(error){setStatus(error.message,true);button.disabled=false}
	}
});
$('#ordersTable').addEventListener('click',async event=>{
	const button=event.target.closest('[data-action="update-order"]');
	if(!button)return;
	const row=button.closest('tr');button.disabled=true;
	try{
		await request(`/admin/orders/${row.dataset.orderId}/status`,{method:'POST',body:JSON.stringify({status:row.querySelector('[data-field="status"]').value,note:row.querySelector('[data-field="status-note"]').value})});
		orders=await request('/admin/orders');renderOrders();setStatus('Order status updated.');
	}catch(error){setStatus(error.message,true);button.disabled=false}
});
$('#inventoryPagination').addEventListener('click',event=>{
	const button=event.target.closest('[data-page]');
	if(!button||button.disabled)return;
	currentPage+=button.dataset.page==='next'?1:-1;renderInventory();
});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
	document.querySelectorAll('[data-tab]').forEach(tab=>{const selected=tab===button;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected))});
	$('#inventoryView').hidden=button.dataset.tab!=='inventory';
	$('#ordersView').hidden=button.dataset.tab!=='orders';
	$('#settingsView').hidden=button.dataset.tab!=='settings';
}));
$('#newProductForm').addEventListener('submit',async event=>{
	event.preventDefault();
	const button=event.submitter;button.disabled=true;
	try{
		const formData=new FormData(event.currentTarget),image=formData.get('image');
		let imageUrl=String(formData.get('image_url')||'').trim();
		if(image instanceof File&&image.size){
			const uploadForm=new FormData();uploadForm.append('image',image);
			const uploadResponse=await fetch('/api/admin/upload',{method:'POST',headers:{'x-admin-password':password},body:uploadForm});
			const uploaded=await uploadResponse.json();if(!uploadResponse.ok)throw Error(uploaded.error||'Image upload failed');
			imageUrl=uploaded.url;
		}
		const fields=Object.fromEntries(formData);delete fields.image;fields.image_url=imageUrl;
		const product=await request('/admin/products',{method:'POST',body:JSON.stringify(fields)});
		event.currentTarget.reset();
		$('#inventorySearch').value='';
		$('#inventoryCategory').value='';
		$('#inventoryFilter').value='';
		$('#inventorySort').value='newest';
		currentPage=0;
		await loadInventory();
		setStatus(`${product.sku} added to inventory.`);
		$('#inventoryTable').scrollIntoView({behavior:'smooth',block:'start'});
	}catch(error){setStatus(error.message,true)}
	finally{button.disabled=false}
});
$('#storefrontSettingsForm').addEventListener('submit',async event=>{
	event.preventDefault();const button=event.submitter;button.disabled=true;
	try{await request('/admin/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});setStatus('Storefront settings saved.')}
	catch(error){setStatus(error.message,true)}
	finally{button.disabled=false}
});