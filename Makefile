.PHONY: up down logs logs-claim rebuild clean-cache mobile mobile-all help

SERVICE_NAME := svc-inbox_messages
CLAIM_SERVICE_NAME := svc-claim-page
NETWORK := greenn-network

# IP da maquina na rede local (Linux e macOS). Sobrescreva com: make mobile LAN_IP=192.168.0.10
LAN_IP ?= $(shell (ip -4 -o addr show scope global 2>/dev/null | grep -vE ' (docker|br-|veth)' | awk '{print $$4}' | cut -d/ -f1; ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null) | head -1)

# Repositorios vizinhos usados por `make mobile-all` (nao sao alterados: os overrides vivem em ./mobile)
ADM_DIR      ?= ../greenn-local/greenn-adm
CHECKOUT_DIR ?= ../greenn-local/new-checkout

help:
	@echo "Targets disponíveis:"
	@echo "  make up            # Cria rede (se não existir) e sobe inbox_messages + claim_page com build"
	@echo "  make down          # Para e remove os containers"
	@echo "  make logs          # Mostra logs do inbox_messages (segue)"
	@echo "  make logs-claim    # Mostra logs da página de reclamação (segue)"
	@echo "  make rebuild       # Rebuild sem cache e sobe"
	@echo "  make clean-cache   # Limpa cache de build do Docker"
	@echo "  make mobile        # Sobe com o IP da LAN preenchido (pagina de QR Code)"
	@echo "  make mobile-all    # mobile + reconfigura adm e new-checkout para o IP da LAN"

up:
	@echo ">> Garantindo rede $(NETWORK)"
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)
	@echo ">> Subindo stack com build (inbox_messages :8115 + claim_page :6002)"
	@docker compose up -d --build
	@echo ">> Rodando: $(SERVICE_NAME) e $(CLAIM_SERVICE_NAME) na rede $(NETWORK)"

mobile:
	@if [ -z "$(LAN_IP)" ]; then echo ">> Nao foi possivel detectar o IP da LAN. Use: make mobile LAN_IP=192.168.0.10"; exit 1; fi
	@echo ">> Garantindo rede $(NETWORK)"
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)
	@echo ">> Subindo inbox_messages com LAN_HOST=$(LAN_IP)"
	@LAN_HOST=$(LAN_IP) docker compose up -d --build
	@echo ">> QR Code: http://$(LAN_IP):8115/qrcode.html"

mobile-all: mobile
	@if [ -d "$(ADM_DIR)" ]; then \
		echo ">> Reconfigurando greenn-adm para $(LAN_IP)"; \
		LAN_IP=$(LAN_IP) docker compose -f $(ADM_DIR)/docker-compose.dev.yml -f $(CURDIR)/mobile/adm.override.yml up -d; \
	else \
		echo ">> [skip] greenn-adm nao encontrado em $(ADM_DIR) (use ADM_DIR=...)"; \
	fi
	@if [ -d "$(CHECKOUT_DIR)" ]; then \
		echo ">> Reconfigurando new-checkout para $(LAN_IP)"; \
		LAN_IP=$(LAN_IP) docker compose -f $(CHECKOUT_DIR)/local.docker-compose.yaml -f $(CURDIR)/mobile/checkout.override.yml up -d; \
	else \
		echo ">> [skip] new-checkout nao encontrado em $(CHECKOUT_DIR) (use CHECKOUT_DIR=...)"; \
	fi
	@echo ""
	@echo ">> Pronto (celular na mesma rede Wi-Fi):"
	@echo ">>   QR Code:  http://$(LAN_IP):8115/qrcode.html"
	@echo ">>   adm:      http://$(LAN_IP):8080"
	@echo ">>   checkout: http://$(LAN_IP):3000/<hash-da-oferta>"
	@echo ">> Lembre: greenn-back (81) e gateway (82) precisam estar de pe."

down:
	@echo ">> Derrubando stack"
	@docker compose down

logs:
	@docker logs -f $(SERVICE_NAME)

logs-claim:
	@docker logs -f $(CLAIM_SERVICE_NAME)

rebuild:
	@echo ">> Rebuild sem cache e subir"
	@docker compose build --no-cache
	@docker compose up -d

clean-cache:
	@echo ">> Limpando cache de build do Docker"
	@docker builder prune -f
