.PHONY: help up down build logs restart clean ps shell-backend shell-frontend \
        test-backend test-frontend prod-up prod-down \
        env env-local env-prod env-backend-local migrate migrate-local shell-db

COMPOSE ?= docker compose
COMPOSE_DEV := $(COMPOSE) --env-file .env -f docker-compose.yml
COMPOSE_PROD := $(COMPOSE) --env-file .env.prod -f docker-compose.prod.yml

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

env-local: ## Crea .env desde .env.example.local (desarrollo)
	@test -f .env || (cp .env.example.local .env && echo "Creado .env desde .env.example.local")

env-prod: ## Crea .env.prod desde .env.example.prod (producción)
	@test -f .env.prod || (cp .env.example.prod .env.prod && echo "Creado .env.prod desde .env.example.prod")

env-backend-local: ## Crea backend/.env desde backend/.env.example.local (sin Docker)
	@test -f backend/.env || (cp backend/.env.example.local backend/.env && echo "Creado backend/.env")

env: env-local ## Alias de env-local

up: env-local ## Levanta PostgreSQL + backend + frontend (desarrollo)
	$(COMPOSE_DEV) up -d --build

down: ## Detiene los servicios de desarrollo
	$(COMPOSE_DEV) down

build: env-local ## Construye las imágenes Docker (desarrollo)
	$(COMPOSE_DEV) build

logs: ## Sigue los logs de todos los servicios (desarrollo)
	$(COMPOSE_DEV) logs -f

restart: ## Reinicia todos los servicios (desarrollo)
	$(COMPOSE_DEV) restart

ps: ## Estado de los contenedores (desarrollo)
	$(COMPOSE_DEV) ps

clean: ## Detiene servicios de desarrollo y elimina volúmenes
	$(COMPOSE_DEV) down -v

migrate: env-local ## Aplica migraciones Alembic (contenedor backend, dev)
	$(COMPOSE_DEV) exec backend alembic upgrade head

migrate-local: env-backend-local ## Aplica migraciones Alembic (backend local, sin Docker)
	cd backend && alembic upgrade head

shell-backend: ## Shell en el contenedor backend (dev)
	$(COMPOSE_DEV) exec backend bash

shell-frontend: ## Shell en el contenedor frontend (dev)
	$(COMPOSE_DEV) exec frontend sh

shell-db: ## psql en PostgreSQL (desarrollo)
	$(COMPOSE_DEV) exec postgres psql -U $${POSTGRES_USER:-tys} -d $${POSTGRES_DB:-tys_dev}

test-backend: ## Ejecuta tests del backend (servicios dev deben estar up)
	$(COMPOSE_DEV) exec -e REACT_APP_BACKEND_URL=http://localhost:8000 backend pytest tests/ -v

test-frontend: ## Ejecuta tests del frontend (dev)
	$(COMPOSE_DEV) exec frontend yarn test

prod-up: env-prod ## Levanta stack de producción (nginx + uvicorn sin reload)
	$(COMPOSE_PROD) up -d --build

prod-down: ## Detiene el stack de producción
	$(COMPOSE_PROD) down

prod-logs: ## Sigue los logs del stack de producción
	$(COMPOSE_PROD) logs -f

prod-ps: ## Estado de contenedores (producción)
	$(COMPOSE_PROD) ps
