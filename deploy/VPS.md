# S-H VPS Setup

These steps target a fresh Ubuntu 24.04 VPS and the domain `trift-secondhand.duckdns.org`. Point the domain's DNS record at the VPS public IP before requesting HTTPS certificates.

## 1. Install system packages and Node.js 22

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx build-essential python3 sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Confirm Node reports version 22 or newer.

## 2. Create the service account and deploy the repository

```bash
sudo adduser --system --group --home /opt/s-h --no-create-home s-h
sudo install -d -o s-h -g s-h -m 0750 /opt/s-h
sudo -u s-h git clone https://github.com/mahlikakopiofficial-stack/S-H.git /opt/s-h
sudo -u s-h npm ci --omit=dev --prefix /opt/s-h
sudo install -d -o s-h -g s-h -m 0750 /var/lib/s-h
```

For a private GitHub repository, configure a read-only deploy key for the `s-h` account before cloning.

## 3. Configure production environment

Create `/etc/s-h/s-h.env` with mode `0600` and a unique password. Generate a value with `openssl rand -hex 32`; do not use the example placeholder.

```bash
sudo install -d -o root -g root -m 0755 /etc/s-h
sudo install -o root -g root -m 0600 /dev/null /etc/s-h/s-h.env
sudoedit /etc/s-h/s-h.env
```

Set these values in the file:

```dotenv
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
ADMIN_PASSWORD=replace-with-a-unique-random-value
CURRENCY=KWD
RESERVATION_HOURS=24
DOMAIN=trift-secondhand.duckdns.org
PACI_LABEL=PACI
DATA_DIR=/var/lib/s-h
UPLOAD_DIR=/var/lib/s-h/uploads
```

Replace the password placeholder before starting the service. The app refuses the known placeholder in production. SQLite data and uploaded photos live under `/var/lib/s-h`, outside the Git checkout.

## 4. Install and start systemd service

```bash
sudo install -m 0644 /opt/s-h/deploy/s-h.service /etc/systemd/system/s-h.service
sudo systemctl daemon-reload
sudo systemctl enable --now s-h
sudo systemctl status s-h
curl http://127.0.0.1:3000/api/health
```

If `command -v node` reports a path other than `/usr/bin/node`, update `ExecStart` in the unit file to that path and reload systemd.

## 5. Configure Nginx and HTTPS

```bash
sudo ln -s /opt/s-h/deploy/nginx-s-h.conf /etc/nginx/sites-available/s-h
sudo ln -s /etc/nginx/sites-available/s-h /etc/nginx/sites-enabled/s-h
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d trift-secondhand.duckdns.org
```

Allow inbound SSH, HTTP and HTTPS in the VPS firewall. Port `3000` is bound to localhost and should not be opened publicly. Check the site at `https://trift-secondhand.duckdns.org`, the account dashboard at `/account.html`, and the admin console at `/admin.html`.

## 6. Update and back up

Deploy code updates without replacing the SQLite database or uploaded photos:

```bash
sudo -u s-h git -C /opt/s-h pull --ff-only
sudo -u s-h npm ci --omit=dev --prefix /opt/s-h
sudo systemctl restart s-h
sudo systemctl --no-pager --full status s-h
```

Back up the database with SQLite's online backup command, and back up the upload directory separately:

```bash
sudo sqlite3 /var/lib/s-h/sh.db ".backup '/var/backups/s-h-$(date +%F).db'"
sudo tar -czf "/var/backups/s-h-uploads-$(date +%F).tar.gz" -C /var/lib/s-h uploads
```

Test that backups can be restored before relying on them. Checkout records orders but does not connect to a payment processor.