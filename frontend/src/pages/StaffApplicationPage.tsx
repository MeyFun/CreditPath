import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  LineChart,
  MessageSquareWarning,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadDocument } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DemoNote,
  Field,
  formatDate,
  formatDateTime,
  formatMoney,
  Input,
  LoadingBlock,
  ProgressBar,
  Select,
  StatusBadge,
  Timeline,
  useToast
} from "../components/ui";

type DecisionAction = "approve" | "approve_changed" | "need_info" | "reject";

export default function StaffApplicationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const applicationId = Number(id);
  const query = useQuery({ queryKey: ["employee-application", applicationId], queryFn: () => api.employee.application(applicationId) });
  const [tab, setTab] = useState<"overview" | "checks" | "history">("overview");
  const [action, setAction] = useState<DecisionAction | null>(null);
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [productId, setProductId] = useState("");
  const products = useQuery({ queryKey: ["public-products"], queryFn: api.public.products });
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const app = query.data;

  useEffect(() => {
    if (!app) return;
    setAmount(String(app.decision_draft?.proposed_amount ?? app.amount));
    setTerm(String(app.decision_draft?.proposed_term_months ?? app.term_months));
    setProductId(String(app.product.id));
  }, [app?.id]);

  const decide = useMutation({
    mutationFn: () =>
      api.employee.decide(applicationId, {
        action: action!,
        ...(action === "approve_changed"
          ? { product_id: Number(productId), approved_amount: Number(amount), approved_term_months: Number(term) }
          : {}),
        comment
      }),
    onSuccess: (data) => {
      push("Решение зафиксировано и отправлено клиенту", "success");
      queryClient.invalidateQueries({ queryKey: ["employee-applications"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stats"] });
      queryClient.invalidateQueries({ queryKey: ["employee-application", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(`/staff/applications/${data.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось сохранить решение")
  });

  const score = app?.scoring?.score ?? app?.scoring_score ?? 0;
  const risk = score >= 70 ? { label: "Низкий риск", tone: "success" } : score >= 40 ? { label: "Средний риск", tone: "warning" } : { label: "Высокий риск", tone: "danger" };
  const bki = app?.bki_snapshot;

  const positiveFactors = useMemo(() => app?.scoring?.factors.filter((factor) => factor.points > 0) ?? [], [app]);
  const negativeFactors = useMemo(() => app?.scoring?.factors.filter((factor) => factor.points < 0) ?? [], [app]);

  if (query.isLoading) return <LoadingBlock label="Загружаем карточку заявки…" />;
  if (query.isError || !app) {
    return <Card><Alert tone="danger" title="Заявка недоступна">Она не назначена вам или не существует.</Alert><Link className="btn btn-secondary" to="/staff">К очереди</Link></Card>;
  }
  const company = app.registry_snapshot;

  function choose(next: DecisionAction) {
    setAction(next);
    setError("");
  }

  function submitDecision() {
    setError("");
    if (!action) return;
    if ((action === "reject" || action === "need_info") && comment.trim().length < 3) {
      setError("Для отказа и запроса данных обязателен комментарий");
      return;
    }
    if (action === "approve_changed" && (!amount || !term)) {
      setError("Укажите сумму и срок новых условий");
      return;
    }
    decide.mutate();
  }

  const actionTitle: Record<DecisionAction, string> = {
    approve: "Одобрить заявку",
    approve_changed: "Одобрить на других условиях",
    need_info: "Запросить данные",
    reject: "Отказать"
  };

  return (
    <div className="page-stack">
      <div className="detail-topbar">
        <Link to="/staff" className="back-link"><ArrowLeft size={17} /> Назад к очереди</Link>
        <div className="inline-meta"><span>№ {app.number}</span><StatusBadge status={app.status} /></div>
      </div>

      <Card className="staff-app-header">
        <div className="staff-company-mark"><Building2 size={26} /></div>
        <div>
          <span className="eyebrow">Заявка на финансирование</span>
          <h1>{app.company_name}</h1>
          <p>ИНН {app.company_inn} · {app.product.name} · {app.purpose_label}</p>
          {app.related_party && <Badge tone="warning">Связанное лицо сотрудника банка</Badge>}
        </div>
        <div className="staff-header-metrics">
          <div><span>Сумма</span><strong>{formatMoney(app.amount)}</strong></div>
          <div><span>Срок</span><strong>{app.term_months} мес.</strong></div>
          <div><span>Скоринг</span><strong className={score >= 70 ? "success-text" : score >= 40 ? "warning-text" : "danger-text"}>{score}/100</strong></div>
          <Badge tone={risk.tone}>{risk.label}</Badge>
        </div>
      </Card>

      <div className="staff-tabs tabs-row">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Обзор</button>
        <button className={tab === "checks" ? "active" : ""} onClick={() => setTab("checks")}>Проверки и скоринг</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>История</button>
      </div>

      <div className="staff-detail-grid">
        <div className="staff-detail-main">
          {tab === "overview" && (
            <>
              <Card>
                <div className="card-head"><div><span className="eyebrow">Заявка</span><h2>Параметры финансирования</h2></div><span className="muted small">Подана {formatDate(app.submitted_at ?? app.created_at)}</span></div>
                <div className="review-grid">
                  <div><span>Продукт</span><strong>{app.product.name}</strong></div>
                  <div><span>Сумма</span><strong>{formatMoney(app.amount)}</strong></div>
                  <div><span>Срок</span><strong>{app.term_months} мес.</strong></div>
                  <div><span>Ставка</span><strong>{app.product.rate.toFixed(1)}%</strong></div>
                  <div><span>Цель</span><strong>{app.purpose_label}</strong></div>
                  <div><span>Обеспечение</span><strong>{app.collateral ? "Да" : "Нет"}</strong></div>
                </div>
              </Card>
              {company && (
                <Card>
                  <div className="card-head"><div><span className="eyebrow">Реестр</span><h2><Building2 size={19} /> Сведения о компании</h2></div><Badge tone={company.status === "Действующая" ? "success" : "danger"}>{company.status}</Badge></div>
                  <div className="review-grid">
                    <div><span>ИНН</span><strong>{company.inn}</strong></div>
                    <div><span>ОПФ</span><strong>{company.legal_form}</strong></div>
                    <div><span>Дата регистрации</span><strong>{formatDate(company.registration_date)}</strong></div>
                    <div><span>ОКВЭД</span><strong>{company.okved}</strong></div>
                    <div><span>Руководитель</span><strong>{company.director}</strong></div>
                    <div><span>Сотрудники</span><strong>{company.employees ?? "—"}</strong></div>
                    <div><span>Выручка</span><strong>{formatMoney(company.revenue)}</strong></div>
                    <div><span>Прибыль</span><strong>{formatMoney(company.profit)}</strong></div>
                  </div>
                  <p className="muted small">{company.address}</p>
                  {company.financial_source === "client_declared" && <Alert tone="warning">Финансовые показатели заявлены клиентом при ответе на запрос уточнений.</Alert>}
                </Card>
              )}
              {bki && (
                <Card>
                  <div className="card-head"><div><span className="eyebrow">Кредитная история</span><h2>Данные БКИ</h2></div><Badge tone={bki.active_overdue ? "danger" : "success"}>{bki.active_overdue ? "Есть просрочка" : "Без активных просрочек"}</Badge></div>
                  <div className="review-grid">
                    <div><span>Текущий долг</span><strong>{formatMoney(bki.current_debt)}</strong></div>
                    <div><span>Активная просрочка</span><strong>{formatMoney(bki.current_overdue_amount)}</strong></div>
                    <div><span>Макс. глубина</span><strong>{bki.max_overdue_days} дн.</strong></div>
                    <div><span>Закрыта за 12 мес.</span><strong>{bki.closed_overdue_12m ? "Да" : "Нет"}</strong></div>
                    <div><span>История</span><strong>{bki.credit_history_years} лет</strong></div>
                    <div><span>Договоров погашено</span><strong>{bki.contracts_paid}</strong></div>
                  </div>
                  {bki.history?.length > 0 && <div className="bki-history">{bki.history.map((item, index) => <div key={index}><span>{formatDate(item.date)}</span><strong>{item.type}</strong><span>{formatMoney(item.amount)}</span><Badge tone={item.status === "Действует" ? "info" : "neutral"}>{item.status}</Badge></div>)}</div>}
                </Card>
              )}
              <Card>
                <div className="card-head"><div><span className="eyebrow">Документы</span><h2>Файлы клиента</h2></div><Badge tone="neutral">{app.documents.length}</Badge></div>
                {app.documents.length === 0 ? <p className="muted">Клиент не приложил документы.</p> : app.documents.map((doc) => (
                  <div className="document-row" key={doc.id}>
                    <span className="file-badge"><FileText size={17} /></span>
                    <div><strong>{doc.original_name}</strong><small>{(doc.size_bytes / 1024).toFixed(0)} КБ · {formatDate(doc.created_at)}</small></div>
                    <button className="icon-button" onClick={() => downloadDocument(app.id, doc.id, doc.original_name, "employee")} aria-label="Скачать"><Download size={17} /></button>
                  </div>
                ))}
              </Card>
            </>
          )}

          {tab === "checks" && (
            <>
              <Card>
                <div className="card-head"><div><span className="eyebrow">Прозрачная модель</span><h2>Скоринг: {score} из 100</h2></div><Badge tone={risk.tone}>{risk.label}</Badge></div>
                <ProgressBar value={score} tone={score >= 70 ? "success" : score >= 40 ? "warning" : "danger"} />
                <p className="muted small">Диапазон: 0–100, выше — надёжнее. Модель не принимает финальное решение, а формирует факторы для сотрудника.</p>
                <div className="factor-list">
                  {app.scoring?.factors.map((factor) => (
                    <div className="factor-row" key={factor.code}>
                      <span className={`factor-points ${factor.points > 0 ? "positive" : factor.points < 0 ? "negative" : ""}`}>{factor.points > 0 ? "+" : ""}{factor.points}</span>
                      <div><strong>{factor.label}</strong><p>{factor.reason}</p></div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <div className="card-head"><div><span className="eyebrow">Кредитная логика</span><h2>Предварительное решение</h2></div>{app.decision_draft && <Badge tone={app.decision_draft.outcome === "approve" ? "success" : app.decision_draft.outcome === "reject" ? "danger" : "warning"}>{app.decision_draft.summary}</Badge>}</div>
                {app.decision_draft ? (
                  <>
                    <ul className="reason-list">{app.decision_draft.reasons.map((reason, index) => <li key={index}><CheckCircle2 size={15} /> {reason}</li>)}</ul>
                    {app.decision_draft.outcome !== "reject" && app.decision_draft.outcome !== "need_info" && (
                      <Alert tone="info" title="Рекомендация системы">
                        Сумма {formatMoney(app.decision_draft.proposed_amount)}, срок {app.decision_draft.proposed_term_months} мес., ставка {app.decision_draft.proposed_rate}% годовых. Финальное решение — за вами.
                      </Alert>
                    )}
                  </>
                ) : <p className="muted">Предварительное решение ещё не сформировано.</p>}
                {app.enrichment_errors && <Alert tone="warning" title="Деградация внешних проверок">Часть данных мок-сервисов была недоступна. Проверьте снимок перед решением.</Alert>}
              </Card>
            </>
          )}

          {tab === "history" && (
            <Card>
              <div className="card-head"><div><span className="eyebrow">Аудит и события</span><h2>История заявки</h2></div><span className="muted small">Все действия фиксируются</span></div>
              <Timeline events={app.events} />
            </Card>
          )}
        </div>

        <aside className="staff-detail-aside">
          <Card className={`decision-card ${app.status === "IN_REVIEW" ? "decision-active" : ""}`}>
            <div className="card-head"><div><span className="eyebrow">Финальное решение</span><h2>Панель сотрудника</h2></div><ShieldCheck size={21} /></div>
            {app.status === "IN_REVIEW" && app.can_decide ? (
              <>
                <p className="muted small">Выберите одно из четырёх действий. Отказ и запрос данных требуют комментария.</p>
                {(app.decision_draft?.outcome === "reject" || score < 70 || (app.decision_draft?.stop_factors?.length ?? 0) > 0) && (
                  <Alert tone="warning" title="Потребуется риск-исключение">
                    Одобрение при скоринге {score}/100 или вопреки рекомендации системы будет дополнительно зафиксировано отдельным событием в журнале аудита.
                  </Alert>
                )}
                <div className="decision-buttons">
                  <button className={`decision-button approve ${action === "approve" ? "selected" : ""}`} onClick={() => choose("approve")}><CheckCircle2 size={18} /><span><strong>Одобрить</strong><small>На запрошенных условиях</small></span></button>
                  <button className={`decision-button changed ${action === "approve_changed" ? "selected" : ""}`} onClick={() => choose("approve_changed")}><LineChart size={18} /><span><strong>Другие условия</strong><small>Сумма, срок или продукт</small></span></button>
                  <button className={`decision-button info ${action === "need_info" ? "selected" : ""}`} onClick={() => choose("need_info")}><MessageSquareWarning size={18} /><span><strong>Запросить данные</strong><small>Вернуть клиенту</small></span></button>
                  <button className={`decision-button reject ${action === "reject" ? "selected" : ""}`} onClick={() => choose("reject")}><XCircle size={18} /><span><strong>Отказать</strong><small>С обязательной причиной</small></span></button>
                </div>
                {action && (
                  <div className="decision-form">
                    <strong>{actionTitle[action]}</strong>
                    {action === "approve_changed" && (
                      <Field label="Продукт">
                        <Select value={productId} onChange={(event) => setProductId(event.target.value)}>
                          {(products.data ?? []).filter((item) => item.is_active).map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    {action === "approve_changed" && (
                      <div className="form-grid">
                        <Field label="Новая сумма, ₽" required><Input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
                        <Field label="Новый срок, мес." required><Input type="number" value={term} onChange={(event) => setTerm(event.target.value)} /></Field>
                      </div>
                    )}
                    <Field label={action === "reject" || action === "need_info" ? "Комментарий для клиента" : "Комментарий (необязательно)"} required={action === "reject" || action === "need_info"}>
                      <textarea className="input textarea" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={action === "reject" ? "Понятная причина отказа" : action === "need_info" ? "Что именно нужно уточнить" : "Комментарий к решению"} />
                    </Field>
                    {error && <Alert tone="danger">{error}</Alert>}
                    <Button onClick={submitDecision} loading={decide.isPending} className="btn-full">{actionTitle[action]}</Button>
                  </div>
                )}
                {!action && error && <Alert tone="danger">{error}</Alert>}
                <DemoNote>Решение регистрируется в журнале аудита. Администратор не может принять кредитное решение.</DemoNote>
              </>
            ) : app.status === "NEED_INFO" ? (
              <Alert tone="warning" title="Ожидается ответ клиента">Заявка вернётся к вам после ответа. Вы получите уведомление в центре.</Alert>
            ) : (
              <div className="decision-done">
                {app.status === "REJECTED" ? <XCircle size={26} /> : <CheckCircle2 size={26} />}
                <div><strong>{app.status === "REJECTED" ? "Решение: отказ" : "Решение принято"}</strong><p>{formatDateTime(app.updated_at)}</p>{app.employee_comment && <p>{app.employee_comment}</p>}</div>
              </div>
            )}
          </Card>

          <Card>
            <div className="card-head"><h2>Предварительная оценка</h2></div>
            <div className={`score-block score-block-${score >= 70 ? "good" : score >= 40 ? "mid" : "bad"}`}>
              <strong>{score}</strong><span>/ 100</span><Badge tone={risk.tone}>{risk.label}</Badge>
            </div>
            <div className="score-bars">
              <div><span>Положительные факторы</span><strong>{positiveFactors.length}</strong></div>
              <div><span>Отрицательные факторы</span><strong>{negativeFactors.length}</strong></div>
            </div>
            <button className="text-link" onClick={() => setTab("checks")}>Разобрать факторы <ArrowRight size={14} /></button>
          </Card>

          {app.previous_decisions.length > 0 ? (
            <Card>
              <div className="card-head"><div><span className="eyebrow">Свежий взгляд</span><h2>Прошлые заявки клиента</h2></div><ShieldAlert size={19} /></div>
              <p className="muted small">Повторная заявка назначена вам, потому что вы не рассматривали эту цепочку. Учтите контекст прошлых решений.</p>
              <div className="previous-decisions">
                {app.previous_decisions.map((item) => (
                  <div className="previous-decision" key={item.id}>
                    <div className="inline-meta"><strong>№ {item.number}</strong><StatusBadge status={item.status} label={item.status_label} /></div>
                    <small className="muted">{formatMoney(item.amount)} · {formatDate(item.submitted_at)} · {item.decided_by?.full_name ?? "—"}</small>
                    {item.employee_comment && <p>{item.employee_comment}</p>}
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="help-card">
              <span className="mini-icon"><ShieldAlert size={18} /></span>
              <div><strong>Свежий взгляд</strong><p>Система уже исключила вас из цепочек, где вы принимали решение, и из собственных заявок. Дополнительная проверка выполняется на сервере.</p></div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
