const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const serverPath = path.join(__dirname, '..', 'server.js');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const safeguards = [
	'function reservedQty',
	'function soldQty',
	'function availableQty',
	'Reservation expired',
	"status='converted'",
	"app.post('/api/checkout'",
	"app.get('/api/admin/inventory'",
];
for (const safeguard of safeguards) assert.ok(serverSource.includes(safeguard), `Missing inventory safeguard: ${safeguard}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's-h-inventory-'));
const databasePath = path.join(tempDir, 'test.db');
let child;
let testDb;

function startServer() {
	return new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		child = spawn(process.execPath, [serverPath], {
			env: {
				...process.env,
				NODE_ENV: 'test',
				PORT: '0',
				DATA_DIR: tempDir,
				DB_PATH: databasePath,
				UPLOAD_DIR: path.join(tempDir, 'uploads'),
				ADMIN_PASSWORD: 'test-password',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		child.stdout.on('data', chunk => {
			stdout += chunk;
			const match = stdout.match(/S-H listening on :(\d+)/);
			if (match) resolve(`http://127.0.0.1:${match[1]}`);
		});
		child.stderr.on('data', chunk => { stderr += chunk; });
		child.once('error', reject);
		child.once('exit', code => reject(new Error(`Server exited (${code}): ${stderr}`)));
	});
}

async function run() {
	try {
		const baseUrl = await startServer();
		testDb = new Database(databasePath);
		let customerCookie = '';
		const api = async (route, { session = 'customer-one', admin = false, ...options } = {}) => {
			const response = await fetch(`${baseUrl}/api${route}`, {
				...options,
				headers: {
					'content-type': 'application/json',
					'x-cart-session': session,
					...(customerCookie ? { cookie: customerCookie } : {}),
					...(admin ? { 'x-admin-password': 'test-password' } : {}),
					...options.headers,
				},
			});
			const setCookie = response.headers.get('set-cookie');
			if (setCookie) customerCookie = setCookie.split(';')[0];
			const responseText = await response.text();
			let data;
			try { data = JSON.parse(responseText); }
			catch { throw new Error(`${route} returned ${response.status}: ${responseText.slice(0, 300)}`); }
			return { response, data };
		};

		const { data: products } = await api('/products');
		const item = products.find(product => product.available_quantity > 0);
		assert.ok(item, 'seeded inventory should contain an available item');
		assert.equal(Object.hasOwn(item, 'cost'), false, 'public product data must not expose cost');
		assert.equal(Object.hasOwn(item, 'quantity'), false, 'public product data must not expose raw stock');

		const reservation = await api('/cart/add', { method: 'POST', body: JSON.stringify({ product_id: item.id, quantity: 1 }) });
		assert.equal(reservation.response.status, 201);
		const competingReservation = await api('/cart/add', { session: 'customer-two', method: 'POST', body: JSON.stringify({ product_id: item.id, quantity: 1 }) });
		assert.equal(competingReservation.response.status, 409, 'an active hold must block a competing cart');
		assert.equal((await api('/customer/orders')).response.status, 401, 'customer orders must require authentication');

		const registration = await api('/customer/register', { method: 'POST', body: JSON.stringify({ name: 'Test Buyer', email: 'buyer@example.test', phone: '5550100', password: 'strong-test-password' }) });
		assert.equal(registration.response.status, 201);
		const duplicateRegistration = await api('/customer/register', { method: 'POST', body: JSON.stringify({ name: 'Test Buyer', email: 'buyer@example.test', phone: '5550100', password: 'strong-test-password' }) });
		assert.equal(duplicateRegistration.response.status, 409);
		assert.equal((await api('/customer/me')).data.customer.email, 'buyer@example.test');

		const checkout = await api('/checkout', { method: 'POST', body: JSON.stringify({ name: 'Test Buyer', phone: '5550100', address: 'Test address' }) });
		assert.equal(checkout.response.status, 201);
		const soldItem = await api(`/products/${item.id}`);
		assert.equal(soldItem.data.status, 'sold');
		assert.equal(soldItem.data.available_quantity, 0);
		const customerOrders = await api('/customer/orders');
		assert.equal(customerOrders.data.length, 1);
		assert.equal(customerOrders.data[0].customer_id, registration.data.customer.id);
		assert.equal(customerOrders.data[0].items[0].sku, item.sku);

		assert.equal((await api('/admin/inventory')).response.status, 401);
		const inventory = await api('/admin/inventory', { admin: true });
		const adminItem = inventory.data.find(product => product.id === item.id);
		assert.equal(adminItem.sold_quantity, 1);
		assert.equal(adminItem.available_quantity, 0);
		assert.equal((await api('/admin/orders', { admin: true })).data.length, 1);
		const deliveryUpdate = await api(`/admin/orders/${checkout.data.order_id}/status`, { admin: true, method: 'POST', body: JSON.stringify({ status: 'Out for delivery', note: 'Courier has the parcel' }) });
		assert.equal(deliveryUpdate.data.status, 'Out for delivery');
		const deliveredUpdate = await api(`/admin/orders/${checkout.data.order_id}/status`, { admin: true, method: 'POST', body: JSON.stringify({ status: 'Delivered' }) });
		assert.equal(deliveredUpdate.data.history.at(-1).status, 'Delivered');
		assert.equal((await api('/customer/orders')).data[0].status, 'Delivered');
		const unsafeStockEdit = await api('/admin/product', { admin: true, method: 'POST', body: JSON.stringify({ id: item.id, quantity: 0, price: item.price, active: true }) });
		assert.equal(unsafeStockEdit.response.status, 409);
		const deliveredCancellation = await api(`/admin/orders/${checkout.data.order_id}/status`, { admin: true, method: 'POST', body: JSON.stringify({ status: 'Cancelled' }) });
		assert.equal(deliveredCancellation.response.status, 409);

		const cancellableItem = products.find(product => product.id !== item.id && product.available_quantity > 0);
		await api('/cart/add', { session: 'customer-four', method: 'POST', body: JSON.stringify({ product_id: cancellableItem.id, quantity: 1 }) });
		const cancellableCheckout = await api('/checkout', { session: 'customer-four', method: 'POST', body: JSON.stringify({ name: 'Test Buyer', phone: '5550100', address: 'Test address' }) });
		assert.equal(cancellableCheckout.response.status, 201);
		const cancellation = await api(`/admin/orders/${cancellableCheckout.data.order_id}/status`, { admin: true, method: 'POST', body: JSON.stringify({ status: 'Cancelled' }) });
		assert.equal(cancellation.data.status, 'Cancelled');
		assert.equal((await api(`/products/${cancellableItem.id}`)).data.available_quantity, 1);
		const profile = await api('/customer/profile', { method: 'PUT', body: JSON.stringify({ name: 'Updated Buyer', phone: '5550200' }) });
		assert.equal(profile.data.customer.name, 'Updated Buyer');

		const categories = await api('/categories');
		const subcategories = await api(`/subcategories/${categories.data[0].id}`);
		assert.equal((await api('/admin/settings', { admin: true })).data.brand_name, 'S/H');
		const settings = await api('/admin/settings', { admin: true, method: 'PUT', body: JSON.stringify({ brand_name: 'Studio Test', announcement: 'New edit', hero_title: 'Found again', hero_subtitle: 'Good pieces, ready to go', cta_label: 'Shop the edit', accent_color: '#2a563d' }) });
		assert.equal(settings.data.brand_name, 'Studio Test');
		assert.equal((await api('/storefront/settings')).data.hero_title, 'Found again');

		const imageForm = new FormData();
		imageForm.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')], { type: 'image/png' }), 'sample.png');
		const uploadResponse = await fetch(`${baseUrl}/api/admin/upload`, { method: 'POST', headers: { 'x-admin-password': 'test-password' }, body: imageForm });
		const uploadedImage = await uploadResponse.json();
		assert.equal(uploadResponse.status, 201);
		assert.match(uploadedImage.url, /^\/uploads\/.+\.png$/);
		const createdProduct = await api('/admin/products', { admin: true, method: 'POST', body: JSON.stringify({ title: 'Test overshirt', category_id: categories.data[0].id, subcategory_id: subcategories.data[0].id, price: 12, quantity: 1, image_url: uploadedImage.url }) });
		assert.equal(createdProduct.response.status, 201);
		assert.equal(createdProduct.data.image, uploadedImage.url);
		assert.equal((await api(`/admin/products/${createdProduct.data.id}`, { admin: true, method: 'DELETE' })).data.archived, true);
		assert.equal((await api(`/products/${createdProduct.data.id}`)).response.status, 404);

		const expiringItem = products.find(product => product.id !== item.id && product.id !== cancellableItem.id && product.available_quantity > 0);
		const expiringReservation = await api('/cart/add', { session: 'customer-three', method: 'POST', body: JSON.stringify({ product_id: expiringItem.id, quantity: 1 }) });
		testDb.prepare('UPDATE reservations SET expires_at=? WHERE id=?').run(Date.now() - 1, expiringReservation.data.reservation_id);
		assert.equal((await api(`/products/${expiringItem.id}`)).data.status, 'available');

		await api('/customer/logout', { method: 'POST' });
		assert.equal((await api('/customer/me')).response.status, 401);
		assert.equal((await api('/customer/login', { method: 'POST', body: JSON.stringify({ email: 'buyer@example.test', password: 'strong-test-password' }) })).response.status, 200);
		const signedInOrders = await api('/customer/orders');
		assert.equal(signedInOrders.data.length, 2);
		assert.equal(signedInOrders.data.find(order => order.id === checkout.data.order_id).status, 'Delivered');
		assert.equal(signedInOrders.data.find(order => order.id === cancellableCheckout.data.order_id).status, 'Cancelled');

		console.log('PASS account, order, inventory, upload, storefront settings, and reservation workflows');
	} finally {
		if (testDb) testDb.close();
		if (child && child.exitCode === null) {
			const exited = new Promise(resolve => child.once('exit', resolve));
			child.kill('SIGTERM');
			await exited;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});