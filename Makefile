.PHONY: up down logs rebuild clean-cache help

SERVICE_NAME := svc-inbox_messages
NETWORK := greenn-network

help:
	@echo "Targets disponíveis:"
	@echo "  make up            # Cria rede (se não existir) e sobe com build"
	@echo "  make down          # Para e remove os containers"
	@echo "  make logs          # Mostra logs do serviço (segue)"
	@echo "  make rebuild       # Rebuild sem cache e sobe"
	@echo "  make clean-cache   # Limpa cache de build do Docker"

up:
	@echo ">> Garantindo rede $(NETWORK)"
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)
	@echo ">> Subindo stack com build"
	@docker compose up -d --build
	@echo ">> Rodando: $(SERVICE_NAME) na rede $(NETWORK)"

down:
	@echo ">> Derrubando stack"
	@docker compose down

logs:
	@docker logs -f $(SERVICE_NAME)

rebuild:
	@echo ">> Rebuild sem cache e subir"
	@docker compose build --no-cache
	@docker compose up -d

clean-cache:
	@echo ">> Limpando cache de build do Docker"
	@docker builder prune -f
