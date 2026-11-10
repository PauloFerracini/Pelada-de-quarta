#!/usr/bin/env bash
# Instala a Evolution API num servidor Ubuntu (Oracle Cloud, máquina gratuita de 1 GB).
# Uso: salve no servidor como instalar.sh e rode "bash instalar.sh". Pode rodar de novo sem perder nada.
set -euo pipefail

# 1. Memória extra em disco (a máquina gratuita tem só 1 GB de RAM).
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

# 2. Docker (instalador oficial).
if ! command -v docker > /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi

mkdir -p ~/evolution
cd ~/evolution

# 3. Configuração. Só é criada na primeira vez, para a chave não mudar a cada execução.
if [ ! -f .env ]; then
  IP=$(curl -fsS https://ifconfig.me)
  CHAVE=$(openssl rand -hex 24)
  SENHA=$(openssl rand -hex 16)
  cat > .env <<EOF
SERVER_URL=http://$IP:8080
AUTHENTICATION_API_KEY=$CHAVE
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$SENHA@evolution-postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=pelada
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
POSTGRES_PASSWORD=$SENHA
EOF
  chmod 600 .env
fi

cat > docker-compose.yml <<'EOF'
services:
  api:
    image: evoapicloud/evolution-api:latest
    restart: always
    depends_on:
      - evolution-postgres
    ports:
      - "8080:8080"
    volumes:
      - evolution_instances:/evolution/instances
    env_file:
      - .env
  evolution-postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  evolution_instances:
  postgres_data:
EOF

# 4. Sobe os serviços.
sudo docker compose up -d

echo
echo "Pronto. Anote estes dois dados:"
grep '^SERVER_URL=' .env | sed 's/^SERVER_URL=/  Endereço do servidor: /'
grep '^AUTHENTICATION_API_KEY=' .env | sed 's/^AUTHENTICATION_API_KEY=/  Chave da API:         /'
echo "Painel para ler o QR code: $(grep '^SERVER_URL=' .env | cut -d= -f2)/manager"
