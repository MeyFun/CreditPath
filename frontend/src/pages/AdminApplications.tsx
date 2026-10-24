import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  RefreshCw,
  Search,
  UserPlus
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  formatDateTime,
  formatMoney,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  Timeline,
  useToast
} from "../components/ui";

const STATUS_OPTIONS = [
  ["", "Все статусы"],
  ["DRAFT", "Черновик"],
  ["IN_REVIEW", "На рассмотрении"],
  ["NEED_INFO", "Нужны уточнения"],
  ["APPROVED", "Одобрено"],
  ["APPROVED_CHANGED", "Другие условия"],
  ["OFFER_ACCEPTED", "Оферта принята"],
  ["OFFER_DECLINED", "Оферта отклонена"],
  ["SIGNED", "Договор подписан"],
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
  const deferredSearch = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: ["admin-applications", deferredSearch, status, unassigned],
    queryFn: () => api.admin.applications({ search: deferredSearch, status, unassigned }),
    placeholderData: keepPreviousData
  });

  return (
    <div className="page-stack">
      <PageHeader
        title="Все заявки"
      />
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
        <LoadingBlock variant="list" />
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить заявки" onRetry={() => query.refetch()} />
      ) : query.data?.length === 0 ? (
        <Card><EmptyState title="Заявок нет" description="Измените фильтры или дождитесь новых заявок." /></Card>
      ) : (
        <Card className="table-card">
          <div className="table-wrap">
            <table className="data-table stack-table">
              <thead><tr><th>Заявка</th><th>Компания</th><th>Сумма</th><th>Статус</th><th>Сотрудник</th><th /></tr></thead>
              <tbody>
                {query.data?.map((app) => (
                  <tr key={app.id}>
                    <td className="cell-lead"><div className="table-primary"><span className="file-badge"><Building2 size={16} /></span><div><strong>{app.product.name}</strong><small>№ {app.number} · {formatDate(app.created_at)}</small></div></div></td>
                    <td data-label="Компания"><strong>{app.company_name}</strong><small className="block muted">ИНН {app.company_inn}</small></td>
                    <td data-label="Сумма"><strong>{formatMoney(app.amount)}</strong><small className="block muted">{app.term_months} мес.</small></td>
                    <td data-label="Статус"><StatusBadge status={app.status} /></td>
                    <td data-label="Сотрудник">{app.assigned_employee?.full_name ?? (app.status === "IN_REVIEW" ? <Badge tone="warning">Нужно назначить</Badge> : <span className="muted">—</span>)}</td>
                    <td className="cell-lead"><button className="row-arrow" onClick={() => navigate(`/admin/applications/${app.id}`)} aria-label="Открыть"><ArrowRight size={17} /></button></td>
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
  const [confirmReassign, setConfirmReassign] = useState(false);
  const query = useQuery({ queryKey: ["admin-application", applicationId], queryFn: () => api.admin.application(applicationId) });
  const employees = useQuery({ queryKey: ["admin-users", "", "employee"], queryFn: () => api.admin.users("", "employee") });
  const assign = useMutation({
    mutationFn: () => api.admin.assign(applicationId, Number(employeeId)),
    onSuccess: () => {
      push("Сотрудник назначен", "success");
      setError("");
      setEmployeeId("");
      setConfirmReassign(false);
      queryClient.invalidateQueries({ queryKey: ["admin-application", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["admin-applications"] });
    },
    onError: (err) => {
      setConfirmReassign(false);
      setError(err instanceof ApiError ? err.message : "Не удалось назначить сотрудника");
    }
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError && query.error instanceof ApiError && query.error.status !== 404) {
    return <ErrorState title="Не удалось загрузить заявку" onRetry={() => query.refetch()} />;
  }
  if (query.isError || !query.data) return <Card><Alert tone="danger">Заявка не найдена</Alert><Link className="btn btn-secondary" to="/admin/applications">К списку</Link></Card>;
  const app = query.data;
  const canAssign = ["IN_REVIEW", "NEED_INFO"].includes(app.status);
  const candidates = (employees.data ?? []).filter((employee) => employee.is_active && employee.id !== app.assigned_employee?.id);
  const chosen = candidates.find((employee) => String(employee.id) === employeeId);

  return (
    <div className="page-stack">
      <div className="detail-topbar"><Link to="/admin/applications" className="back-link"><ArrowLeft size={17} /> Все заявки</Link></div>
      <div className="detail-heading">
        <div>
          <div className="inline-meta"><StatusBadge status={app.status} /><span>{app.product.name}</span><span>{formatDate(app.created_at)}</span></div>
          <h1>{app.company_name}</h1>
          <p>Заявка № {app.number} · ИНН {app.company_inn}</p>
        </div>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <Card>
            <div className="card-head"><div><h2>Параметры</h2></div><span className="muted small">{formatDateTime(app.updated_at)}</span></div>
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
            <div className="card-head"><div><h2>Предварительное решение</h2></div>{app.decision_draft && <Badge tone={app.decision_draft.outcome === "reject" ? "danger" : app.decision_draft.outcome === "need_info" ? "warning" : "success"}>{app.decision_draft.summary}</Badge>}</div>
            {app.decision_draft ? <ul className="reason-list">{app.decision_draft.reasons.map((reason, index) => <li key={index}><CheckCircle2 size={15} /> {reason}</li>)}</ul> : <p className="muted">Нет данных.</p>}
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
                <select className="input" value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setError(""); }} aria-label="Сотрудник">
                  <option value="">Выберите сотрудника</option>
                  {candidates.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
                {error && <Alert tone="danger">{error}</Alert>}
                <Button className="btn-full" loading={assign.isPending} disabled={!employeeId} onClick={() => (app.assigned_employee ? setConfirmReassign(true) : assign.mutate())}>
                  {app.assigned_employee ? "Переназначить" : "Назначить"}
                </Button>
                <Modal
                  open={confirmReassign}
                  title="Переназначить заявку?"
                  onClose={() => setConfirmReassign(false)}
                  footer={<><Button variant="ghost" onClick={() => setConfirmReassign(false)}>Отмена</Button><Button loading={assign.isPending} onClick={() => assign.mutate()}>Переназначить</Button></>}
                >
                  <p>Заявка перейдёт от {app.assigned_employee?.full_name} к {chosen?.full_name}. Оба сотрудника получат уведомление в кабинете.</p>
                </Modal>
              </>
            ) : <p className="muted">Заявка не в работе — назначить сотрудника нельзя.</p>}
            {app.queue_reason && <Alert tone="warning" title="Причина очереди">{app.queue_reason}</Alert>}
          </Card>
          <Card>
            <div className="card-head"><h2>Контроль</h2></div>
            <div className="summary-lines"><div><span>Создана</span><strong>{formatDate(app.created_at)}</strong></div><div><span>Отправлена</span><strong>{formatDate(app.submitted_at)}</strong></div><div><span>Сотрудник</span><strong>{app.assigned_employee?.full_name ?? "—"}</strong></div></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
