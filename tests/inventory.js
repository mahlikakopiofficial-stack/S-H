const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const Database=require('better-sqlite3');
const dbFile=path.join(__dirname,'..','data','sh.db');
if(fs.existsSync(dbFile))fs.rmSync(dbFile);
const port=3311;
const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),RESERVATION_HOURS:'1'},stdio:['ignore','pipe','pipe']});
const base='http://127.0.0.1:'+port;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function req(pathname,session,opts={}){const r=await fetch(base+pathname,{...opts,headers:{'content-type':'application/json','x-cart-session':session,...(opts.headers||{})}});const body=await r.json();return {status:r.status,body}}
async function main(){
 try{
  for(let i=0;i<30;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await wait(100)}
  const products=(await req('/api/products','test-a')).body; if(products.length<1000)throw Error('seed count too low');
  const p=products.find(x=>x.status==='available'); if(!p)throw Error('no available product');
  const a=await req('/api/cart/add','test-a',{method:'POST',body:JSON.stringify({product_id:p.id,quantity:1})}); if(a.status!==201)throw Error('first reservation failed');
  const visible=(await req('/api/products/'+p.id,'test-b')).body; if(visible.status!=='reserved')throw Error('reserved item not visible as reserved');
  const b=await req('/api/cart/add','test-b',{method:'POST',body:JSON.stringify({product_id:p.id,quantity:1})); if(b.status!==409)throw Error('second customer was allowed to reserve');
  const db=new Database(dbFile);db.prepare("UPDATE reservations SET expires_at=? WHERE session_id='test-a' AND status='active'").run(Date.now()-1000);db.close();
  const released=(await req('/api/products/'+p.id,'test-b')).body; if(released.status!=='available')throw Error('expired reservation did not release');
  const c=await req('/api/cart/add','test-b',{method:'POST',body:JSON.stringify({product_id:p.id,quantity:1})); if(c.status!==201)throw Error('released item could not be reserved');
  const checkout=await req('/api/checkout','test-b',{method:'POST',body:JSON.stringify({name:'Test Customer',phone:'50000000',address:'Test Address',paci:'TEST',map_url:'https://maps.google.com',notes:''})}); if(checkout.status!==201)throw Error('checkout failed');
  const sold=(await req('/api/products/'+p.id,'test-c')).body; if(sold.status!=='sold')throw Error('ordered item did not become sold');
  console.log('Inventory test PASS');
 }finally{server.kill('SIGTERM');await wait(100)}
}
main().catch(e=>{console.error('Inventory test FAIL:',e.message);server.kill('SIGTERM');process.exitCode=1});
