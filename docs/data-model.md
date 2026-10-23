# Модель данных

```mermaid
erDiagram
    USERS ||--o{ APPLICATIONS : "подаёт"
    USERS ||--o{ APPLICATIONS : "назначен / решил"
    USERS ||--o{ NOTIFICATIONS : "получает"
    USERS ||--o{ DOCUMENTS : "загружает"
    USERS ||--o{ IDEMPOTENCY_RECORDS : "владеет"
    PRODUCTS ||--o{ APPLICATIONS : "определяет условия"
    APPLICATIONS ||--o{ DOCUMENTS : "содержит"
    APPLICATIONS ||--o{ APPLICATION_EVENTS : "история"
    APPLICATIONS ||--o| ENRICHMENT_SNAPSHOTS : "снимок проверок"
    APPLICATIONS ||--o{ NOTIFICATIONS : "связанные"
    APPLICATIONS ||--o{ APPLICATIONS : "previous_application_id"
    SCORING_CONFIGS }o--|| USERS : "создал версию"
    USERS ||--o{ USERS : "связанное лицо"

    USERS {
        int id PK
        string username UK
        string password_hash
        string full_name
        string role "client | employee | admin"
        string company_inn
        int related_employee_id FK "связанное лицо сотрудника"
        bool is_active
        datetime created_at
        datetime last_login_at
    }

    PRODUCTS {
        int id PK
        string code UK
        string name
        numeric min_amount
        numeric max_amount
        int min_term_months
        int max_term_months
        numeric rate
        int min_business_age_months
        bool requires_collateral
        numeric revenue_limit_ratio
        json purposes
        bool is_active
        int sort_order
    }

    APPLICATIONS {
        int id PK
        string public_number UK
        int user_id FK
        int product_id FK
        string company_inn
        string company_name
        numeric amount
        int term_months
        string purpose
        bool collateral
        string status
        int previous_application_id FK
        int assigned_employee_id FK
        string queue_reason
        int scoring_score
        json scoring_result
        json decision_draft
        string final_outcome
        numeric approved_amount
        int approved_term_months
        numeric approved_rate
        text employee_comment
        int decision_by_id FK
        numeric declared_revenue
        numeric declared_profit
        text client_comment
        datetime offer_expires_at
        datetime submitted_at
        datetime signed_at
        datetime disbursed_at
        datetime created_at
        datetime updated_at
    }

    DOCUMENTS {
        int id PK
        int application_id FK
        int uploaded_by_id FK
        string original_name
        string stored_name UK
        string content_type
        int size_bytes
        datetime created_at
    }

    APPLICATION_EVENTS {
        int id PK
        int application_id FK
        string event_type
        string status_from
        string status_to
        int actor_id FK
        string actor_role
        text comment
        json details
        datetime created_at
    }

    ENRICHMENT_SNAPSHOTS {
        int id PK
        int application_id FK
        json registry_data
        json bki_data
        bool registry_ok
        bool bki_ok
        json errors
        datetime fetched_at
    }

    NOTIFICATIONS {
        int id PK
        int user_id FK
        int application_id FK
        string title
        text body
        string kind
        bool is_read
        datetime created_at
    }

    SCORING_CONFIGS {
        int id PK
        int version UK
        json config
        bool is_active
        int created_by_id FK
        datetime created_at
    }

    IDEMPOTENCY_RECORDS {
        int id PK
        int user_id FK
        string key
        string action
        int application_id FK
        datetime created_at
    }

    AUDIT_LOG {
        bigint id PK
        datetime created_at
        int actor_id
        string actor_label
        string action
        string entity_type
        string entity_id
        json before
        json after
        string previous_hash
        string entry_hash UK
    }
```

`AUDIT_LOG` намеренно не имеет внешних ключей: записи должны переживать изменения и деактивацию пользователей.

## Ограничения и индексы

- `users.username` — уникальный.
- `applications.public_number` — уникальный; составные индексы `(status, created_at)` и `(company_inn, status)`, отдельные индексы по пользователю, продукту, сотруднику и `final_outcome`.
- `documents.stored_name` — уникальное имя в томе.
- `enrichment_snapshots.application_id` — один актуальный снимок на заявку; история изменений заявки остаётся в событиях.
- `idempotency_records` — уникальная тройка `(user_id, key, action)`.
- `scoring_configs.version` — уникальная версия, одна активная версия.
- `audit_log.entry_hash` — уникальный; переходы статусов фиксируются в одной транзакции с записью аудита.
- Триггер `audit_log_append_only` запрещает `UPDATE` и `DELETE` на `audit_log` в PostgreSQL.

## Снимки внешних данных

`registry_data` и `bki_data` — полные ответы мок-сервисов на момент проверки. Это позволяет сотруднику видеть именно те данные, на основании которых сформировано предварительное решение, даже если источник позже изменится. Заявленные клиентом финансовые показатели хранятся отдельно (`declared_revenue`, `declared_profit`) и явно помечаются `financial_source = client_declared`.
