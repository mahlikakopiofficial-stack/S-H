const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const express=require('express');
const cors=require('cors');
const Database=require('better-sqlite3');
const multer=require('multer');

const E=process.env;
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^\\s*([A-Z_]+)\\s*=\\s*(.*?)\\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]})}catch{}
const PORT=Number(E.PORT||3000);
const HOST=E.HOST||'127.0.0.1';
const HOURS=Math.max(1,Number(E.RESERVATION_HOURS||24));
const CURRENCY=E.CURRENCY||'KWD';
const ADMIN_PASSWORD=String(E.ADMIN_PASSWORD||'').trim();
if(!ADMIN_PASSWORD)console.warn('WARNING: ADMIN_PASSWORD is not configured; admin API is disabled until it is set.');
if(E.NODE_ENV==='production'&&['admin123','replace-with-a-strong-password'].includes(ADMIN_PASSWORD))throw new Error('Set a unique ADMIN_PASSWORD before starting S-H in production');
const app=express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

const dataDir=path.resolve(E.DATA_DIR||path.join(__dirname,'data'));fs.mkdirSync(dataDir,{recursive:true});
const databasePath=path.resolve(E.DB_PATH||path.join(dataDir,'sh.db'));fs.mkdirSync(path.dirname(databasePath),{recursive:true});
const db=new Database(databasePath);
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS subcategories(id INTEGER PRIMARY KEY,category_id INTEGER NOT NULL,name TEXT NOT NULL,UNIQUE(category_id,name),FOREIGN KEY(category_id) REFERENCES categories(id));
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY,sku TEXT UNIQUE NOT NULL,item_id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,brand TEXT DEFAULT '',
 category_id INTEGER,subcategory_id INTEGER,age_group TEXT DEFAULT '',gender TEXT DEFAULT '',
 tagged_size TEXT DEFAULT '',actual_size TEXT DEFAULT '',fit TEXT DEFAULT '',
 waist TEXT DEFAULT '',rise TEXT DEFAULT '',inseam TEXT DEFAULT '',outseam TEXT DEFAULT '',leg_opening TEXT DEFAULT '',
 bust_chest TEXT DEFAULT '',pit_to_pit TEXT DEFAULT '',shoulder TEXT DEFAULT '',sleeve TEXT DEFAULT '',length TEXT DEFAULT '',
 material TEXT DEFAULT '',stretch TEXT DEFAULT '',color TEXT DEFAULT '',pattern TEXT DEFAULT '',era TEXT DEFAULT '',
 country_label TEXT DEFAULT '',condition_grade TEXT DEFAULT '',wear_level TEXT DEFAULT '',defects TEXT DEFAULT '',alterations TEXT DEFAULT '',
 notes TEXT DEFAULT '',cost REAL DEFAULT 0,price REAL NOT NULL,quantity INTEGER DEFAULT 1,active INTEGER DEFAULT 1,
 image TEXT DEFAULT '',images TEXT DEFAULT '[]',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(category_id) REFERENCES categories(id),FOREIGN KEY(subcategory_id) REFERENCES subcategories(id)
);
CREATE TABLE IF NOT EXISTS reservations(
 id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,session_id TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,
 expires_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_res_product_status ON reservations(product_id,status,expires_at);
CREATE TABLE IF NOT EXISTS carts(id INTEGER PRIMARY KEY,session_id TEXT UNIQUE NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cart_items(cart_id INTEGER NOT NULL,product_id INTEGER NOT NULL,reservation_id INTEGER,quantity INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(cart_id,product_id),
 FOREIGN KEY(cart_id) REFERENCES carts(id) ON DELETE CASCADE,FOREIGN KEY(product_id) REFERENCES products(id),FOREIGN KEY(reservation_id) REFERENCES reservations(id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,order_no TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT DEFAULT '',
address TEXT NOT NULL,paci TEXT DEFAULT '',map_url TEXT DEFAULT '',notes TEXT DEFAULT '',subtotal REAL NOT NULL,total REAL NOT NULL,status TEXT NOT NULL DEFAULT 'Placed',
created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_sessions(token_hash TEXT PRIMARY KEY,customer_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
CREATE TABLE IF NOT EXISTS storefront_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_status_events(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,status TEXT NOT NULL,note TEXT DEFAULT '',created_at INTEGER NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,sku TEXT NOT NULL,title TEXT NOT NULL,price REAL NOT NULL,quantity INTEGER NOT NULL,
FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS inventory_events(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,event TEXT NOT NULL,reference TEXT DEFAULT '',details TEXT DEFAULT '',created_at INTEGER NOT NULL,
FOREIGN KEY(product_id) REFERENCES products(id));
`);
if(!db.prepare('PRAGMA table_info(orders)').all().some(column=>column.name==='customer_id'))db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id,created_at)');
const uploadDir=E.UPLOAD_DIR||path.join(__dirname,'public','uploads');
fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir,{maxAge:'1d'}));
const imageExtensions={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'};
const upload=multer({storage:multer.diskStorage({destination:uploadDir,filename:(req,file,done)=>done(null,crypto.randomUUID()+imageExtensions[file.mimetype])}),limits:{fileSize:8*1024*1024,files:1},fileFilter:(req,file,done)=>imageExtensions[file.mimetype]?done(null,true):done(new Error('Choose a JPEG, PNG, WebP, or GIF image'))});

const taxonomy={
 Women:['Tops','Shirts & Blouses','Dresses','Skirts','Pants & Jeans','Jackets & Outerwear','Activewear'],
 Men:['T-Shirts','Shirts','Polo','Pants & Jeans','Shorts','Jackets & Outerwear','Activewear'],
 Kids:['Girls','Boys','Baby','Kids Tops','Kids Bottoms','Kids Dresses','Kids Outerwear'],
 Teens:['Tops','Shirts','Dresses & Skirts','Jeans & Pants','Hoodies & Jackets','Activewear','School & Casual'],
 Unisex:['Tops','Hoodies & Sweatshirts','Jeans & Pants','Jackets & Outerwear','Activewear','Vintage'],
 Shoes:['Sneakers','Casual','Boots','Sandals'],
 'Bags & Accessories':['Bags','Caps & Hats','Belts','Scarves']
};
const insCat=db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)');
const insSub=db.prepare('INSERT OR IGNORE INTO subcategories(category_id,name) VALUES(?,?)');
for(const [cat,subs] of Object.entries(taxonomy)){insCat.run(cat);const cid=db.prepare('SELECT id FROM categories WHERE name=?').get(cat).id;for(const s of subs)insSub.run(cid,s)}

function releaseExpired(now=Date.now()){
 const rows=db.prepare("SELECT * FROM reservations WHERE status='active' AND expires_at<=?").all(now);
 const tx=db.transaction(()=>{for(const r of rows){
   db.prepare("UPDATE reservations SET status='expired' WHERE id=? AND status='active'").run(r.id);
   db.prepare("DELETE FROM cart_items WHERE reservation_id=?").run(r.id);
   db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(r.product_id,'Reservation expired',String(r.id),'Released after 24-hour hold',now);
 }});
 tx(); return rows.length;
}
function reservedQty(productId,now=Date.now()){releaseExpired(now);return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM reservations WHERE product_id=? AND status='active' AND expires_at> ?").get(productId,now).n||0)}
function soldQty(productId){return Number(db.prepare("SELECT COALESCE(SUM(oi.quantity),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.status NOT IN ('Cancelled','Refunded')").get(productId).n||0)}
function availableQty(productId,now=Date.now()){const p=db.prepare('SELECT quantity FROM products WHERE id=?').get(productId);if(!p)return 0;return Math.max(0,Number(p.quantity)-soldQty(productId)-reservedQty(productId,now))}
function publicStatus(p,now=Date.now()){const available=availableQty(p.id,now);if(available>0)return 'available';return reservedQty(p.id,now)>0?'reserved':'sold'}
function inventoryCounts(p,now=Date.now()){
 const reserved=reservedQty(p.id,now),sold=soldQty(p.id),available=Math.max(0,Number(p.quantity)-reserved-sold);
 return {available_quantity:available,reserved_quantity:reserved,sold_quantity:sold,status:available?'available':reserved?'reserved':'sold'};
}
function productPublic(p){const {cost,quantity,...publicProduct}=p;return {...publicProduct,...inventoryCounts(p),images:JSON.parse(p.images||'[]')}}
function getProduct(id){return db.prepare('SELECT p.*,c.name category,s.name subcategory FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE p.id=?').get(id)}
function session(req){return String(req.headers['x-cart-session']||req.body?.session_id||'').trim()}
function requireSession(req,res,next){const s=session(req);if(!s)return res.status(400).json({error:'Cart session required'});req.sid=s;next()}
function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex')}
function customerToken(req){
 const cookie=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('sh_customer='));
 return cookie?decodeURIComponent(cookie.slice('sh_customer='.length)):'';
}
function optionalCustomer(req,res,next){
 try{
  const token=customerToken(req);
  if(token){
  const row=db.prepare('SELECT c.id,c.name,c.email,c.phone,c.created_at,s.token_hash FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token),Date.now());
   if(row){req.customer=row;req.customerTokenHash=row.token_hash}
  }
  next();
 }catch(error){next(error)}
}
function requireCustomer(req,res,next){if(!req.customer)return res.status(401).json({error:'Please sign in to your customer account'});next()}
function setCustomerCookie(res,token,maxAge=30*24*60*60){
 const secure=E.NODE_ENV==='production'?'; Secure':'';
 res.setHeader('Set-Cookie',`sh_customer=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
function createCustomerSession(customerId,res){
 const token=crypto.randomBytes(32).toString('base64url'),now=Date.now();
 db.prepare('INSERT INTO customer_sessions(token_hash,customer_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token),customerId,now+30*24*60*60*1000,now);
 setCustomerCookie(res,token);
}
function customerPublic(customer){return {id:customer.id,name:customer.name,email:customer.email,phone:customer.phone,created_at:customer.created_at}}
function orderDetails(order){return {...order,items:db.prepare('SELECT sku,title,price,quantity FROM order_items WHERE order_id=?').all(order.id),history:db.prepare('SELECT status,note,created_at FROM order_status_events WHERE order_id=? ORDER BY id').all(order.id)}}
function validImageFile(file){
 const bytes=fs.readFileSync(file.path),mime=file.mimetype;
 if(mime==='image/jpeg')return bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/gif')return bytes.subarray(0,3).toString()==='GIF';
 if(mime==='image/webp')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 return false;
}
const storefrontDefaults={brand_name:'S/H',announcement:'',hero_title:'A better kind\nof already loved.',hero_subtitle:'One-off pieces with a past, ready for whatever comes next.',cta_label:'Find your next favourite',accent_color:'#d3ee55'};
function storefrontSettings(){const settings={...storefrontDefaults};for(const row of db.prepare('SELECT key,value FROM storefront_settings').all())if(Object.hasOwn(settings,row.key))settings[row.key]=row.value;return settings}
function makeOrderNo(){return 'SH-'+new Date().toISOString().replace(/\\D/g,'').slice(0,14)+'-'+Math.random().toString(36).slice(2,7).toUpperCase()}

function seed(){
 if(db.prepare('SELECT COUNT(*) n FROM products').get().n)return;
 const tx=db.transaction(()=>{
   let n=1;
   for(const [cat,subs] of Object.entries(taxonomy)){
    const cid=db.prepare('SELECT id FROM categories WHERE name=?').get(cat).id;
    for(const sub of subs){
     const sid=db.prepare('SELECT id FROM subcategories WHERE category_id=? AND name=?').get(cid,sub).id;
     for(let i=1;i<=30;i++){
      const id=n++;
      const sku='SH-'+String(id).padStart(5,'0');
      const title=`${sub} Thrift Find #${i}`;
      const age=['Adult','Teen','Kids'].includes(cat)?cat:'Adult';
      const gender=['Women','Men','Girls'].includes(sub)?'Women':['Men','Boys'].includes(sub)?'Men':'Unisex';
      const price=Number((Math.max(2,8+(i%9)*1.75)).toFixed(3));
      db.prepare(`INSERT INTO products(sku,item_id,title,brand,category_id,subcategory_id,age_group,gender,tagged_size,actual_size,fit,waist,rise,inseam,outseam,leg_opening,bust_chest,pit_to_pit,shoulder,sleeve,length,material,stretch,color,pattern,era,country_label,condition_grade,wear_level,notes,cost,price,quantity,image,images)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
       sku,'ITEM-'+String(id).padStart(6,'0'),title,['S-H Select','Vintage','Street Edit','Pre-Loved'][i%4],cid,sid,age,gender,
       ['XS','S','M','L','XL'][i%5],['XS','S','M','L','XL'][i%5],['Regular','Relaxed','Slim','Oversized'][i%4],
       cat==='Men'||sub.includes('Pants')?String(28+(i%9)):'',cat==='Men'||sub.includes('Pants')?String(10+(i%4)):'',
       sub.includes('Pants')?String(28+(i%8)):'',sub.includes('Pants')?String(38+(i%8)):'',sub.includes('Pants')?String(7+(i%3)):'',
       !sub.includes('Pants')?String(36+(i%10)):'',!sub.includes('Pants')?String(18+(i%6)):'',String(15+(i%4)),String(8+(i%5)),String(25+(i%9)),
       ['Cotton','Denim','Polyester blend','Linen blend'][i%4],['None','Light','Medium'][i%3],['Black','Blue','White','Beige','Green','Brown'][i%6],['Solid','Stripe','Graphic','Floral','Check'][i%5],
       ['Y2K','2000s','2010s','Modern'][i%4],'Various',['A','B','C'][i%3],['Light wear','Normal wear','Visible wear'][i%3],
       'Sample listing — inspect photos and measurements before purchase.',price*.45,price,1,'/images/placeholder.svg',JSON.stringify(['/images/placeholder.svg'])
      );
     }
    }
   }
 });
 tx();
}
seed();

setInterval(()=>{releaseExpired();db.prepare('DELETE FROM customer_sessions WHERE expires_at<=?').run(Date.now())},60*1000).unref();

app.get('/api/health',(req,res)=>res.json({ok:1,app:'S-H',reservation_hours:HOURS}));
app.get('/api/storefront/settings',(req,res)=>res.json(storefrontSettings()));
app.get('/api/customer/me',optionalCustomer,(req,res)=>req.customer?res.json({customer:customerPublic(req.customer)}):res.status(401).json({error:'Not signed in'}));
app.post('/api/customer/register',(req,res)=>{
 const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),phone=String(req.body.phone||'').trim(),password=String(req.body.password||'');
 if(name.length<2||name.length>100)return res.status(400).json({error:'Enter your name'});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'Enter a valid email address'});
 if(phone.length<5||phone.length>40)return res.status(400).json({error:'Enter a valid phone number'});
 if(password.length<8||password.length>128)return res.status(400).json({error:'Password must be 8 to 128 characters'});
 const salt=crypto.randomBytes(16).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex'),now=Date.now();
 try{
  const customerId=db.prepare('INSERT INTO customers(name,email,phone,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)').run(name,email,phone,passwordHash,salt,now).lastInsertRowid;
  createCustomerSession(customerId,res);
  res.status(201).json({customer:customerPublic(db.prepare('SELECT id,name,email,phone,created_at FROM customers WHERE id=?').get(customerId))});
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'An account already exists for this email'});throw error}
});
app.post('/api/customer/login',(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||''),customer=db.prepare('SELECT * FROM customers WHERE email=?').get(email);
 if(!customer||password.length>128)return res.status(401).json({error:'Email or password is incorrect'});
 const supplied=crypto.scryptSync(password,customer.password_salt,64),stored=Buffer.from(customer.password_hash,'hex');
 if(supplied.length!==stored.length||!crypto.timingSafeEqual(supplied,stored))return res.status(401).json({error:'Email or password is incorrect'});
 createCustomerSession(customer.id,res);
 res.json({customer:customerPublic(customer)});
});
app.post('/api/customer/logout',optionalCustomer,(req,res)=>{
 if(req.customerTokenHash)db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(req.customerTokenHash);
 setCustomerCookie(res,'',0);res.json({ok:1});
});
app.put('/api/customer/profile',optionalCustomer,requireCustomer,(req,res)=>{
 const name=String(req.body.name||'').trim(),phone=String(req.body.phone||'').trim();
 if(name.length<2||name.length>100||phone.length<5||phone.length>40)return res.status(400).json({error:'Enter a valid name and phone number'});
 db.prepare('UPDATE customers SET name=?,phone=? WHERE id=?').run(name,phone,req.customer.id);
 res.json({customer:customerPublic(db.prepare('SELECT id,name,email,phone,created_at FROM customers WHERE id=?').get(req.customer.id))});
});
app.get('/api/customer/orders',optionalCustomer,requireCustomer,(req,res)=>res.json(db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC,id DESC').all(req.customer.id).map(orderDetails)));
app.get('/api/admin/settings',requireAdmin,(req,res)=>res.json(storefrontSettings()));
app.put('/api/admin/settings',requireAdmin,(req,res)=>{
 const input=req.body||{},next={};
 for(const key of ['brand_name','announcement','hero_title','hero_subtitle','cta_label']){
  const value=String(input[key]??'').trim(),limit=key==='brand_name'?32:key==='cta_label'?48:180;
  if(value.length>limit)return res.status(400).json({error:`${key.replaceAll('_',' ')} must be ${limit} characters or fewer`});
  next[key]=value;
 }
 if(!/^#[0-9a-f]{6}$/i.test(String(input.accent_color||'')))return res.status(400).json({error:'Choose a valid six-digit accent color'});
 next.accent_color=input.accent_color;
 const tx=db.transaction(()=>{for(const [key,value] of Object.entries(next))db.prepare('INSERT INTO storefront_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value)});
 tx();res.json(storefrontSettings());
});
app.post('/api/admin/upload',requireAdmin,upload.single('image'),(req,res)=>{
 if(!req.file)return res.status(400).json({error:'Choose a JPEG, PNG, WebP, or GIF image'});
 if(!validImageFile(req.file)){fs.unlinkSync(req.file.path);return res.status(400).json({error:'The uploaded file is not a valid image'});}
 res.status(201).json({url:'/uploads/'+req.file.filename});
});
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT c.id,c.name,COUNT(CASE WHEN p.active=1 THEN 1 END) item_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id').all()));
app.get('/api/subcategories/:id',(req,res)=>res.json(db.prepare('SELECT s.id,s.name,COUNT(p.id) item_count FROM subcategories s LEFT JOIN products p ON p.subcategory_id=s.id WHERE s.category_id=? GROUP BY s.id ORDER BY s.id').all(req.params.id)));
app.get('/api/products',(req,res)=>{releaseExpired();let sql=`SELECT p.*,c.name category,s.name subcategory FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE p.active=1`;const a=[];if(req.query.category){sql+=' AND c.name=?';a.push(req.query.category)}if(req.query.subcategory){sql+=' AND s.name=?';a.push(req.query.subcategory)}sql+=' ORDER BY p.created_at DESC,p.id DESC';res.json(db.prepare(sql).all(...a).map(productPublic))});
app.get('/api/products/:id',(req,res)=>{releaseExpired();const p=getProduct(req.params.id);if(!p||!p.active)return res.status(404).json({error:'Item not found'});res.json(productPublic(p))});

app.post('/api/cart/add',requireSession,(req,res)=>{
 releaseExpired();const p=getProduct(req.body.product_id);if(!p||!p.active)return res.status(404).json({error:'Item unavailable'});
 const qty=Math.max(1,Number(req.body.quantity||1));const now=Date.now();const available=availableQty(p.id,now);
 if(available<qty)return res.status(409).json({error:available?'Item has insufficient available stock':'Item is currently reserved'});
 const existing=db.prepare("SELECT * FROM reservations WHERE product_id=? AND session_id=? AND status='active' AND expires_at>?").get(p.id,req.sid,now);
 if(existing)return res.json({ok:1,reservation_id:existing.id,expires_at:existing.expires_at});
 const exp=now+HOURS*3600000;
 const tx=db.transaction(()=>{
   const r=db.prepare("INSERT INTO reservations(product_id,session_id,quantity,expires_at,status,created_at) VALUES(?,?,?,?, 'active',?)").run(p.id,req.sid,qty,exp,now);
   db.prepare("INSERT OR IGNORE INTO carts(session_id,updated_at) VALUES(?,?)").run(req.sid,now);
   const cart=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);
   db.prepare("INSERT INTO cart_items(cart_id,product_id,reservation_id,quantity) VALUES(?,?,?,?) ON CONFLICT(cart_id,product_id) DO UPDATE SET reservation_id=excluded.reservation_id,quantity=excluded.quantity").run(cart.id,p.id,r.lastInsertRowid,qty);
   db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(p.id,'Reserved',String(r.lastInsertRowid),`Reserved for ${HOURS} hours`,now);
   return r.lastInsertRowid;
 });
 const rid=tx();res.status(201).json({ok:1,reservation_id:rid,expires_at:exp});
});

app.get('/api/cart',requireSession,(req,res)=>{releaseExpired();const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);if(!c)return res.json({items:[],total:0});const rows=db.prepare(`SELECT ci.*,p.title,p.sku,p.price,p.image,r.expires_at,r.status FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN reservations r ON r.id=ci.reservation_id WHERE ci.cart_id=? AND r.status='active' AND r.expires_at>?`).all(c.id,Date.now());res.json({items:rows,total:rows.reduce((s,x)=>s+x.price*x.quantity,0)})});
app.delete('/api/cart/:productId',requireSession,(req,res)=>{
 releaseExpired();
 const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);
 if(!c)return res.json({ok:1});
 const item=db.prepare("SELECT ci.reservation_id,ci.product_id,ci.quantity FROM cart_items ci JOIN reservations r ON r.id=ci.reservation_id WHERE ci.cart_id=? AND ci.product_id=? AND r.session_id=? AND r.status='active'").get(c.id,req.params.productId,req.sid);
 if(!item)return res.json({ok:1});
 const now=Date.now();
 const tx=db.transaction(()=>{
   db.prepare("UPDATE reservations SET status='released' WHERE id=? AND session_id=? AND status='active'").run(item.reservation_id,req.sid);
   db.prepare('DELETE FROM cart_items WHERE cart_id=? AND product_id=?').run(c.id,req.params.productId);
   db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(item.product_id,'Reservation released',String(item.reservation_id),'Customer removed the piece from the bag',now);
 });
 tx();
 res.json({ok:1});
});

app.post('/api/checkout',optionalCustomer,requireSession,(req,res)=>{
 releaseExpired();const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);if(!c)return res.status(400).json({error:'Cart is empty'});
 const now=Date.now();
 const rows=db.prepare(`SELECT ci.*,p.title,p.sku,p.price,p.quantity stock_quantity,r.id reservation_id,r.quantity reserved_quantity,r.session_id reservation_session,r.expires_at,r.status,
 (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id AND o.status NOT IN ('Cancelled','Refunded')) sold_quantity
 FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN reservations r ON r.id=ci.reservation_id WHERE ci.cart_id=?`).all(c.id);
 if(!rows.length)return res.status(400).json({error:'Cart is empty'});
 for(const x of rows){
  if(x.status!=='active'||x.expires_at<=now||x.reservation_session!==req.sid)return res.status(409).json({error:`Reservation expired: ${x.title}`});
  if(x.quantity!==x.reserved_quantity||x.sold_quantity+x.reserved_quantity>x.stock_quantity)return res.status(409).json({error:'Inventory changed'});
 }
 const required=['name','phone','address'];for(const k of required)if(!String(req.body[k]||'').trim())return res.status(400).json({error:`${k} is required`});
 const subtotal=rows.reduce((s,x)=>s+x.price*x.quantity,0);const orderNo=makeOrderNo();
 const tx=db.transaction(()=>{
  const order=db.prepare("INSERT INTO orders(order_no,session_id,name,phone,email,address,paci,map_url,notes,subtotal,total,status,created_at,updated_at,customer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'Placed',?,?,?)").run(orderNo,req.sid,String(req.body.name).trim(),String(req.body.phone).trim(),String(req.body.email||req.customer?.email||'').trim(),String(req.body.address).trim(),String(req.body.paci||'').trim(),String(req.body.map_url||'').trim(),String(req.body.notes||'').trim(),subtotal,subtotal,now,now,req.customer?.id||null);
  db.prepare('INSERT INTO order_status_events(order_id,status,note,created_at) VALUES(?,?,?,?)').run(order.lastInsertRowid,'Placed','Order received',now);
  for(const x of rows){
    const converted=db.prepare("UPDATE reservations SET status='converted' WHERE id=? AND session_id=? AND status='active' AND expires_at>?").run(x.reservation_id,req.sid,now);
    if(converted.changes!==1)throw new Error('INVENTORY_CHANGED');
    const stock=db.prepare('SELECT quantity FROM products WHERE id=?').get(x.product_id);
    const remaining=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM reservations WHERE product_id=? AND status='active' AND expires_at>?").get(x.product_id,now).n;
    if(!stock||soldQty(x.product_id)+remaining+x.quantity>stock.quantity)throw new Error('INVENTORY_CHANGED');
    db.prepare("INSERT INTO order_items(order_id,product_id,sku,title,price,quantity) VALUES(?,?,?,?,?,?)").run(order.lastInsertRowid,x.product_id,x.sku,x.title,x.price,x.quantity);
    db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(x.product_id,'Order placed',orderNo,'Reserved stock converted to order',now);
  }
  db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(c.id);
  return order.lastInsertRowid;
 });
 try{const id=tx();res.status(201).json({ok:1,order_id:id,order_no:orderNo,total:subtotal,status:'Placed'});}
 catch(e){if(e.message==='INVENTORY_CHANGED')return res.status(409).json({error:'Inventory changed. Please refresh your cart.'});throw e}
});

function adminAuth(req,res){if(!ADMIN_PASSWORD||req.headers['x-admin-password']!==ADMIN_PASSWORD){res.status(401).json({error:'Unauthorized'});return false}return true}
function requireAdmin(req,res,next){if(!adminAuth(req,res))return;next()}
app.get('/api/admin/inventory',(req,res)=>{
 if(!adminAuth(req,res))return;
 releaseExpired();
 const rows=db.prepare('SELECT p.*,c.name category,s.name subcategory FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id ORDER BY p.id DESC').all();
 res.json(rows.map(product=>({...product,...inventoryCounts(product)})));
});
app.get('/api/admin/orders',(req,res)=>{
 if(!adminAuth(req,res))return;
 res.json(db.prepare('SELECT o.*,c.email customer_email,c.name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC').all().map(orderDetails));
});
app.post('/api/admin/orders/:id/status',requireAdmin,(req,res)=>{
 const order=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id),status=String(req.body.status||''),allowed=['Placed','Confirmed','Preparing','Out for delivery','Delivered','Cancelled'];
 if(!order)return res.status(404).json({error:'Order not found'});
 if(!allowed.includes(status))return res.status(400).json({error:'Choose a valid order status'});
 if(['Delivered','Cancelled'].includes(order.status)&&status!==order.status)return res.status(409).json({error:`${order.status} orders cannot be reopened`});
 const now=Date.now(),note=String(req.body.note||'').trim().slice(0,300);
 const tx=db.transaction(()=>{db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status,now,order.id);db.prepare('INSERT INTO order_status_events(order_id,status,note,created_at) VALUES(?,?,?,?)').run(order.id,status,note,now)});
 tx();res.json(orderDetails(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)));
});
app.post('/api/admin/products',(req,res)=>{
 if(!adminAuth(req,res))return;
 const b=req.body,title=String(b.title||'').trim(),categoryId=Number(b.category_id),subcategoryId=Number(b.subcategory_id),price=Number(b.price),quantity=Number(b.quantity);
 if(!title||title.length>180)return res.status(400).json({error:'Enter a title of 1 to 180 characters'});
 if(!Number.isInteger(quantity)||quantity<1||!Number.isFinite(price)||price<=0)return res.status(400).json({error:'Enter a whole quantity above zero and a price above zero'});
 if(!db.prepare('SELECT id FROM subcategories WHERE id=? AND category_id=?').get(subcategoryId,categoryId))return res.status(400).json({error:'Choose a valid category and subcategory'});
 const imageUrl=String(b.image_url||'').trim();
 if(imageUrl&&!(/^\/(images|uploads)\//.test(imageUrl)||/^https:\/\//i.test(imageUrl)))return res.status(400).json({error:'Photo URL must use HTTPS or a local image path'});
 const create=db.transaction(()=>{
  const id=db.prepare('SELECT COALESCE(MAX(id),0)+1 next FROM products').get().next;
  const sku='SH-'+String(id).padStart(5,'0'),itemId='ITEM-'+String(id).padStart(6,'0'),image=imageUrl||'/images/placeholder.svg';
  const result=db.prepare("INSERT INTO products(sku,item_id,title,brand,category_id,subcategory_id,tagged_size,actual_size,fit,waist,rise,inseam,outseam,leg_opening,bust_chest,pit_to_pit,shoulder,sleeve,length,material,stretch,color,pattern,era,country_label,condition_grade,wear_level,defects,alterations,notes,price,quantity,active,image,images) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)").run(
  sku,itemId,title,String(b.brand||'').trim(),categoryId,subcategoryId,
  String(b.tagged_size||'').trim(),String(b.actual_size||'').trim(),String(b.fit||'').trim(),
  String(b.waist||'').trim(),String(b.rise||'').trim(),String(b.inseam||'').trim(),String(b.outseam||'').trim(),String(b.leg_opening||'').trim(),
  String(b.bust_chest||'').trim(),String(b.pit_to_pit||'').trim(),String(b.shoulder||'').trim(),String(b.sleeve||'').trim(),String(b.length||'').trim(),
  String(b.material||'').trim(),String(b.stretch||'').trim(),String(b.color||'').trim(),String(b.pattern||'').trim(),String(b.era||'').trim(),String(b.country_label||'').trim(),
  ['A','B','C'].includes(b.condition_grade)?b.condition_grade:'B',String(b.wear_level||'').trim(),String(b.defects||'').trim(),String(b.alterations||'').trim(),String(b.notes||'').trim(),
  price,quantity,image,JSON.stringify([image])
);
  return getProduct(result.lastInsertRowid);
 }).immediate();
 res.status(201).json(productPublic(create));
});
app.post('/api/admin/product',(req,res)=>{
 if(!adminAuth(req,res))return;
 const b=req.body||{},p=getProduct(b.id);
 if(!p)return res.status(404).json({error:'Use a valid product id'});
 const q=Number(b.quantity),price=Number(b.price),title=String(b.title??p.title).trim(),sku=String(b.sku??p.sku).trim();
 if(!title||title.length>180)return res.status(400).json({error:'Enter a title of 1 to 180 characters'});
 if(!/^[A-Za-z0-9._-]{1,64}$/.test(sku))return res.status(400).json({error:'SKU must use 1 to 64 letters, numbers, dots, underscores or hyphens'});
 if(db.prepare('SELECT id FROM products WHERE lower(sku)=lower(?) AND id<>?').get(sku,p.id))return res.status(409).json({error:'That SKU is already assigned to another item'});
 if(!Number.isInteger(q)||q<0||!Number.isFinite(price)||price<=0)return res.status(400).json({error:'Enter a non-negative whole quantity and a price above zero'});
 const counts=inventoryCounts(p);
 if(q<counts.reserved_quantity+counts.sold_quantity)return res.status(409).json({error:'Quantity cannot be lower than reserved and sold stock'});
 db.prepare("UPDATE products SET sku=?,title=?,quantity=?,price=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(sku,title,q,price,b.active===false?0:1,p.id);
 res.json(productPublic(getProduct(p.id)));
});
app.delete('/api/admin/products/:id',requireAdmin,(req,res)=>{
 const product=getProduct(req.params.id);if(!product)return res.status(404).json({error:'Item not found'});
 const now=Date.now();
 const tx=db.transaction(()=>{
  const reservations=db.prepare("SELECT id FROM reservations WHERE product_id=? AND status='active'").all(product.id);
  for(const reservation of reservations){db.prepare("UPDATE reservations SET status='expired',expires_at=? WHERE id=?").run(now,reservation.id);db.prepare('DELETE FROM cart_items WHERE reservation_id=?').run(reservation.id)}
  db.prepare('UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(product.id);
  db.prepare('INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)').run(product.id,'Archived','',`Archived by administrator; released ${reservations.length} active reservation(s)`,now);
 });
 tx();res.json({ok:1,id:product.id,archived:true});
});

app.get('/api/config',(req,res)=>res.json({name:'S-H',domain:E.DOMAIN||'trift-secondhand.duckdns.org',currency:CURRENCY,reservation_hours:HOURS,paci_label:E.PACI_LABEL||'PACI'}));
app.use((error,req,res,next)=>{
 if(error instanceof multer.MulterError)return res.status(400).json({error:error.code==='LIMIT_FILE_SIZE'?'Image must be 8 MB or smaller':'Upload one image at a time'});
 if(error.message==='Choose a JPEG, PNG, WebP, or GIF image')return res.status(400).json({error:error.message});
 next(error);
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const server=app.listen(PORT,HOST,()=>console.log(`S-H listening on :${server.address().port}`));
