import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  Badge,
  Card,
  EmptyState,
  formatMoney,
  formatShortDate,
  Input,
  LoadingBlock,
  PageHeader,
  StatusBadge
} from "../components/ui";

export default function StaffQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get("scope") === "mine" ? "mine" : "queue";
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState("all");
  const stats = useQuery({ queryKey: ["employee-stats"], queryFn: api.employee.stats });
  const deferredSearch = useDeferredValue(search.trim());
  const applications = useQuery({
    queryKey: ["employee-applications", scope, deferredSearch],
    queryFn: () => api.employee.applications(scope, deferredSearch),
    placeholderData: keepPreviousData,
    refetchInterval: 15000
  });
  const filtersActive = Boolean(deferredSearch) || risk !== "all";

  const filtered = (applications.data ?? []).filter((app) => {
    if (risk === "high") return (app.scoring_score ?? 100) < 40;
    if (risk === "medium") return (app.scoring_score ?? 100) >= 40 && (app.scoring_score ?? 100) < 70;
    if (risk === "low") return (app.scoring_score ?? 0) >= 70;
    return true;
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Рабочее место сотрудника"
        title="Очередь заявок"
      />
      <div className="kpi-grid staff-kpi">
        <Card className="kpi-card"><span className="kpi-icon kpi-icon-red"><FileText size={20} /></span><div><span>В очереди</span><strong>{stats.data?.in_review ?? "—"}</strong><small>Ожидают решения</small></div></Card>
        <Card className="kpi-card"><span className="kpi-icon kpi-icon-amber"><Clock3 size={20} /></span><div><span>Ждут клиента</span><strong>{stats.data?.need_info ?? "—"}</strong><small>Запрошены уточнения</small></div></Card>
        <Card className="kpi-card"><span className="kpi-icon kpi-icon-blue"><ShieldCheck size={20} /></span><div><span>Всего назначено</span><strong>{stats.data?.total_assigned ?? "—"}</strong><small>За всё время</small></div></Card>
        <Card className="kpi-card"><span className="kpi-icon kpi-icon-green"><CheckCircle2 size={20} /></span><div><span>Одобрено</span><strong>{formatMoney(stats.data?.approved_total)}</strong><small>Сумма по решениям</small></div></Card>
      </div>

      <div className="queue-toolbar">
        <div className="tabs-row">
          <button className={scope === "queue" ? "active" : ""} onClick={() => setSearchParams({})}>В работе</button>
          <button className={scope === "mine" ? "active" : ""} onClick={() => setSearchParams({ scope: "mine" })}>Все мои заявки</button>
        </div>
        <div className="queue-filters">
          <div className="search-box"><Search size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, компания или ИНН" /></div>
          <div className="filter-select"><Filter size={16} /><select value={risk} onChange={(event) => setRisk(event.target.value)} aria-label="Уровень риска"><option value="all">Все уровни риска</option><option value="low">Низкий риск</option><option value="medium">Средний риск</option><option value="high">Высокий риск</option></select></div>
          <button className="btn btn-secondary btn-sm" onClick={() => applications.refetch()}>Обновить</button>
        </div>
      </div>

      {applications.isLoading ? (
        <LoadingBlock label="Загружаем очередь…" />
      ) : applications.isError ? (
        <Card><EmptyState title="Не удалось загрузить очередь" description="Повторите попытку." /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          {filtersActive ? (
            <EmptyState icon={<Search size={26} />} title="Ничего не найдено" description="По выбранным фильтрам заявок нет." action={<button className="btn btn-secondary btn-sm" onClick={() => { setSearch(""); setRisk("all"); }}>Сбросить фильтры</button>} />
          ) : (
            <EmptyState icon={<CheckCircle2 size={26} />} title="Очередь пуста" description={scope === "queue" ? "Все назначенные заявки обработаны. Новые появятся автоматически." : "Вам ещё не назначали заявок."} />
          )}
        </Card>
      ) : (
        <div className="queue-list">
          {filtered.map((app) => {
            const score = app.scoring_score;
            return (
              <Card className="queue-card" key={app.id}>
                <div className="queue-risk">
                  {score == null ? <span className="score-circle score-neutral">—</span> : <span className={`score-circle ${score >= 70 ? "score-good" : score >= 40 ? "score-mid" : "score-bad"}`}>{score}</span>}
                  <span>скоринг</span>
                </div>
                <div className="queue-main">
                  <div className="queue-head">
                    <span className="app-number">№ {app.number}</span>
                    <StatusBadge status={app.status} />
                    <span className="muted small">{formatShortDate(app.submitted_at ?? app.created_at)}</span>
                  </div>
                  <h3>{app.company_name}</h3>
                  <p>ИНН {app.company_inn} · {app.product.name} · {app.purpose_label}</p>
                  <div className="queue-meta">
                    <span>Сумма <strong>{formatMoney(app.amount)}</strong></span>
                    <span>Срок <strong>{app.term_months} мес.</strong></span>
                    <span>Документы <strong>{app.documents_count}</strong></span>
                  </div>
                </div>
                <div className="queue-actions">
                  {app.status === "NEED_INFO" ? <Badge tone="warning"><Clock3 size={13} /> Ждём клиента</Badge> : app.status === "IN_REVIEW" ? <Badge tone="info"><Sparkles size={13} /> Нужно решение</Badge> : <Badge tone="neutral">Завершено</Badge>}
                  <Link className="btn btn-primary btn-sm" to={`/staff/applications/${app.id}`}>Открыть <ArrowRight size={15} /></Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

    </div>
  );
}
