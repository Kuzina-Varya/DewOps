SHELL := /bin/sh
.DEFAULT_GOAL := setup
PYTHON ?= python3
VM_NAME ?= quotes-lab3
URL ?= https://quotes.toscrape.com/scroll
export VM_NAME URL
export ANSIBLE_CONFIG := $(CURDIR)/infra/ansible/ansible.cfg
export ANSIBLE_COLLECTIONS_PATH := $(CURDIR)/.lab/collections
export ANSIBLE_HOST_KEY_CHECKING := True
VENV := .lab/venv/bin
EXAMPLE := infra/ansible/inventories/hosts.example.yml

.PHONY: setup provision deploy run verify fault-test destroy ci install test check-node lint syntax compose-check idempotence ci-vm-host ci-vm recreate-test

setup:
	$(PYTHON) tools/lab.py setup

provision: setup
	$(PYTHON) tools/lab.py provision

deploy: setup
	$(PYTHON) tools/lab.py deploy

run:
	$(PYTHON) tools/lab.py run

verify:
	$(PYTHON) tools/lab.py verify

fault-test:
	$(PYTHON) tools/lab.py fault-test

destroy:
	$(PYTHON) tools/lab.py destroy

check-node:
	$(PYTHON) tools/lab.py check-node

install: check-node
	npm ci

test: check-node
	npm test

lint: setup
	$(VENV)/yamllint .
	$(VENV)/ansible-lint

syntax: setup
	@for playbook in bootstrap site deploy run verify fault-test; do \
		$(VENV)/ansible-playbook -i $(EXAMPLE) --syntax-check infra/ansible/playbooks/$$playbook.yml || exit $$?; \
	done
	$(PYTHON) -m py_compile tools/lab.py

compose-check:
	docker compose -f deploy/compose.yaml config --quiet

ci: lint syntax compose-check install test

idempotence: setup
	$(PYTHON) tools/lab.py idempotence

# GitHub-hosted Ubuntu runner preparation, never configuration of the target VM.
ci-vm-host:
	test -c /dev/kvm
	sudo snap install multipass
	@for attempt in $$(seq 1 60); do \
		if sudo /snap/bin/multipass list --format json; then exit 0; fi; \
		sleep 2; \
	done; \
	sudo journalctl -u snap.multipass.multipassd --no-pager -n 100; exit 1

ci-vm:
	$(MAKE) provision
	$(MAKE) idempotence
	$(MAKE) run verify
	$(MAKE) fault-test

recreate-test:
	$(MAKE) destroy
	$(MAKE) provision
	$(MAKE) run verify
