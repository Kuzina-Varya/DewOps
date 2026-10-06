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