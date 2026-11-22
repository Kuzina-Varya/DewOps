# Лабораторная работа 3: Ubuntu, Ansible и Redis Streams

Скрапер из предыдущих работ собирает цитаты через Playwright. Multipass создаёт
одну VM Ubuntu 24.04 (2 CPU, 4 ГБ RAM, диск 20 ГБ). Cloud-init делает только
bootstrap: временный пользователь `ubuntu`, SSH-ключ, sudo и Python. Дальнейшая
настройка VM выполняется исключительно Ansible playbook-ами.

```mermaid
flowchart LR
    M[Make на POSIX control node] --> MP[Multipass: Ubuntu 24.04]
    M --> A[Ansible по SSH с проверкой host key]
    A --> VM[Конфигурация VM и Docker Compose]
    R[make run] --> S[Redis Stream jobs / group scrapers]
    S --> W[Playwright worker]
    W --> F[/srv/quotes-scraper/results/job_id.json]
    W --> ACK[XACK после успешной записи]
    F --> N[Nginx: read-only bind mount]
    N --> HTTP[HTTP :80 /results/job_id.json]
```

Redis не публикует порт на VM и находится во внутренней Docker-сети. AOF с
`appendfsync always` хранится в named volume. Worker имеет отдельную сеть для
доступа к сайту. Из портов Compose наружу публикуется только HTTP `80` Nginx.
SSH `22` — системный сервис VM для Ansible, не контейнерный порт.

## Требования к host и control node

- Host с аппаратной виртуализацией и работающим Multipass. Нужны минимум 2 свободных
  CPU, 4 ГБ RAM для гостя и место под диск 20 ГБ, Ubuntu image и Docker-образы.
- POSIX control node: Linux, macOS либо **WSL2 на Windows**; GNU Make, Python 3.11+
  с модулем venv/pip и OpenSSH client (`ssh`, `ssh-keygen`). Для `make ci` также нужны
  Node.js 22+ и Docker с Compose plugin на control node.
- Windows: Multipass установлен на Windows; Make, Python и Ansible запускаются
  **из WSL2**. Храните checkout в Linux-файловой системе (`~/DewOps`), чтобы SSH-ключи
  имели правильные POSIX-права. Не запускайте эти Make targets в PowerShell.
- Control node должен иметь маршрут до IPv4 VM и доступ к SSH/HTTP. VPN и firewall
  не должны блокировать сеть Multipass. Интернет нужен для Ubuntu, apt Docker,
  npm, Python/Ansible collections и https://quotes.toscrape.com.
- В решении нет привязки к amd64/arm64: Multipass выбирает образ для host,
  Debian architecture определяется через `dpkg --print-architecture`, образы
  Redis/Nginx/Node используются без `platform:`.

На Ubuntu control host, если Multipass daemon требует прав sudo, передайте
`MULTIPASS_SUDO=1` всем Make-командам; так работает VM job в CI. Это повышает
права только клиента Multipass на control host, Ansible подключается к VM по
собственному SSH-ключу и выполняет дальнейшую настройку под `admin`.

В WSL скрипт автоматически ищет `multipass.exe`, включая стандартный путь
`/mnt/c/Program Files/Multipass/bin/multipass.exe`. При другой установке передайте
путь переменной `MULTIPASS`. Cloud-init передаётся в stdin `multipass.exe`, поэтому
Windows-сервису не требуется читать Linux-путь или UNC-путь из WSL.

Если VPN пропускает соединение Windows → VM, но блокирует WSL → VM, включите
транспорт через Windows, сохраняя VPN подключённым:

```sh
export WSL_WINDOWS_RELAY=1
make provision
make run verify
make fault-test
```

`make setup` автоматически компилирует небольшой TCP relay из
`tools/windows-tcp-relay.cs` штатным компилятором .NET Framework на Windows.
Бинарник находится только в `.lab/`. Relay передаёт байты SSH через сетевой стек
Windows; Ansible, SSH-ключи и проверка закреплённого host key остаются в WSL.
Проверка HTTP использует временный локальный SSH-туннель к опубликованному порту
Nginx на VM; туннель закрывается после проверки. Redis наружу не открывается.
Переменная должна быть задана для всех команд работы с этим окружением.

## Запуск: только Makefile

```sh
make setup
make provision
make provision                  # повторно: changed=0 failed=0 unreachable=0
make deploy                     # применить новые исходники/конфигурацию
make deploy                     # без изменений: changed=0
make run URL=https://quotes.toscrape.com/scroll
make verify
make fault-test
make destroy
make destroy                    # безопасный повтор
```

`make setup` создаёт `.lab/venv`, устанавливает закреплённые control dependencies
и collections из `infra/ansible/requirements.yml`. Пакеты приложения и Docker
не устанавливаются на VM через cloud-init. `setup` не создаёт VM.

`make provision` из чистого состояния генерирует Ed25519-ключ, создаёт VM, ждёт
cloud-init, закрепляет host key и генерирует inventory. Затем `site.yml` создаёт
`admin`, действительно закрывает bootstrap SSH-соединение, открывает новое под
`admin` и проверяет `id -un` **без sudo**. Только после этого закрывается bootstrap
вход и применяется SSH hardening. Повторный provision использует `admin`.

`make deploy` требует созданную VM и выполняет роль scraper. Docker image
пересобирается handler-ом только при изменении входных файлов. При неизменных
файлах Compose проверяет уже запущенные контейнеры без rebuild/restart.

`make run` генерирует UUID `job_id`, отправляет **одно** сообщение с полями
`job_id` и `url` в stream `jobs` и сохраняет идентификатор в `.lab/last-job.json`.
`make verify` проверяет именно этот результат, а не любой JSON в каталоге:
валидный непустой массив, отсутствие временного файла, совпадение файла с HTTP,
пустой XPENDING и отсутствие ещё не доставленных заданий (group lag=0).
Есть 60 попыток с паузами 2 секунды; HTTP-запросы имеют timeout. Запускайте эти
сценарии последовательно: проверка предполагает очередь без посторонних заданий.
`verify` также проверяет sshd policy, отсутствие `admin` в docker group,
неопубликованный Redis и read-only mount Nginx.

После `make destroy` удаляются **только эта VM** и локальные `.lab/` и generated
inventory. Команда не использует глобальный `multipass purge` и не трогает другие VM.
Все результаты и Redis volume внутри удаляемой VM теряются. Новое `make provision`
восстанавливает окружение с новым ключом и новым host key.

Имя VM по умолчанию — `quotes-lab3`. Для другого имени используйте одинаковый
`VM_NAME=...` на всех командах. Скрипт отказывается захватывать уже существующую
VM без соответствующего локального ownership marker.

## Проверка сбоя

`make fault-test` выполняет отдельный Ansible playbook:

1. Проверяет пустую очередь и создаёт локальный тестовый gate для нового job_id.
2. Реальный worker читает сообщение, атомарно сохраняет JSON и останавливается
   непосредственно перед XACK. Файл `.ready` доказывает достижение этой точки.
3. Ansible посылает контейнеру **SIGKILL**, проверяет остановку процесса и доказывает,
   что **тот же stream entry ID** остаётся в PEL.
4. Удаляет gate и запускает контейнер. Новый consumer имеет другое имя и через
   XAUTOCLAIM получает зависшее задание. Готовый файл проверяется и подтверждается.
5. Повторно отправляет тот же job_id отдельным XADD. Проверяет обработку, пустую PEL,
   lag=0 и неизменность SHA-256 и inode исходного файла: второй файл не создаётся,
   первый не заменяется и не повреждается.

В блоке `always` Ansible убирает gate и запускает worker даже при ошибке теста.
Тестовый gate — файл внутри VM; он не включается полями задания и не доступен
через HTTP. Результаты теста и Ansible recap видны в `.lab/logs/fault-test.log`.

## Все Make targets

| Target | Назначение |
| --- | --- |
| `setup` | POSIX venv и Ansible collections |
| `provision` | Multipass + cloud-init bootstrap + полный site playbook |
| `deploy` | Роль scraper: исходники, Compose и handlers |
| `run` | Один новый UUID и одно сообщение XADD |
| `verify` | Системные проверки и конкретный JSON через HTTP |
| `fault-test` | SIGKILL до XACK, reclaim и повторная доставка |
| `destroy` | Удаление VM, `.lab/` и inventory; повторяемый |
| `ci` | YAML, ansible-lint, syntax-check с example inventory, Compose config, unit tests |
| `install` | npm ci на control node для unit tests |
| `test` | Node.js unit tests после install |
| `lint` | setup, yamllint и ansible-lint |
| `syntax` | setup, syntax-check всех playbook-ов, компиляция Python |
| `compose-check` | docker compose config без запуска контейнеров |
| `idempotence` | Повторный provision и deploy с автоматической проверкой changed=0 |
| `ci-vm-host` | Установка Multipass через snap на Ubuntu CI host с KVM |
| `ci-vm` | provision, idempotence, run, verify и fault-test на реальной VM |
| `recreate-test` | destroy, создание новой VM, run и verify |

GitHub Actions вызывает `make ci`, устанавливает collections из requirements.yml,
использует `hosts.example.yml` для syntax-check. Отдельный job на Ubuntu control
host выполняет `make ci-vm`, затем проверяет пересоздание VM и дважды destroy.
В artifacts сохраняются только `.lab/logs/`, **не приватные ключи**. PR из
`feat/ansible-deploy` в `main` до защиты не сливается.

## Границы ответственности и вопросы к защите

Cloud-init нужен только для первого входа и Python, который нужен модулям Ansible.
Пакеты Docker, постоянный пользователь, SSH policy, файлы приложения и работа
с Compose описаны ролями. Playbook задаёт порядок применения ролей и сценарий;
роль объединяет задачи, handlers и defaults одного компонента.

Ansible проверяет фактическое состояние: `state: present`, checksums файлов,
пакеты и службы. Поэтому второй запуск ничего не меняет. Изменения source/config
вызывают handler, а не безусловный rebuild. Временному пользователю не нужен
доступ после подтверждённого входа `admin`; `sshd -t` проверяет синтаксис до reload,
handler проверяет всю конфигурацию. Запрещены root, password и keyboard-interactive
входы. Host key получен по доверенному каналу Multipass до hardening и закреплён
в `.lab/known_hosts`; StrictHostKeyChecking остаётся включённым. При неожиданной
смене host key надо выяснить причину и пересоздать lab, а не отключать проверку.

`admin` не входит в группу `docker`: доступ к Docker socket фактически даёт root
через privileged container и mount файловой системы host. Ansible использует
явный `become` и sudo для операций Docker.

В Redis List после BLPOP сообщение уже удалено, поэтому падение worker теряет
задание. Consumer group Streams сохраняет доставленную, но не подтверждённую
запись в PEL: stream ID, consumer, idle time и счётчик доставок. После простоя
15 секунд другой consumer получает её через XAUTOCLAIM. Во время обработки
worker продлевает idle clock heartbeat-ом. Stream не обрезается, пока задания
могут понадобиться; политика retention для длительной эксплуатации — отдельная задача.

JSON пишется во временный файл **того же каталога**, выполняется fsync файла,
rename и fsync каталога. Затем XACK. До rename Nginx не видит частично записанный
финальный JSON, временные и dot-файлы закрыты Nginx. После сбоя до XACK повторная
обработка проверяет готовый файл и подтверждает задание без перезаписи. После
сбоя до rename оставшиеся временные файлы убираются при старте единственного
worker. Решение рассчитано на **одну реплику worker**, без масштабирования Compose.
Это at-least-once доставка с идемпотентным результатом по job_id.

AI сначала проверял только XPENDING=0. Это могло ошибочно принять повторную
доставку до того, как worker вообще прочёл новый XADD: сообщение ещё не pending.
При разборе fault-test добавлена проверка group lag=0 вместе с PEL и сравнением
SHA-256/inode. Теперь такой ранний успешный результат проверки невозможен.

Terraform-конфигурация прошлой лабораторной оставлена в `infra/*.tf` как история;
эта работа не запускает Floci/S3/SQS. Полная версия лабораторной 2 — в
[PR №1](https://github.com/Kuzina-Varya/DewOps/pull/1).

Документация: [Multipass](https://canonical.com/multipass/docs/),
[Docker Engine для Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Compose в Ansible](https://docs.ansible.com/projects/ansible/latest/collections/community/docker/docker_compose_v2_module.html),
[Redis XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/).
