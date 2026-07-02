.PHONY: up down logs logs-claim rebuild clean-cache help

SERVICE_NAME := svc-inbox_messages
CLAIM_SERVICE_NAME := svc-claim-page
NETWORK := greenn-network

help:
	@echo "Targets disponíveis:"
	@echo "  make up            # Cria rede (se não existir) e sobe inbox_messages + claim_page com build"
	@echo "  make down          # Para e remove os containers"
	@echo "  make logs          # Mostra logs do inbox_messages (segue)"
	@echo "  make logs-claim    # Mostra logs da página de reclamação (segue)"
	@echo "  make rebuild       # Rebuild sem cache e sobe"
	@echo "  make clean-cache   # Limpa cache de build do Docker"

up:
	@echo ">> Garantindo rede $(NETWORK)"
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)
	@echo ">> Subindo stack com build (inbox_messages :8115 + claim_page :6002)"
	@docker compose up -d --build
	@echo ">> Rodando: $(SERVICE_NAME) e $(CLAIM_SERVICE_NAME) na rede $(NETWORK)"

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
