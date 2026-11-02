IMAGE_NAME := dewops-quotes
OUTPUT_DIR := $(CURDIR)/out

.PHONY: install test build run clean ci

install:
	npm install

test:
	npm test

build:
	docker build --tag $(IMAGE_NAME) .

run: deploy
	docker compose run --rm --no-deps scraper node src/submit.js
	docker compose logs --tail=30 scraper


clean:
	-docker image rm -f $(IMAGE_NAME)
	git clean -fdX -- out


ci:
	npm ci
	npm test
	docker compose up -d --wait floci
	docker compose run --rm terraform init -input=false -lockfile=readonly
	docker compose run --rm terraform fmt -check -recursive
	docker compose run --rm terraform validate -no-color
	docker compose run --rm terraform plan -input=false -no-color


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


.PHONY: aws-deps

aws-deps:
	npm install @aws-sdk/client-sqs @aws-sdk/client-s3


.PHONY: deploy worker-status worker-logs

deploy: provision
	docker compose up -d --build scraper

worker-status:
	docker compose ps scraper

worker-logs:
	docker compose logs --tail=50 scraper


.PHONY: destroy

destroy:
	docker compose stop scraper
	docker compose up -d --wait floci
	docker compose run --rm terraform init -input=false
	docker compose run --rm terraform destroy -input=false -auto-approve
	docker compose down


.PHONY: infra-fmt

infra-fmt:
	docker compose run --rm terraform fmt -recursive
