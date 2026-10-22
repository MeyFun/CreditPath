import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  Button,
  Card,
  EmptyState,
  formatDate,
  formatMoney,
  formatShortDate,
  Input,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  StatusBadge
} from "../components/ui";
import type { ApplicationSummary } from "../types";

const FILTERS = [
  { key: "all", label: "Все заявки" },
  { key: "active", label: "В работе" },
  { key: "completed", label: "Завершённые" },
  { key: "draft", label: "Черновики" }
];

function progressFor(app: ApplicationSummary): number {
  if (app.status === "DRAFT") return 10;
  if (["SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "DECISION_DRAFT"].includes(app.status)) return 35;
  if (["IN_REVIEW", "NEED_INFO"].includes(app.status)) return 65;
  if (["APPROVED", "APPROVED_CHANGED", "OFFER_ACCEPTED"].includes(app.status)) return 85;
  if (["SIGNED"].includes(app.status)) return 95;
  return 100;
}

export default function ApplicationsPage() {
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["applications", group, search],
    queryFn: () => api.client.applications(group, search)
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Кредитный портфель"
        title="Мои заявки"
        description="Все заявки и черновики. Статус и следующий шаг видны без звонков и внешних переходов."
        actions={<Link className="btn btn-primary" to="/app/applications/new"><Plus size={17} /> Подать новую заявку</Link>}
      />
      <Card className="filter-card">
        <div className="tabs-row">
          {FILTERS.map((item) => (
            <button key={item.key} className={group === item.key ? "active" : ""} onClick={() => setGroup(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={17} />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по номеру или компании" />
        </div>
      </Card>

      {query.isLoading ? (
        <LoadingBlock />
      ) : query.isError ? (
        <Card><EmptyState title="Не удалось загрузить заявки" description="Проверьте соединение и попробуйте ещё раз." action={<Button onClick={() => query.refetch()}>Повторить</Button>} /></Card>
      ) : query.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText size={26} />}
            title={search ? "Ничего не найдено" : "В этом разделе пока пусто"}
            description={search ? "Попробуйте изменить запрос." : "Создайте заявку — это займёт около трёх минут."}
            action={!search ? <Link className="btn btn-primary" to="/app/applications/new"><Plus size={16} /> Создать заявку</Link> : undefined}
          />
        </Card>
      ) : (
        <div className="application-list">
          {query.data!.map((app) => (
            <Card className="application-card" key={app.id}>
              <div className="app-card-main">
                <div className="app-card-top">
                  <span className="file-badge"><FileText size={18} /></span>
                  <span className="app-number">№ {app.number}</span>
                  <StatusBadge status={app.status} />
                  <span className="app-date">{formatShortDate(app.submitted_at ?? app.created_at)}</span>
                </div>
                <div className="app-card-body">
                  <div>
                    <h3>{app.product.name}</h3>
                    <p>{app.purpose_label} · {app.term_months} мес. · ставка от {app.product.rate.toFixed(1).replace(".", ",")}%</p>
                    {app.status === "NEED_INFO" && <p className="warning-text">Требуется ответ на запрос уточнений</p>}
                    {app.status === "REJECTED" && <p className="muted">Решение принято. Причина доступна в карточке заявки.</p>}
                  </div>
                  <div className="app-amount">
                    <span>{app.approved_amount ? "Одобренная сумма" : "Запрошенная сумма"}</span>
                    <strong>{formatMoney(app.approved_amount ?? app.amount)}</strong>
                    {app.approved_term_months && <small>{app.approved_term_months} мес. · {app.approved_rate}%</small>}
                  </div>
                </div>
                <div className="app-card-progress">
                  <ProgressBar value={progressFor(app)} />
                  <span>{app.assigned_employee ? `Сотрудник: ${app.assigned_employee.full_name}` : app.client_status}</span>
                </div>
              </div>
              <div className="app-card-side">
                <div>
                  <span className="muted small">Обновлено</span>
                  <strong>{formatDate(app.updated_at)}</strong>
                </div>
                {app.status === "DRAFT" ? (
                  <Link className="btn btn-primary btn-sm" to={`/app/applications/new?draft=${app.id}`}>Продолжить <ArrowRight size={15} /></Link>
                ) : (
                  <Link className="btn btn-secondary btn-sm" to={`/app/applications/${app.id}`}>Открыть заявку <ArrowRight size={15} /></Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
