# S-H — Thrift / Secondhand Clothing

Separate e-commerce application from RESTAU.

Domain: https://trift-secondhand.duckdns.org

## Core rules
- Mostly one-of-one thrift inventory; quantity is configurable in admin.
- Inventory is checked server-side on listing, add-to-cart and checkout.
- Adding a one-of-one item creates a 24-hour server-side reservation.
- A reserved item remains visible to other customers but cannot be added to their cart.
- Expired reservations are released automatically and the item returns to the available listing.
- Successful checkout changes the reserved stock to sold/order stock.
- Admin inventory never hides stock: it shows Available, Reserved and Sold.
- Product cards have a preview popup with photos, measurements, condition and identifiers.
- Checkout stores delivery address plus PACI reference and a map/location link.

## Development
npm install
npm run check
npm test
npm start

Do not reuse RESTAU's database, environment file, process, or deployment directory.
