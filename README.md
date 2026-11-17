# Лабораторная работа 2: Terraform, SQS и S3

Скрапер из первой лабораторной собирает цитаты с динамической страницы
https://quotes.toscrape.com/scroll через Playwright. Теперь он постоянно читает
задания из SQS, записывает массив цитат в S3 и только затем удаляет сообщение.
Локальное AWS-совместимое облако — `floci/floci:2.2.0`.

## Требования и запуск

Нужны Docker с Compose **2.24+**, GNU Make, доступ в интернет и свободный порт 4566.
На Windows команды запускаются из WSL2 с Docker Desktop. Terraform 1.9.8 запускается
контейнером: устанавливать Terraform и AWS CLI на хост не требуется.
Все операции проекта выполняются через Makefile:

```sh
make provision   # образ приложения, Floci, init/apply, экспорт ресурсов
make provision   # повторный apply не меняет ресурсы
make check-plan  # код 0: изменений нет; код 2: обнаружен drift
make deploy      # provision, сборка и запуск постоянного worker
make run         # одно задание, ожидание и проверка S3 JSON и пустой очереди
make logs        # журналы Floci и worker
make destroy     # остановить worker, удалить S3/SQS через Terraform, остановить Compose
make destroy     # повторный вызов тоже успешен
```

`make run` требует предварительного `make deploy`. Для каждого задания генерируется
UUID, ключ результата — `<UUID>.json`. После проверки файл также сохраняется как
`out/result.json`. Проверка ожидает пустую очередь, поэтому запускайте её последовательно,
без посторонних заданий. Предел ожидания — 240 секунд; ошибка завершается ненулевым кодом.
Endpoint, регион, тестовые AWS credentials передаются через окружение Compose;
`S3_BUCKET` и `SQS_QUEUE_URL` генерируются из Terraform outputs в `out/resources.env`.
В коде приложения endpoint не зашит. Тестовые credentials предназначены только для Floci.

## Остальные команды

```sh
make build       # собрать Docker-образ
make test        # Node.js-тесты (на хосте нужны Node.js 22+ и установленные зависимости)
make fmt         # исправить форматирование Terraform
make validate    # fmt -check, init с readonly lock, validate
make lock        # обновить lock и checksums Linux/Windows/macOS ARM
make ci          # validate, deploy, plan без изменений, end-to-end run
make clean       # destroy и очистка out/
```

CI вызывает `make ci`, отдельно повторяет provision/plan и дважды destroy.
Открытый PR `feat/terraform-infra` → `main` до защиты не сливается.

## Состояние и зависимости

Terraform хранит локальное состояние в `infra/terraform.tfstate`: оно связывает
декларации с реальными ресурсами. Сохраняйте его между provision и destroy.
Удаление state до destroy оставит ресурсы без управления. `plan` сравнивает код,
state и фактические ресурсы; `apply` выполняет изменения. Повторный plan после
успешного apply показывает отсутствие изменений. Ручное изменение ресурса вызывает
drift, который следующий plan обнаруживает, а apply исправляет согласно коду.

Bucket и queue независимы друг от друга. Worker зависит от обоих: `deploy` зависит
от `provision` в Makefile; outputs создаются только после apply и передаются worker
как переменные окружения. Terraform выражает зависимости outputs ссылками на ресурсы.
Compose DNS позволяет контейнерам обращаться к Floci по `http://floci:4566`.
Адрес `localhost:4566` на хосте — другой сетевой контекст.

Сообщение становится невидимым на 180 секунд. При ошибке браузера, JSON или S3
worker не подтверждает сообщение, и по истечении visibility timeout SQS выдаёт его
снова. После успешной записи вызывается DeleteMessage. Если процесс упадёт между
записью и подтверждением, повторная обработка перезапишет тот же ключ UUID:
это доставка как минимум один раз, а не гарантия однократного выполнения.
Для задач длиннее 180 секунд нужен heartbeat продления visibility timeout.

`destroy` удаляет и непустой bucket (`force_destroy = true`), поэтому результаты
будут потеряны. Затем удаляются контейнеры и сеть. Для повторного destroy Floci
запускается снова, пустой Terraform state обрабатывается без ошибки.

В Git входят `.tf` и `.terraform.lock.hcl`; не входят `.terraform/`, state и backup,
планы, `.tfvars`, `.env`, `node_modules/` и `out/`. `make clean` удаляет локальные
экспортированные параметры и результаты. Floci не предназначен для хранения production-данных.

## Подготовка к защите: ошибка агента

При проверке реализации была замечена проблема: обязательный `env_file` worker
мешает даже первому запуску Compose, пока Terraform ещё не создал файл. Исправлено
на `required: false` (Compose 2.24+); сам worker проверяет обязательные параметры
при старте. Это проверяется запуском CI с чистого checkout.

Другой важный сценарий — сбой записи S3: тесты проверяют, что DeleteMessage
не вызывается при ошибке записи или скрапера. End-to-end CI проверяет реальный
непустой JSON в S3 и отсутствие доступных, отложенных и невидимых сообщений SQS.

Документация: [Floci](https://github.com/floci-io/floci),
[AWS provider](https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs).
