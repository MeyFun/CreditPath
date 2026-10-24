# API CreditPath

Описание API для людей. Машиночитаемая спецификация лежит в [openapi.json](openapi.json); тест `test_static_openapi_matches_application` проверяет, что файл совпадает с кодом. Интерактивная документация: http://localhost:8080/docs. Готовые запросы: [Postman-коллекция](postman/CreditPath.postman_collection.json).

## Общие правила

- Базовый адрес: `http://localhost:8080/api` (через nginx) или `http://localhost:8000/api` (backend напрямую, только `127.0.0.1`).
- Формат запросов и ответов: JSON в UTF-8. Документы загружаются как `multipart/form-data`.
- Авторизация: `POST /auth/login` возвращает `access_token`. Дальше каждый запрос передаёт заголовок `Authorization: Bearer <token>`. Срок токена задаёт `ACCESS_TOKEN_MINUTES` (60 минут по умолчанию). Самостоятельной регистрации нет: учётные записи заводит администратор банка.
- Роли: `client`, `employee`, `admin`. Роль проверяется на сервере для каждой ручки. Права на конкретную заявку проверяются отдельно: клиент видит только свои заявки, сотрудник — только назначенные ему.
- `Idempotency-Key` в `POST /client/applications/{id}/submit` защищает от двойной отправки: повтор с тем же ключом вернёт ту же заявку.
- Каждый ответ содержит `X-Request-Id`. Этот же идентификатор пишется в JSON-логи backend.

## Ошибки

Тело ошибки: `{"detail": "<понятное сообщение>"}`. Для 422 из-за формата полей тело дополнительно содержит `errors: [{field, message}]`.

| Код | Когда |
|---|---|
| 401 | Нет токена, токен истёк или неверный логин/пароль |
| 403 | Роль не позволяет действие (например, админ пытается принять кредитное решение) |
| 404 | Объект не найден или принадлежит другому пользователю (чужие заявки не раскрываются) |
| 409 | Недопустимый переход статуса или конфликт данных (например, редактирование отправленной заявки) |
| 413 / 415 | Файл больше `MAX_UPLOAD_MB` / неверный тип или сигнатура файла |
| 422 | Ошибка проверки данных: ИНН, лимиты продукта, цель, полномочия, согласия, параметры скоринга |
| 429 | Превышен лимит попыток входа; заголовок `Retry-After` |
| 503 | Реестр или БКИ временно недоступны |

## Ручки

### Авторизация (`/auth`)

| Метод и путь | Доступ | Что делает |
|---|---|---|
| `POST /auth/login` | все | Вход по логину и паролю, выдаёт JWT |
| `GET /auth/me` | вошедший | Текущий пользователь |
| `GET /auth/demo-hint` | все | Демо-учётки и пароль для страницы входа (только при `SEED_DEMO=true`) |

### Каталог и справочные данные (`/public`)

| Метод и путь | Доступ | Что делает |
|---|---|---|
| `GET /public/products` | все | Активные кредитные продукты с целями |
| `GET /public/products/{code}` | все | Один продукт по коду |
| `GET /public/payment-schedule?amount=&rate=&term_months=` | все | Аннуитетный платёж для калькулятора |
| `GET /public/registry/{inn}` | вошедший | Проверка компании по ИНН в синтетическом реестре (404 — компании нет) |

### Кабинет клиента (`/client`, только роль `client`)

| Метод и путь | Что делает |
|---|---|
| `GET /client/dashboard` | Счётчики заявок, одобренная сумма, последние заявки, компания из профиля |
| `GET /client/company` | Профиль и данные компании |
| `GET /client/applications?status_group=all\|draft\|active\|completed&search=` | Список своих заявок |
| `POST /client/applications` | Создать черновик |
| `GET /client/applications/{id}` | Карточка заявки: статус, история, документы, доступные действия (`can_*`) |
| `PUT /client/applications/{id}` | Изменить черновик |
| `DELETE /client/applications/{id}` | Удалить черновик |
| `POST /client/applications/{id}/documents?purpose=general\|power_of_attorney` | Загрузить PDF/JPEG/PNG (черновик или запрос уточнений) |
| `GET /client/applications/{id}/documents/{document_id}` | Скачать свой документ |
| `POST /client/applications/{id}/submit` | Отправить: должность, подтверждение полномочий, согласия на БКИ и ПДн. Запускает конвейер, ответ 202 |
| `POST /client/applications/{id}/respond` | Ответить на запрос уточнений: комментарий, выручка, прибыль, исправленный ИНН |
| `POST /client/applications/{id}/offer` | Принять или отклонить оферту (`{"accept": true}`) |
| `POST /client/applications/{id}/sign` | Демонстрационное подписание договора |
| `POST /client/applications/{id}/disburse` | Демонстрационное зачисление средств |
| `POST /client/applications/{id}/resubmit` | Новый черновик на основе отклонённой заявки |

### Рабочее место сотрудника (`/employee`, только роль `employee`)

| Метод и путь | Что делает |
|---|---|
| `GET /employee/stats` | Счётчики по назначенным заявкам |
| `GET /employee/applications?scope=queue\|mine&search=` | Очередь назначенных заявок |
| `GET /employee/applications/{id}` | Карточка: реестр, БКИ, скоринг, черновик решения, прошлые решения цепочки, риск-предупреждения |
| `POST /employee/applications/{id}/decision` | Решение: `approve`, `approve_changed` (сумма, срок, другой продукт), `need_info`, `reject`. Для отказа и запроса данных нужен комментарий |
| `GET /employee/applications/{id}/documents/{document_id}` | Скачать документ назначенной заявки |

### Администрирование (`/admin`, только роль `admin`)

| Метод и путь | Что делает |
|---|---|
| `GET /admin/users`, `POST /admin/users` | Список и создание клиентов и сотрудников |
| `PATCH /admin/users/{id}/role` | Смена роли клиент ↔ сотрудник |
| `GET /admin/applications`, `GET /admin/applications/{id}` | Все заявки в режиме наблюдения |
| `PATCH /admin/applications/{id}/assign` | Назначить сотрудника (с учётом «свежего взгляда» и связанных лиц) |
| `GET /admin/applications/{id}/documents/{document_id}` | Скачать документ |
| `GET /admin/audit?action=&entity_type=&actor_id=&limit=1..500&offset=` | Журнал аудита |
| `GET /admin/audit/verify` | Проверка SHA-256-цепочки аудита |
| `GET /admin/products`, `POST /admin/products`, `PATCH /admin/products/{id}` | Продукты и цели кредитования. Новый продукт сразу виден клиентам в каталоге и мастере заявки; `is_active=false` скрывает его. Цель, по которой есть незавершённые заявки, убрать нельзя (409) |
| `DELETE /admin/products/{id}` | Удалить продукт, по которому не было заявок (204). Если заявки были — 409: продукт нужно скрыть, история и аудит на него ссылаются |
| `GET /admin/scoring-config`, `GET /admin/scoring-config/history`, `POST /admin/scoring-config` | Параметры скоринга; новая версия проходит пробный расчёт перед сохранением |

Администратор не принимает кредитных решений.

### Уведомления (`/notifications`, любой вошедший)

| Метод и путь | Что делает |
|---|---|
| `GET /notifications?only_unread=&limit=1..100` | Свои уведомления и число непрочитанных |
| `POST /notifications/{id}/read` | Отметить одно прочитанным |
| `POST /notifications/read-all` | Отметить все прочитанными |

### Служебные (без префикса `/api`)

| Метод и путь | Что делает |
|---|---|
| `GET /health`, `GET /healthz` | Процесс жив |
| `GET /ready`, `GET /readyz` | База данных доступна (503, если нет) |

## Сквозной сценарий через API

1. `POST /auth/login` под `client1` / `DemoPass123!`.
2. `GET /public/products` — взять `id` продукта `OBOROT`.
3. `POST /client/applications` с `product_id`, `amount`, `term_months`, `purpose`, `company_inn=9900000017`.
4. `POST /client/applications/{id}/submit` с `Idempotency-Key` и подтверждениями. Через несколько секунд заявка в `IN_REVIEW`.
5. `POST /auth/login` под назначенным сотрудником, затем `POST /employee/applications/{id}/decision` с `{"action": "approve"}`.
6. Под `client1`: `POST .../offer` `{"accept": true}` → `POST .../sign` → `POST .../disburse`. Статус `DISBURSED`.

Полный набор сценариев: [test-scenarios.md](test-scenarios.md).
