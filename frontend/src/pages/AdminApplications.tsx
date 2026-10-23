import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatDateTime,
  formatMoney,
  Input,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  Timeline,
  useToast
} from "../components/ui";

const STATUS_OPTIONS = [
  ["", "Все статусы"],
  ["IN_REVIEW", "На рассмотрении"],
  ["NEED_INFO", "Нужны уточнения"],
  ["APPROVED", "Одобрено"],
  ["APPROVED_CHANGED", "Другие условия"],
  ["REJECTED", "Отказ"],
  ["DISBURSED", "Выдано"]
];

export default function AdminApplications() {
  const { id } = useParams();
  const applicationId = Number(id);
  if (id) return <AdminApplicationDetail applicationId={applicationId} />;
  return <AdminApplicationsList />;
}

function AdminApplicationsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const query = useQuery({
    queryKey: ["admin-applications", search, status, unassigned],
    queryFn: () => api.admin.applications({ search, status, unassigned })
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Администрирование"
        title="Все заявки"
        description="Режим наблюдения. Кредитные решения принимают только сотрудники банка."
      />
      <div className="admin-monitor">
        <span><ShieldCheck size={17} /> Только чтение</span>
        <span>Назначение сотрудника доступно в карточке заявки без права решения.</span>
      </div>
      <Card className="filter-card">
        <div className="queue-filters">
          <div className="search-box"><Search size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, компания или ИНН" /></div>
          <select className="input compact-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Статус">
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="inline-checkbox"><input type="checkbox" checked={unassigned} onChange={(event) => setUnassigned(event.target.checked)} /> Без сотрудника</label>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => query.refetch()}>Обновить</Button>
        </div>
      </Card>
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data?.length === 0 ? (
        <Card><EmptyState title="Заявок нет" description="Измените фильтры или дождитесь новых заявок." /></Card>
      ) : (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Заявка</th><th>Компания</th><th>Сумма</th><th>Статус</th><th>Сотрудник</th><th /></tr></thead>
              <tbody>
                {query.data?.map((app) => (
                  <tr key={app.id}>
                    <td><div className="table-primary"><span className="file-badge"><Building2 size={16} /></span><div><strong>{app.product.name}</strong><small>№ {app.number} · {formatDate(app.created_at)}</small></div></div></td>
                    <td><strong>{app.company_name}</strong><small className="block muted">ИНН {app.company_inn}</small></td>
                    <td><strong>{formatMoney(app.amount)}</strong><small className="block muted">{app.term_months} мес.</small></td>
                    <td><StatusBadge status={app.status} /></td>
                    <td>{app.assigned_employee?.full_name ?? <Badge tone="warning">Очередь админа</Badge>}</td>
                    <td><button className="row-arrow" onClick={() => navigate(`/admin/applications/${app.id}`)} aria-label="Открыть"><ArrowRight size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function AdminApplicationDetail({ applicationId }: { applicationId: number }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["admin-application", applicationId], queryFn: () => api.admin.application(applicationId) });
  const employees = useQuery({ queryKey: ["admin-users", "", "employee"], queryFn: () => api.admin.users("", "employee") });
  const assign = useMutation({
    mutationFn: () => api.admin.assign(applicationId, Number(employeeId)),
    onSuccess: () => {
      push("Сотрудник назначен", "success");
      queryClient.invalidateQueries({ queryKey: ["admin-application", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["admin-applications"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось назначить сотрудника")
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError || !query.data) return <Card><Alert tone="danger">Заявка не найдена</Alert><Link className="btn btn-secondary" to="/admin/applications">К списку</Link></Card>;
  const app = query.data;
  const canAssign = ["IN_REVIEW", "NEED_INFO"].includes(app.status);

  return (
    <div className="page-stack">
      <div className="detail-topbar"><Link to="/admin/applications" className="back-link"><ArrowLeft size={17} /> Все заявки</Link><span className="muted small">Мониторинг · без права решения</span></div>
      <div className="detail-heading">
        <div>
          <div className="inline-meta"><StatusBadge status={app.status} /><span>{app.product.name}</span><span>{formatDate(app.created_at)}</span></div>
          <h1>{app.company_name}</h1>
          <p>Заявка № {app.number} · ИНН {app.company_inn}</p>
        </div>
        <Badge tone="neutral"><ShieldCheck size={14} /> Режим администратора</Badge>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <Card>
            <div className="card-head"><div><span className="eyebrow">Заявка</span><h2>Параметры</h2></div><span className="muted small">{formatDateTime(app.updated_at)}</span></div>
            <div className="review-grid">
              <div><span>Сумма</span><strong>{formatMoney(app.amount)}</strong></div>
              <div><span>Срок</span><strong>{app.term_months} мес.</strong></div>
              <div><span>Ставка</span><strong>{app.product.rate.toFixed(1)}%</strong></div>
              <div><span>Обеспечение</span><strong>{app.collateral ? "Да" : "Нет"}</strong></div>
              <div><span>Сотрудник</span><strong>{app.assigned_employee?.full_name ?? "Не назначен"}</strong></div>
              <div><span>Скоринг</span><strong>{app.scoring_score ?? "—"}/100</strong></div>
            </div>
          </Card>
          <Card>
            <div className="card-head"><div><span className="eyebrow">Внутренние проверки</span><h2>Предварительное решение</h2></div>{app.decision_draft && <Badge tone={app.decision_draft.outcome === "reject" ? "danger" : app.decision_draft.outcome === "need_info" ? "warning" : "success"}>{app.decision_draft.summary}</Badge>}</div>
            {app.decision_draft ? <ul className="reason-list">{app.decision_draft.reasons.map((reason, index) => <li key={index}><ArrowRight size={15} /> {reason}</li>)}</ul> : <p className="muted">Нет данных.</p>}
            {app.employee_comment && <Alert tone="info" title="Комментарий сотрудника">{app.employee_comment}</Alert>}
          </Card>
          <Card>
            <div className="card-head"><h2>История</h2></div>
            <Timeline events={app.events} />
          </Card>
        </div>
        <aside className="detail-aside">
          <Card>
            <div className="card-head"><h2><UserPlus size={18} /> Назначение</h2></div>
            {canAssign ? (
              <>
                <p className="muted small">Если заявка без сотрудника или требуется переназначение. Правило «свежего взгляда» проверяется на сервере.</p>
                <select className="input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                  <option value="">Выберите сотрудника</option>
                  {employees.data?.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
                {error && <Alert tone="danger">{error}</Alert>}
                <Button className="btn-full" loading={assign.isPending} disabled={!employeeId} onClick={() => assign.mutate()}>Назначить</Button>
              </>
            ) : <p className="muted">Назначение доступно для заявок в работе.</p>}
            {app.queue_reason && <Alert tone="warning" title="Причина очереди">{app.queue_reason}</Alert>}
          </Card>
          <Card>
            <div className="card-head"><h2>Контроль</h2></div>
            <div className="summary-lines"><div><span>Создана</span><strong>{formatDate(app.created_at)}</strong></div><div><span>Отправлена</span><strong>{formatDate(app.submitted_at)}</strong></div><div><span>Сотрудник</span><strong>{app.assigned_employee?.full_name ?? "—"}</strong></div></div>
            <p className="muted small"><Clock3 size={14} /> Администратор видит данные, но не может принять кредитное решение.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
