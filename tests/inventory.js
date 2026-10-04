const fs=require('fs');
const path=require('path');

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

const required=[
  "function reservedQty",
  "function soldQty",
  "function availableQty",
  "Reservation expired",
  "status='converted'",
  "app.post('/api/checkout'",
  "app.get('/api/admin/inventory'"
];

for(const pattern of required){
  if(!server.includes(pattern))throw new Error('Missing inventory safeguard: '+pattern);
}

console.log('PASS inventory safeguards present');
