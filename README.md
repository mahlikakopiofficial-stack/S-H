# S-H — Thrift / Secondhand Clothing

Separate e-commerce application from RESTAU.

Domain: https://trift-secondhand.duckdns.org

## Core rules

- Mostly one-of-one thrift inventory; quantity is configurable in admin.
- Inventory is checked server-side on listing, reservation and checkout.
- Adding an item creates a server-side reservation for 24 hours.
- A reserved item remains visible to other customers but cannot be added to another cart.
- Expired reservations are released automatically.
- Successful checkout converts the reservation into order stock, so a one-of-one item stays Sold instead of becoming available again.
- Admin inventory always shows Available, Reserved and Sold quantities.
- Admin cannot reduce quantity below already sold or actively reserved stock.
- Product cards have a preview popup with photos, measurements, condition and identifiers.
- Checkout stores delivery address plus PACI reference and a map/location link.
- Test code uses a temporary database and never deletes production inventory.

## Local development

```bash
npm install
npm run check
npm test
npm start
```

Set these environment variables for a real deployment:

- `PORT` — default `3000`
- `ADMIN_PASSWORD` — required for admin API access
- `RESERVATION_HOURS` — default `24`
- `CURRENCY` — default `KWD`
- `DOMAIN` — default `trift-secondhand.duckdns.org`
- `DATA_DIR` — optional database directory

Do not reuse RESTAU's database, environment file, process, or deployment directory.
