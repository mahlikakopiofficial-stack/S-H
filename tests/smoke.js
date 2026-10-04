const {spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sh-test-'));
const port=Number(process.env.TEST_PORT||43117);
const child=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,PORT:String(port),DATA_DIR:tmp,ADMIN_PASSWORD:'test-admin',RESERVATION_HOURS:'24',NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']
});

let output='';
child.stdout.on('data',d=>{output+=d.toString()});
child.stderr.on('data',d=>{output+=d.toString()});

async function waitForServer(){
  for(let i=0;i<80;i++){
    try{
      const r=await fetch('http://127.0.0.1:'+port+'/api/health');
      if(r.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Server did not start: '+output);
}

async function api(pathname,options={}){
  const r=await fetch('http://127.0.0.1:'+port+pathname,options);
  const data=await r.json();
  return {status:r.status,data};
}

async function main(){
  await waitForServer();

  const products=await api('/api/products');
  if(products.status!==200||!products.data.length)throw new Error('Products not seeded');

  const product=products.data[0];
  if(product.status!=='available'||product.available_quantity!==1)throw new Error('Initial inventory is wrong');

  const headers1={'content-type':'application/json','x-cart-session':'test-session-1'};
  const add1=await api('/api/cart/add',{method:'POST',headers:headers1,body:JSON.stringify({product_id:product.id,quantity:1})});
  if(add1.status!==201)throw new Error('First reservation failed: '+JSON.stringify(add1.data));

  const productsReserved=await api('/api/products/'+product.id);
  if(productsReserved.data.status!=='reserved'||productsReserved.data.available_quantity!==0)throw new Error('Reserved item is not locked');

  const headers2={'content-type':'application/json','x-cart-session':'test-session-2'};
  const add2=await api('/api/cart/add',{method:'POST',headers:headers2,body:JSON.stringify({product_id:product.id,quantity:1})});
  if(add2.status!==409)throw new Error('Second customer could reserve the same one-of-one item');

  const checkout=await api('/api/checkout',{method:'POST',headers:headers1,body:JSON.stringify({
    name:'Test Customer',
    phone:'00000000',
    address:'Test address'
  })});
  if(checkout.status!==201)throw new Error('Checkout failed: '+JSON.stringify(checkout.data));

  const productsSold=await api('/api/products/'+product.id);
  if(productsSold.data.status!=='sold'||productsSold.data.available_quantity!==0)throw new Error('Checked-out one-of-one item became available again');

  const admin=await api('/api/admin/inventory',{headers:{'x-admin-password':'test-admin'}});
  if(admin.status!==200)throw new Error('Admin inventory failed');
  const row=admin.data.find(x=>x.id===product.id);
  if(!row||row.status!=='sold'||row.sold_quantity!==1)throw new Error('Admin sold inventory accounting is wrong');

  console.log('PASS S-H reservation lock');
  console.log('PASS S-H checkout converts reservation to sold stock');
  console.log('PASS S-H admin inventory shows sold stock');
}

main().then(()=>{
  child.kill('SIGTERM');
}).catch(error=>{
  console.error('FAIL',error.message);
  console.error(output);
  child.kill('SIGTERM');
  process.exitCode=1;
});