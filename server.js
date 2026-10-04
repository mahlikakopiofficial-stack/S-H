const fs=require('fs');
const path=require('path');
const express=require('express');
const cors=require('cors');
const Database=require('better-sqlite3');

const E=process.env;
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^\\s*([A-Z_]+)\\s*=\\s*(.*?)\\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]})}catch{}
const PORT=Number(E.PORT||3000);
const HOURS=Math.max(1,Number(E.RESERVATION_HOURS||24));
const CURRENCY=E.CURRENCY||'KWD';
const ADMIN_PASSWORD=E.ADMIN_PASSWORD||'admin123';
const app=express();
app.use(cors());
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

const dataDir=path.join(__dirname,'data'); fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(path.join(dataDir,'sh.db'));
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
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,sku TEXT NOT NULL,title TEXT NOT NULL,price REAL NOT NULL,quantity INTEGER NOT NULL,
FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS inventory_events(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,event TEXT NOT NULL,reference TEXT DEFAULT '',details TEXT DEFAULT '',created_at INTEGER NOT NULL,
FOREIGN KEY(product_id) REFERENCES products(id));
`);

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
function reservedQty(productId,now=Date.now()){releaseExpired(now);return db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM reservations WHERE product_id=? AND status='active' AND expires_at> ?").get(productId,now).n}
function activeReservedQty(productId,now=Date.now()){return db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM reservations WHERE product_id=? AND status='active' AND expires_at> ?").get(productId,now).n}
function publicStatus(p,now=Date.now()){const r=reservedQty(p.id,now);if(p.quantity-r<=0)return r?'reserved':'sold';return 'available'}
function productPublic(p){
 const r=reservedQty(p.id);return {...p,status:p.quantity-r<=0?(r?'reserved':'sold'):'available',available_quantity:Math.max(0,p.quantity-r),images:JSON.parse(p.images||'[]')};
}
function getProduct(id){return db.prepare('SELECT p.*,c.name category,s.name subcategory FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE p.id=?').get(id)}
function session(req){return String(req.headers['x-cart-session']||req.body?.session_id||'').trim()}
function requireSession(req,res,next){const s=session(req);if(!s)return res.status(400).json({error:'Cart session required'});req.sid=s;next()}
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
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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

setInterval(()=>releaseExpired(),60*1000).unref();

app.get('/api/health',(req,res)=>res.json({ok:1,app:'S-H',reservation_hours:HOURS}));
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT c.id,c.name,COUNT(p.id) item_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id').all()));
app.get('/api/subcategories/:id',(req,res)=>res.json(db.prepare('SELECT s.id,s.name,COUNT(p.id) item_count FROM subcategories s LEFT JOIN products p ON p.subcategory_id=s.id WHERE s.category_id=? GROUP BY s.id ORDER BY s.id').all(req.params.id)));
app.get('/api/products',(req,res)=>{releaseExpired();let sql=`SELECT p.*,c.name category,s.name subcategory FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE p.active=1`;const a=[];if(req.query.category){sql+=' AND c.name=?';a.push(req.query.category)}if(req.query.subcategory){sql+=' AND s.name=?';a.push(req.query.subcategory)}sql+=' ORDER BY p.created_at DESC,p.id DESC';res.json(db.prepare(sql).all(...a).map(productPublic))});
app.get('/api/products/:id',(req,res)=>{releaseExpired();const p=getProduct(req.params.id);if(!p)return res.status(404).json({error:'Item not found'});res.json(productPublic(p))});

app.post('/api/cart/add',requireSession,(req,res)=>{
 releaseExpired();const p=getProduct(req.body.product_id);if(!p||!p.active)return res.status(404).json({error:'Item unavailable'});
 const qty=Math.max(1,Number(req.body.quantity||1));const now=Date.now();const available=p.quantity-activeReservedQty(p.id,now);
 if(available<qty)return res.status(409).json({error:available?'Item has insufficient available stock':'Item is currently reserved'});
 const existing=db.prepare("SELECT * FROM reservations WHERE product_id=? AND session_id=? AND status='active' AND expires_at>?").get(p.id,req.sid,now);
 if(existing)return res.json({ok:1,reservation_id:existing.id,expires_at:existing.expires_at});
 const exp=now+HOURS*3600000;
 const tx=db.transaction(()=>{
   if(p.quantity-activeReservedQty(p.id,now)<qty)throw new Error('RESERVATION_RACE');
   const r=db.prepare("INSERT INTO reservations(product_id,session_id,quantity,expires_at,status,created_at) VALUES(?,?,?,?, 'active',?)").run(p.id,req.sid,qty,exp,now);
   db.prepare("INSERT OR IGNORE INTO carts(session_id,updated_at) VALUES(?,?)").run(req.sid,now);
   const cart=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);
   db.prepare("INSERT INTO cart_items(cart_id,product_id,reservation_id,quantity) VALUES(?,?,?,?) ON CONFLICT(cart_id,product_id) DO UPDATE SET reservation_id=excluded.reservation_id,quantity=excluded.quantity").run(cart.id,p.id,r.lastInsertRowid,qty);
   db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(p.id,'Reserved',String(r.lastInsertRowid),`Reserved for ${HOURS} hours`,now);
   return r.lastInsertRowid;
 });
 try{const rid=tx();res.status(201).json({ok:1,reservation_id:rid,expires_at:exp,reservation_hours:HOURS});}catch(e){if(e.message==='RESERVATION_RACE')return res.status(409).json({error:'Item was just reserved by another customer. Refresh and try again.'});throw e}
});

app.get('/api/cart',requireSession,(req,res)=>{releaseExpired();const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);if(!c)return res.json({items:[],total:0});const rows=db.prepare(`SELECT ci.*,p.title,p.sku,p.price,p.image,r.expires_at,r.status FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN reservations r ON r.id=ci.reservation_id WHERE ci.cart_id=? AND r.status='active' AND r.expires_at>?`).all(c.id,Date.now());res.json({items:rows,total:rows.reduce((s,x)=>s+x.price*x.quantity,0)})});
app.delete('/api/cart/:productId',requireSession,(req,res)=>{releaseExpired();const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);if(!c)return res.json({ok:1});const row=db.prepare('SELECT reservation_id FROM cart_items WHERE cart_id=? AND product_id=?').get(c.id,req.params.productId);const tx=db.transaction(()=>{if(row?.reservation_id)db.prepare("UPDATE reservations SET status='cancelled' WHERE id=? AND status='active'").run(row.reservation_id);db.prepare('DELETE FROM cart_items WHERE cart_id=? AND product_id=?').run(c.id,req.params.productId)});tx();res.json({ok:1})});

app.post('/api/checkout',requireSession,(req,res)=>{
 releaseExpired();const c=db.prepare('SELECT id FROM carts WHERE session_id=?').get(req.sid);if(!c)return res.status(400).json({error:'Cart is empty'});
 const rows=db.prepare(`SELECT ci.*,p.title,p.sku,p.price,p.quantity,r.id reservation_id,r.expires_at,r.status FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN reservations r ON r.id=ci.reservation_id WHERE ci.cart_id=?`).all(c.id);
 const now=Date.now();if(!rows.length)return res.status(400).json({error:'Cart is empty'});
 for(const x of rows){if(x.status!=='active'||x.expires_at<=now)return res.status(409).json({error:`Reservation expired: ${x.title}`});if(x.quantity<1)return res.status(409).json({error:'Invalid quantity'})}
 const required=['name','phone','address'];for(const k of required)if(!String(req.body[k]||'').trim())return res.status(400).json({error:`${k} is required`});
 const subtotal=rows.reduce((s,x)=>s+x.price*x.quantity,0);const orderNo=makeOrderNo();
 const tx=db.transaction(()=>{
  const order=db.prepare("INSERT INTO orders(order_no,session_id,name,phone,email,address,paci,map_url,notes,subtotal,total,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'Placed',?,?)").run(orderNo,req.sid,String(req.body.name).trim(),String(req.body.phone).trim(),String(req.body.email||'').trim(),String(req.body.address).trim(),String(req.body.paci||'').trim(),String(req.body.map_url||'').trim(),String(req.body.notes||'').trim(),subtotal,subtotal,now,now);
  for(const x of rows){
    const fresh=reservedQty(x.product_id,now);
    const p=getProduct(x.product_id);
    if(!p||p.quantity-fresh<0)throw new Error('INVENTORY_CHANGED');
    db.prepare("UPDATE reservations SET status='converted' WHERE id=? AND status='active'").run(x.reservation_id);
    db.prepare("INSERT INTO order_items(order_id,product_id,sku,title,price,quantity) VALUES(?,?,?,?,?,?)").run(order.lastInsertRowid,x.product_id,x.sku,x.title,x.price,x.quantity);
    db.prepare("INSERT INTO inventory_events(product_id,event,reference,details,created_at) VALUES(?,?,?,?,?)").run(x.product_id,'Order placed',orderNo,'Reserved stock converted to order',now);
  }
  db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(c.id);
  return order.lastInsertRowid;
 });
 try{const id=tx();res.status(201).json({ok:1,order_id:id,order_no:orderNo,total:subtotal,status:'Placed'});}
 catch(e){if(e.message==='INVENTORY_CHANGED')return res.status(409).json({error:'Inventory changed. Please refresh your cart.'});throw e}
});

app.get('/api/admin/inventory',(req,res)=>{if(req.headers['x-admin-password']!==ADMIN_PASSWORD)return res.status(401).json({error:'Unauthorized'});releaseExpired();res.json(db.prepare('SELECT p.*,c.name category,s.name subcategory,(p.quantity-COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.product_id=p.id AND r.status=\'active\' AND r.expires_at>?),0)) available_quantity FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id ORDER BY p.id DESC').all(Date.now()).map(x=>({...x,status:x.available_quantity<=0&&reservedQty(x.id)?'reserved':x.available_quantity<=0?'sold':'available'})))});
app.get('/api/admin/orders',(req,res)=>{if(req.headers['x-admin-password']!==ADMIN_PASSWORD)return res.status(401).json({error:'Unauthorized'});res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC').all())});
app.post('/api/admin/product',(req,res)=>{if(req.headers['x-admin-password']!==ADMIN_PASSWORD)return res.status(401).json({error:'Unauthorized'});const b=req.body;const p=getProduct(b.id);if(!p)return res.status(404).json({error:'Use a valid product id'});const q=Math.max(0,Number(b.quantity));db.prepare("UPDATE products SET quantity=?,price=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(q,Number(b.price),b.active===false?0:1,p.id);res.json(productPublic(getProduct(p.id)))});

app.get('/api/config',(req,res)=>res.json({name:'S-H',domain:E.DOMAIN||'trift-secondhand.duckdns.org',currency:CURRENCY,reservation_hours:HOURS,paci_label:E.PACI_LABEL||'PACI'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`S-H listening on :${PORT}`));
