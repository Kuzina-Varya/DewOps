COMPOSE := docker compose
TF ?= $(COMPOSE) run --rm terraform

.PHONY: install build provision deploy run clean destroy ci fmt validate lock test logs check-plan

install:
	npm ci

build:
	$(COMPOSE) build scraper

provision: build
	$(COMPOSE) up -d floci
	$(COMPOSE) run --rm tools wait
	$(TF) init -input=false -lockfile=readonly
	$(TF) apply -input=false -auto-approve
	$(COMPOSE) run --rm --entrypoint sh terraform -c 'terraform output -json > /infra/outputs.json'
	$(COMPOSE) run --rm tools configure

deploy: provision
	$(COMPOSE) up -d --build scraper

run:
	$(COMPOSE) run --rm tools run

destroy: build
	$(COMPOSE) stop scraper
	$(COMPOSE) up -d floci
	$(COMPOSE) run --rm tools wait
	$(TF) init -input=false -lockfile=readonly
	$(TF) destroy -input=false -auto-approve
	$(COMPOSE) down --volumes --remove-orphans

clean: destroy
	$(COMPOSE) run --rm --no-deps tools clean
	$(COMPOSE) down --volumes --remove-orphans

fmt:
	$(TF) fmt -recursive

lock:
	$(TF) init -input=false
	$(TF) providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64

validate:
	$(TF) fmt -check -recursive
	$(TF) init -backend=false -input=false -lockfile=readonly
	$(TF) validate

test:
	npm test

check-plan:
	$(TF) plan -input=false -detailed-exitcode

logs:
	$(COMPOSE) logs scraper floci

ci: validate deploy check-plan run
