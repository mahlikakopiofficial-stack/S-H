const $=selector=>document.querySelector(selector);
let currentCustomer=null;

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function setStatus(message,isError=false){const status=$('#accountStatus');status.textContent=message;status.classList.toggle('error',isError)}
function money(value){return `${Number(value).toFixed(3)} KWD`}
async function api(path,options={}){
	const response=await fetch('/api'+path,{...options,headers:{...(options.headers||{}),...(options.body?{'content-type':'application/json'}:{})}});
	const text=await response.text();
	let data={};
	try{data=text?JSON.parse(text):{}}catch{throw Error('The server could not complete that request.')}
	if(!response.ok)throw Error(data.error||'Request failed');
	return data;
}
function showAuth(mode='login'){
	$('#authPanel').hidden=false;$('#accountDashboard').hidden=true;
	document.querySelectorAll('[data-auth-tab]').forEach(button=>{const selected=button.dataset.authTab===mode;button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected))});
	$('#loginForm').hidden=mode!=='login';$('#registerForm').hidden=mode!=='register';
}
function safeMapUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:''}catch{return ''}}
function renderOrders(orders){
	$('#orderCount').textContent=`${orders.length} ${orders.length===1?'order':'orders'}`;
	$('#customerOrders').innerHTML=orders.length?orders.map(order=>{
		const mapUrl=safeMapUrl(order.map_url);
		return `<article class="customer-order"><div class="customer-order-top"><div><p class="eyebrow eyebrow-dark">${escapeHtml(order.order_no)}</p><h3>${new Date(order.created_at).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}</h3></div><span class="order-status-pill status-${order.status.toLowerCase().replaceAll(' ','-')}">${escapeHtml(order.status)}</span></div><div class="customer-order-items">${order.items.map(item=>`<div><span>${escapeHtml(item.title)} <small>&times; ${item.quantity}</small></span><strong>${money(item.price*item.quantity)}</strong></div>`).join('')}</div><div class="customer-order-bottom"><span>Total</span><strong>${money(order.total)}</strong></div>${order.history.length?`<ol class="order-timeline">${order.history.map(event=>`<li class="${event.status===order.status?'current':''}"><span>${escapeHtml(event.status)}</span><time>${new Date(event.created_at).toLocaleString()}</time>${event.note?`<small>${escapeHtml(event.note)}</small>`:''}</li>`).join('')}</ol>`:''}<div class="order-delivery"><b>Delivery</b><p>${escapeHtml(order.address)}</p>${order.paci?`<small>PACI: ${escapeHtml(order.paci)}</small>`:''}${mapUrl?`<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer">Open map</a>`:''}</div></article>`;
	}).join(''):'<p class="account-empty">Your first S-H order will appear here.</p>';
}
async function loadDashboard(customer){
	currentCustomer=customer;
	const [profile,orders]=await Promise.all([api('/customer/me'),api('/customer/orders')]);
	currentCustomer=profile.customer;
	$('#customerName').textContent=currentCustomer.name.split(' ')[0];
	$('#customerEmail').textContent=currentCustomer.email;
	$('#profileForm').elements.name.value=currentCustomer.name;
	$('#profileForm').elements.email.value=currentCustomer.email;
	$('#profileForm').elements.phone.value=currentCustomer.phone;
	renderOrders(orders);
	$('#authPanel').hidden=true;$('#accountDashboard').hidden=false;setStatus('');
}
async function submitAuth(event,path){
	event.preventDefault();
	const button=event.submitter;button.disabled=true;setStatus('');
	try{const result=await api(path,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});await loadDashboard(result.customer)}
	catch(error){setStatus(error.message,true)}
	finally{button.disabled=false}
}

document.querySelectorAll('[data-auth-tab]').forEach(button=>button.addEventListener('click',()=>showAuth(button.dataset.authTab)));
$('#loginForm').addEventListener('submit',event=>submitAuth(event,'/customer/login'));
$('#registerForm').addEventListener('submit',event=>submitAuth(event,'/customer/register'));
$('#profileForm').addEventListener('submit',async event=>{
	event.preventDefault();const button=event.submitter;button.disabled=true;
	try{const result=await api('/customer/profile',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});currentCustomer=result.customer;$('#customerName').textContent=currentCustomer.name.split(' ')[0];setStatus('Your details have been saved.')}
	catch(error){setStatus(error.message,true)}
	finally{button.disabled=false}
});
$('#logoutButton').addEventListener('click',async()=>{
	try{await api('/customer/logout',{method:'POST'});currentCustomer=null;$('#loginForm').reset();$('#registerForm').reset();showAuth();setStatus('You are signed out.')}
	catch(error){setStatus(error.message,true)}
});

api('/customer/me').then(result=>loadDashboard(result.customer)).catch(()=>showAuth());