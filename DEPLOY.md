# Deploying memflow 24/7

Goal: alerts fire while you sleep. Any always-on Linux box works — pick ONE option.

---

## Option A — Oracle Cloud (genuinely free forever)

1. Sign up: <https://www.oracle.com/cloud/free/> (needs email + card for identity check; **choose a region close to you**)
2. Console → Compute → Instances → **Create Instance**
   - Image: **Ubuntu 22.04+**
   - Shape: **Ampere A1** with 2 OCPU / 12GB RAM (always-free) — or VM.Standard.E2.1.Micro
   - Add your SSH key (create with `ssh-keygen -t ed25519` if you don't have one)
3. Networking: allow TCP port 22 and 3000 in the subnet security list
4. SSH in:

```bash
ssh ubuntu@<YOUR_PUBLIC_IP>

# install node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm i -g pm2

# get the code
git clone https://github.com/Stewiedev-pyt/memflow.git
cd memflow
npm ci
nano .env            # paste your real keys
```

5. Run forever with pm2:

```bash
pm2 start npx --name memflow -- tsx src/index.ts
pm2 save
pm2 startup          # follow printed instruction
pm2 logs memflow     # verify 🚀 online
```

6. Optional uptime monitoring: point <https://uptimerobot.com> (free) at `http://<IP>:3000/` — you'll know if it ever dies.

---

## Option B — Cheap VPS (Hetzner/DigitalOcean/Racknerd)

Same as Option A from step 4 onward. Hetzner CX22 (~€4/mo) is plenty for hundreds of watched tokens.

---

## Option C — Docker (any host)

```bash
docker build -t memflow .
docker run -d --name memflow --env-file .env --restart unless-stopped -p 3000:3000 memflow
docker logs -f memflow
```

---

## Updating after changes

```bash
cd memflow && git pull
pm2 restart memflow        # or: docker compose up -d --build
```

## Notes

- The SQLite DB lives in `data/` — back it up occasionally (`cp data/memflow.db ~/backup-$(date +%F).db`)
- Telegram polling needs NO open inbound ports; port 3000 is only for health checks
- If Oracle rejects your card/region: Option B costs one lunch per month
