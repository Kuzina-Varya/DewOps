
# DewOps — Scraper with Terraform, SQS and S3

## Описание

Проект собирает цитаты с quotes.toscrape.com/scroll
с помощью Playwright.

Инфраструктура разворачивается локально через Docker,
Floci 2.2.0 и Terraform.

## Архитектура

1. Terraform создаёт S3 bucket и SQS queue в Floci.
2. Worker запускается в Docker и ожидает задания.
3. Команда make run отправляет задание в SQS.
4. Worker получает URL и собирает цитаты через Playwright.
5. Результат сохраняется в S3 в формате JSON.
6. Только после успешной записи worker удаляет сообщение из SQS.

## Требования

- Docker Desktop с Docker Compose
- GNU Make
- Node.js 22 и npm
- Git

## Команды

### Создать инфраструктуру

    make provision

Запускает Floci, инициализирует Terraform и создаёт S3 и SQS.
Повторный запуск не должен изменять инфраструктуру.

### Запустить скрапер

    make deploy

Собирает Docker-образ и запускает worker.

### Отправить задание

    make run

Отправляет одно задание в SQS и ожидает появления валидного
непустого JSON в S3.

### Проверить план Terraform

    make infra-plan

Показывает планируемые изменения инфраструктуры.

### Проверить проект

    make ci

Выполняет проверку JavaScript, terraform fmt,
terraform validate и terraform plan.

### Очистить локальные артефакты

    make clean

Удаляет временные результаты и локальный Docker-образ.

### Уничтожить инфраструктуру

    make destroy

Останавливает worker, удаляет ресурсы Terraform
и останавливает Docker Compose.

Повторный запуск должен завершаться без ошибки.

## Ресурсы

S3 bucket: dewops-scraper-results

SQS queue: dewops-scraper-tasks

Floci endpoint внутри Docker: http://floci:4566

## Terraform State

Terraform использует локальный backend.
Состояние хранится в infra/terraform.tfstate.

Файл состояния не коммитится в Git.

Файл infra/.terraform.lock.hcl коммитится,
поскольку фиксирует версии провайдеров.

## Обработка ошибок

Если скрапинг или загрузка результата в S3 завершается ошибкой,
сообщение не удаляется из SQS.

После истечения visibility timeout сообщение
может быть обработано повторно.

Идентификатор taskId используется для формирования
ключа объекта S3, что позволяет избежать создания
неограниченного количества дубликатов одного задания.

## CI

GitHub Actions вызывает make ci при push и pull request.

## Ветки

main — первая лабораторная.

feat/terraform-infra — лабораторная с Terraform, SQS и S3.
