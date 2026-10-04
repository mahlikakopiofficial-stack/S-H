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
- Customer accounts use hashed passwords and expiring, revocable HTTP-only sessions; customer order history is private to the signed-in account.
- Orders can be confirmed, prepared, sent for delivery, delivered or cancelled. Delivered and cancelled orders cannot be reopened; cancelling a pending order restores stock without deleting history.
- Admin inventory always shows Available, Reserved and Sold quantities and cannot reduce quantity below sold or reserved stock.
- Inventory can be edited, category-sorted and archived. Product images can be uploaded (JPEG, PNG, WebP or GIF; 8 MB maximum).
- Storefront headline, announcement, button label and accent color are editable from admin.
- Product cards have a preview popup with photos, measurements, condition and identifiers.
- Checkout stores delivery address plus PACI reference and a map/location link.
- Test code uses temporary storage and never deletes production inventory.

## Local development

```bash
npm install
npm run check
npm test
npm start
```

The storefront is served at `/`, customer accounts at `/account.html`, and the inventory, orders and storefront-settings console at `/admin.html`. Set `ADMIN_PASSWORD` before using the admin console; admin APIs stay disabled when no password is configured. Production startup rejects the development default and example placeholder.

Set `DATA_DIR` to choose the SQLite data directory. Tests use temporary `DATA_DIR` or `DB_PATH` overrides. Product uploads are stored under `public/uploads` by default and can be redirected with `UPLOAD_DIR`.

Sample catalog items use clearly labeled reference photos until real product photos are added.

For a production VPS deployment with systemd, Nginx and HTTPS, follow [deploy/VPS.md](deploy/VPS.md).

Do not reuse RESTAU's database, environment file, process, or deployment directory.