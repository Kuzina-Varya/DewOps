IMAGE_NAME := dewops-quotes
OUTPUT_DIR := $(CURDIR)/out

.PHONY: install test build run clean ci

install:
	npm install

test:
	npm test

build:
	docker build --tag $(IMAGE_NAME) .

run:
	docker run --rm \
		--volume "$(OUTPUT_DIR):/app/out" \
		$(IMAGE_NAME)

clean:
	-docker image rm -f $(IMAGE_NAME)
	git clean -fdX -- out

ci: clean build run

.PHONY: floci-up floci-status

floci-up:
	docker compose up -d floci

floci-status:
	docker compose ps floci


.PHONY: provision infra-plan

provision:
	docker compose up -d --wait floci
	docker compose run --rm terraform init -input=false
	docker compose run --rm terraform apply -input=false -auto-approve

infra-plan:
	docker compose run --rm terraform plan -input=false


.PHONY: registry-check

registry-check:
	docker compose run --rm --entrypoint /bin/sh terraform -c "wget -S -O - https://registry.terraform.io/.well-known/terraform.json"


.PHONY: registry-host-check

registry-host-check:
	curl.exe -sS -i --max-time 20 https://registry.terraform.io/.well-known/terraform.json


.PHONY: proxy-check

proxy-check:
	@echo Windows proxy variables:
	@powershell.exe -NoProfile -Command "Get-ChildItem Env: | Where-Object Name -Match 'proxy' | Select-Object -ExpandProperty Name"
	@echo Docker container proxy variables:
	@docker compose run --rm --entrypoint /bin/sh terraform -c "env | grep -i proxy | cut -d= -f1"
