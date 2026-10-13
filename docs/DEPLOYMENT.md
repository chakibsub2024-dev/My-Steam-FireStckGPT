# Deployment

## 1. Single PC (development)
`start-mystream.cmd` / `./start-mystream.sh` or `npm run dev`. Listens on 127.0.0.1:8787.

## 2. Home network
`.env`: `MYSTREAM_HOST=0.0.0.0`. Open `http://<server-LAN-IP>:8787` from other devices. Allow TCP 8787 in the OS firewall.

## 3. Docker (Linux server, NAS, Raspberry Pi 4/5)
```bash
cp .env.example .env    # TMDB_API_KEY, ADMIN_BOOTSTRAP_PASSWORD, APP_ENV=production
docker compose up -d --build
docker compose logs -f
```
The container runs as a non-root user with a read-only filesystem; data is in the `mystream_data` volume.

## 4. Remote access
**Tailscale (recommended for families):** install Tailscale on the server and each device; open `http://<tailscale-name>:8787`. Nothing is exposed to the internet.

**HTTPS on the internet:** put a reverse proxy with automatic certificates in front, e.g. Caddy:
```
stream.example.com {
  reverse_proxy 127.0.0.1:8787
}
```
and set in `.env`: `APP_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `MYSTREAM_API_URL=https://stream.example.com`. Use a strong admin password; consider limiting access by IP or using Tailscale instead.

## 5. Moving the backend later
All state is in the data folder (`MYSTREAM_DATA_DIR`): `mystream.json` (accounts, profiles, lists, progress, add-ons) and `secret.key` (encrypts add-on URLs, signs subtitle links). Copy **both** to the new server and start it there; then point desktop apps to the new address (*MyStream → Server settings…*).

## 6. Backup and restore
```bash
# backup (server running or stopped; the store is written atomically)
tar -czf mystream-backup-$(date +%F).tgz -C /path/to/data mystream.json secret.key
# Docker volume
docker run --rm -v mystream_mystream_data:/data -v "$PWD":/b alpine tar -czf /b/mystream-backup.tgz -C /data .
# restore: stop MyStream, extract into the data folder, start MyStream
```
A `mystream.json.bak` (previous version) is kept automatically next to the store.

## 7. Production checklist
- `APP_ENV=production`, `LOG_LEVEL=info`
- HTTPS with `COOKIE_SECURE=true` and `TRUST_PROXY=true`
- Strong admin password; delete `data/initial-admin-password.txt` if it was generated
- `ADDON_ALLOW_PRIVATE=false` unless you self-host add-ons on the LAN
- Regular backups of the data folder
- Health check: `GET /api/health` (Docker HEALTHCHECK included)
