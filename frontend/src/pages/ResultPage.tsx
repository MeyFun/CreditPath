import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
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
  StatusBadge,
  useToast
} from "../components/ui";
import type { ApplicationDetail } from "../types";

function annuity(amount: number, rate: number, months: number) {
  const monthly = rate / 100 / 12;
  if (!months) return 0;
  if (monthly === 0) return amount / months;
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -months));
}

function schedule(amount: number, rate: number, months: number) {
  const payment = annuity(amount, rate, months);
  let balance = amount;
  const rows = [];
  for (let month = 1; month <= Math.min(months, 12); month += 1) {
    const interest = balance * (rate / 100 / 12);
    const principal = payment - interest;
    balance = Math.max(0, balance - principal);
    const date = new Date();
    date.setMonth(date.getMonth() + month);
    rows.push({ month, date, principal, interest, payment, balance });
  }
  return rows;
}

export default function ResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const applicationId = Number(id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [comment, setComment] = useState("");
  const [revenue, setRevenue] = useState("");
  const [profit, setProfit] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const query = useQuery({
    queryKey: ["client-application", applicationId],
    queryFn: () => api.client.application(applicationId),
    refetchInterval: (data) => {
      const status = data?.state.data?.status;
      return status && ["SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "DECISION_DRAFT"].includes(status)
        ? 2000
        : false;
    }
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["client-application", applicationId] });
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["client-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const respond = useMutation({
    mutationFn: () =>
      api.client.respond(applicationId, {
        comment,
        ...(revenue ? { declared_revenue: Number(revenue) } : {}),
        ...(profit ? { declared_profit: Number(profit) } : {})
      }),
    onSuccess: () => {
      push("Ответ отправлен. Автоматические проверки продолжаются.", "success");
      invalidate();
      query.refetch();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось отправить ответ")
  });

  const offer = useMutation({
    mutationFn: (accept: boolean) => api.client.offer(applicationId, accept),
    onSuccess: (_, accept) => {
      push(accept ? "Оферта принята" : "Оферта отклонена", "success");
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось обработать оферту")
  });

  const sign = useMutation({
    mutationFn: () => api.client.sign(applicationId),
    onSuccess: () => {
      push("Договор подписан в демонстрационном режиме", "success");
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось подписать")
  });

  const disburse = useMutation({
    mutationFn: () => api.client.disburse(applicationId),
    onSuccess: () => {
      push("Средства зачислены в демонстрационном режиме", "success");
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось завершить сделку")
  });

  const resubmit = useMutation({
    mutationFn: () => api.client.resubmit(applicationId),
    onSuccess: (data) => navigate(`/app/applications/new?draft=${data.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось создать новую заявку")
  });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`Файл «${file.name}» больше 10 МБ`);
          continue;
        }
        await api.client.upload(applicationId, file);
      }
      push("Документы загружены", "success");
      query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить документ");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (query.isLoading) return <LoadingBlock label="Загружаем решение…" />;
  if (query.isError || !query.data) {
    return <Card><Alert tone="danger" title="Заявка недоступна">Проверьте ссылку или вернитесь к списку заявок.</Alert><Link className="btn btn-secondary" to="/app/applications">К заявкам</Link></Card>;
  }
  const app = query.data;
  const active = ["APPROVED", "APPROVED_CHANGED"].includes(app.status);
  const amount = app.approved_amount ?? app.amount;
  const term = app.approved_term_months ?? app.term_months;
  const rate = app.approved_rate ?? app.product.rate;
  const payment = annuity(amount, rate, term);
  const rows = schedule(amount, rate, term);
  const reasons = app.decision_draft?.reasons ?? [];

  if (!["APPROVED", "APPROVED_CHANGED", "NEED_INFO", "REJECTED", "OFFER_ACCEPTED", "OFFER_DECLINED", "SIGNED", "DISBURSED"].includes(app.status)) {
    return (
      <Card>
        <div className="result-waiting">
          <span className="pulse-dot" />
          <h1>Решение ещё формируется</h1>
          <p>Заявка находится на этапе автоматических проверок. Статус обновится автоматически.</p>
          <Link className="btn btn-primary" to={`/app/applications/${app.id}`}>Вернуться к заявке <ArrowRight size={16} /></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="page-stack result-page">
      <div className="detail-topbar">
        <Link to={`/app/applications/${app.id}`} className="back-link"><ArrowLeft size={17} /> К заявке</Link>
        <span className="muted small">Решение по заявке № {app.number}</span>
      </div>
      <div className="result-heading">
        <div>
          <span className="eyebrow">Решение банка</span>
          <h1>{app.product.name}</h1>
          <p>Заявка № {app.number} · {app.company_name} · подана {formatDate(app.submitted_at ?? app.created_at)}</p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {app.status === "NEED_INFO" && (
        <div className="result-grid">
          <Card className="result-main result-need-info">
            <div className="result-icon result-icon-warning"><Clock3 size={30} /></div>
            <span className="eyebrow">Нужны дополнительные данные</span>
            <h2>Проверка приостановлена до вашего ответа</h2>
            <p>Сотрудник банка или автоматическая проверка запросила уточнения. Ответьте в кабинете — после этого проверки продолжатся автоматически.</p>
            <div className="reason-box">
              <strong>Что запрошено</strong>
              <p>{app.employee_comment || app.decision_draft?.reasons?.join(" ") || "Уточните данные компании, чтобы продолжить рассмотрение."}</p>
            </div>
            <Field label="Комментарий и уточнения" required>
              <textarea className="input textarea" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: прикладываю показатели за 2025 год" rows={4} />
            </Field>
            {(app.registry_snapshot?.revenue == null || app.registry_snapshot?.profit == null) && (
              <>
                <div className="form-grid">
                  <Field label="Выручка за последний год, ₽" hint="Если данных нет в реестре">
                    <Input type="number" inputMode="numeric" value={revenue} onChange={(event) => setRevenue(event.target.value)} placeholder="Например, 5000000" />
                  </Field>
                  <Field label="Чистая прибыль, ₽" hint="Можно указать отрицательное значение">
                    <Input type="number" inputMode="numeric" value={profit} onChange={(event) => setProfit(event.target.value)} placeholder="Например, 500000" />
                  </Field>
                </div>
                <DemoNote>Показатели, указанные здесь, используются только в демонстрационном скоринге и сохраняются как заявленные клиентом.</DemoNote>
              </>
            )}
            <div className="upload-inline">
              <input ref={fileInput} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => upload(event.target.files)} />
              <Button variant="secondary" icon={<UploadCloud size={17} />} loading={uploading} onClick={() => fileInput.current?.click()}>Приложить документы</Button>
              <span>{app.documents.length} файлов уже загружено</span>
            </div>
            <Button onClick={() => { if (comment.trim().length < 2) { setError("Опишите ответ в комментарии"); return; } respond.mutate(); }} loading={respond.isPending}>Отправить ответ и продолжить <ArrowRight size={16} /></Button>
          </Card>
          <aside className="result-aside">
            <Card><div className="card-head"><h2>Параметры</h2></div><div className="summary-lines"><div><span>Сумма</span><strong>{formatMoney(app.amount)}</strong></div><div><span>Срок</span><strong>{app.term_months} мес.</strong></div><div><span>Продукт</span><strong>{app.product.name}</strong></div><div><span>Компания</span><strong>{app.company_name}</strong></div></div></Card>
            <Card className="help-card"><span className="mini-icon"><ShieldCheck size={18} /></span><div><strong>Проверки продолжатся</strong><p>После ответа заявка вернётся на автоматические проверки и затем к тому же сотруднику.</p></div></Card>
          </aside>
        </div>
      )}

      {["APPROVED", "APPROVED_CHANGED", "OFFER_ACCEPTED", "SIGNED", "DISBURSED", "OFFER_DECLINED"].includes(app.status) && (
        <div className="result-grid">
          <Card className={`result-main ${app.status === "APPROVED_CHANGED" ? "result-changed" : "result-approved"}`}>
            <div className="offered-banner">
              <span className="result-icon result-icon-success"><CheckCircle2 size={30} /></span>
              <div>
                <span className="eyebrow">{app.status === "DISBURSED" ? "Сделка завершена" : "Решение банка"}</span>
                <h2>{app.status === "APPROVED_CHANGED" ? "Одобрено на других условиях" : "Одобрено"}</h2>
                <p>{app.status === "DISBURSED" ? "Средства зачислены в демонстрационном режиме." : "Проверки завершены. Ознакомьтесь с условиями оферты."}</p>
              </div>
              {app.status === "APPROVED_CHANGED" && <Badge tone="warning">Изменены условия</Badge>}
            </div>
            {app.offer_expires_at && active && <div className="offer-deadline"><Clock3 size={15} /> Оферта действует до {formatDate(app.offer_expires_at)}</div>}

            <div className="offer-metrics">
              <div><span>Сумма кредита</span><strong>{formatMoney(amount)}</strong><small>{amount === app.amount ? "100% запроса" : `Запрошено ${formatMoney(app.amount)}`}</small></div>
              <div><span>Срок</span><strong>{term} мес.</strong><small>Аннуитетный график</small></div>
              <div><span>Ставка</span><strong>{rate.toFixed(1).replace(".", ",")}%</strong><small>Фиксированная</small></div>
              <div><span>Платёж</span><strong className="accent-text">{formatMoney(payment)}</strong><small>в месяц</small></div>
            </div>

            {reasons.length > 0 && (
              <div className="reasons">
                <strong>Почему банк принял такое решение</strong>
                <ul>{reasons.map((reason, index) => <li key={index}><CheckCircle2 size={15} /> {reason}</li>)}</ul>
              </div>
            )}
            {app.employee_comment && <div className="reason-box"><strong>Комментарий сотрудника</strong><p>{app.employee_comment}</p></div>}

            <div className="offer-actions">
              {app.status === "APPROVED" || app.status === "APPROVED_CHANGED" ? (
                <>
                  <Button onClick={() => offer.mutate(true)} loading={offer.isPending} icon={<FileText size={17} />}>Принять предложение</Button>
                  <Button variant="secondary" onClick={() => offer.mutate(false)} loading={offer.isPending}>Отклонить</Button>
                </>
              ) : app.status === "OFFER_ACCEPTED" ? (
                <Button onClick={() => sign.mutate()} loading={sign.isPending} icon={<ShieldCheck size={17} />}>Подписать договор (демо)</Button>
              ) : app.status === "SIGNED" ? (
                <Button onClick={() => disburse.mutate()} loading={disburse.isPending} icon={<Banknote size={17} />}>Получить средства (демо)</Button>
              ) : app.status === "DISBURSED" ? (
                <div className="disbursed"><CheckCircle2 size={22} /><div><strong>Средства перечислены</strong><span>{formatDateTime(app.disbursed_at)}</span></div></div>
              ) : (
                <Link className="btn btn-primary" to="/app/applications/new"><RefreshCw size={16} /> Подать новую заявку</Link>
              )}
            </div>
            <DemoNote><Sparkles size={13} /> Подписание и зачисление средств в этом прототипе имитируются. Реальные деньги не перечисляются.</DemoNote>
          </Card>

          <aside className="result-aside">
            <Card>
              <div className="card-head"><h2>Данные заёмщика</h2></div>
              <div className="summary-lines">
                <div><span>Компания</span><strong>{app.company_name}</strong></div>
                <div><span>ИНН</span><strong>{app.company_inn}</strong></div>
                <div><span>Продукт</span><strong>{app.product.name}</strong></div>
                <div><span>Сотрудник</span><strong>{app.assigned_employee?.full_name ?? "—"}</strong></div>
              </div>
            </Card>
            <Card>
              <div className="card-head"><h2>Расходы</h2></div>
              <div className="summary-lines">
                <div><span>Всего к возврату</span><strong>{formatMoney(payment * term)}</strong></div>
                <div><span>Переплата</span><strong>{formatMoney(payment * term - amount)}</strong></div>
                <div><span>Комиссии</span><strong>0 ₽</strong></div>
              </div>
              <p className="muted small">Расчёт предварительный. Полный график формируется в демонстрационной оферте.</p>
            </Card>
            <Card className="help-card">
              <span className="mini-icon"><Info size={18} /></span>
              <div><strong>Уведомления</strong><p>Изменения решения фиксируются в центре уведомлений.</p><Link to="/app/notifications" className="text-link">Открыть центр <ArrowRight size={14} /></Link></div>
            </Card>
          </aside>
        </div>
      )}

      {app.status === "REJECTED" && (
        <div className="result-grid">
          <Card className="result-main result-rejected">
            <div className="result-icon result-icon-danger"><XCircle size={30} /></div>
            <span className="eyebrow">Решение банка</span>
            <h2>По заявке принят отказ</h2>
            <p>Решение принято сотрудником банка после проверки данных. Причина и рекомендации указаны ниже.</p>
            {app.employee_comment && <div className="reason-box"><strong>Комментарий сотрудника</strong><p>{app.employee_comment}</p></div>}
            {reasons.length > 0 && (
              <div className="reasons">
                <strong>Причины решения</strong>
                <ul>{reasons.map((reason, index) => <li key={index}><XCircle size={15} /> {reason}</li>)}</ul>
              </div>
            )}
            <Alert tone="info" title="Можно попробовать снова">Устраните замечания и создайте новую заявку. Она будет связана с предыдущей и не попадёт сотруднику, который уже рассматривал цепочку.</Alert>
            <Button onClick={() => resubmit.mutate()} loading={resubmit.isPending} icon={<RefreshCw size={17} />}>Подать заново</Button>
            <DemoNote>Повторная подача копирует данные заявки в новый черновик.</DemoNote>
          </Card>
          <aside className="result-aside">
            <Card><div className="card-head"><h2>Заявка</h2></div><div className="summary-lines"><div><span>Номер</span><strong>{app.number}</strong></div><div><span>Сумма</span><strong>{formatMoney(app.amount)}</strong></div><div><span>Срок</span><strong>{app.term_months} мес.</strong></div><div><span>Решение</span><strong>{formatDateTime(app.updated_at)}</strong></div></div></Card>
            <Card className="help-card"><span className="mini-icon"><Info size={18} /></span><div><strong>История сохранена</strong><p>Все события и причина отказа доступны в карточке заявки.</p><Link to={`/app/applications/${app.id}`} className="text-link">Открыть историю <ArrowRight size={14} /></Link></div></Card>
          </aside>
        </div>
      )}

      {["APPROVED", "APPROVED_CHANGED", "OFFER_ACCEPTED", "SIGNED", "DISBURSED"].includes(app.status) && rows.length > 0 && (
        <Card className="schedule-card">
          <div className="card-head">
            <div><span className="eyebrow">График</span><h2>Сводка погашения</h2></div>
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Download size={15} /> Печать</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Месяц</th><th>Дата</th><th>Основной долг</th><th>Проценты</th><th>Платёж</th><th>Остаток</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{row.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</td>
                    <td>{formatMoney(row.principal)}</td>
                    <td>{formatMoney(row.interest)}</td>
                    <td><strong>{formatMoney(row.payment)}</strong></td>
                    <td>{formatMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Показаны первые {rows.length} платежей из {term}. Расчёт демонстрационный и не является публичной офертой.</p>
        </Card>
      )}
    </div>
  );
}
