import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Info,
  LockKeyhole,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, downloadDocument } from "../api";
import { useAuth } from "../auth";
import {
  Alert,
  applicationPollInterval,
  Badge,
  Card,
  DemoNote,
  formatDate,
  formatDateTime,
  formatMoney,
  LoadingBlock,
  ProgressBar,
  StatusBadge,
  Timeline
} from "../components/ui";
import type { ApplicationDetail } from "../types";

const PIPELINE = ["SUBMITTED", "VALIDATION", "ENRICHMENT", "SCORING", "DECISION_DRAFT"];

function stageOf(status: string): number {
  if (status === "DRAFT") return -1;
  if (status === "SUBMITTED") return 0;
  if (PIPELINE.includes(status)) return 1;
  if (["IN_REVIEW", "NEED_INFO"].includes(status)) return 2;
  return 3;
}

const NEXT_STEP: Record<string, { title: string; body: string }> = {
  DRAFT: { title: "Черновик не отправлен", body: "Завершите заполнение и отправьте заявку на рассмотрение." },
  SUBMITTED: { title: "Заявка принята", body: "Автоматические проверки начнутся в течение нескольких секунд." },
  VALIDATION: { title: "Проверяем данные", body: "Формат, полнота и ИНН проверяются автоматически." },
  ENRICHMENT: { title: "Запрашиваем данные", body: "Получаем сведения из демонстрационных реестра и БКИ. Обычно это занимает несколько секунд." },
  SCORING: { title: "Считаем оценку", body: "Оцениваем данные компании и кредитную историю." },
  DECISION_DRAFT: { title: "Применяем правила банка", body: "Кредитная логика формирует предварительное решение." },
  IN_REVIEW: { title: "Заявка у сотрудника", body: "Сотрудник банка проверяет данные и принимает финальное решение." },
  NEED_INFO: { title: "Нужны уточнения", body: "Ответьте на запрос и при необходимости приложите документы. Проверки продолжатся автоматически." },
  APPROVED: { title: "Одобрено", body: "Оферта сформирована. Ознакомьтесь с условиями и примите решение." },
  APPROVED_CHANGED: { title: "Одобрено на других условиях", body: "Сотрудник банка изменил сумму или срок. Проверьте оферту." },
  REJECTED: { title: "Решение: отказ", body: "Причина указана в решении. Можно устранить замечания и подать заявку повторно." },
  OFFER_ACCEPTED: { title: "Оферта принята", body: "Осталось подписать договор в демонстрационном режиме." },
  SIGNED: { title: "Договор подписан", body: "Можно завершить сделку демонстрационным зачислением средств." },
  DISBURSED: { title: "Сделка завершена", body: "Средства зачислены в демонстрационном режиме. Реальное перечисление не выполнялось." },
  OFFER_DECLINED: { title: "Оферта отклонена", body: "Вы отклонили предложенные условия. Можно подать новую заявку." }
};

export default function ApplicationPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const applicationId = Number(id);
  const query = useQuery({
    queryKey: ["client-application", applicationId],
    queryFn: () => api.client.application(applicationId),
    refetchInterval: (data) => applicationPollInterval(data?.state.data?.status)
  });

  if (query.isLoading) return <LoadingBlock label="Загружаем заявку…" />;
  if (query.isError || !query.data) {
    return <Card><Alert tone="danger" title="Заявка недоступна">Возможно, она не существует или принадлежит другому пользователю.</Alert><Link className="btn btn-secondary" to="/app/applications">К списку заявок</Link></Card>;
  }
  const app = query.data;
  const stage = stageOf(app.status);
  const next = NEXT_STEP[app.status] ?? NEXT_STEP.VALIDATION;
  const isPending = ["SUBMITTED", ...PIPELINE].includes(app.status);
  const canOpenResult = ["NEED_INFO", "APPROVED", "APPROVED_CHANGED", "REJECTED", "OFFER_ACCEPTED", "OFFER_DECLINED", "SIGNED", "DISBURSED"].includes(app.status);
  const progress = app.status === "DRAFT" ? 10 : stage === 0 ? 20 : stage === 1 ? 45 : stage === 2 ? 70 : 100;
  const route = `/app/applications/${app.id}/result`;
  const paymentAmount = app.approved_amount ?? app.amount;
  const paymentRate = app.approved_rate ?? app.product.rate;
  const paymentTerm = app.approved_term_months ?? app.term_months;
  const monthlyRate = paymentRate / 100 / 12;
  const monthlyPayment = monthlyRate
    ? (paymentAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -paymentTerm))
    : paymentAmount / paymentTerm;

  return (
    <div className="page-stack">
      <div className="detail-topbar">
        <Link to="/app/applications" className="back-link"><ArrowLeft size={17} /> Назад к списку</Link>
        <span className="muted small">Заявка № {app.number}</span>
      </div>
      <div className="detail-heading">
        <div>
          <div className="inline-meta"><StatusBadge status={app.status} /><span>{app.product.name}</span><span>Создана {formatDate(app.created_at)}</span></div>
          <h1>Заявка № {app.number}</h1>
          <p>{app.company_name} · ИНН {app.company_inn}</p>
        </div>
        <div className="detail-actions">
          {app.status === "DRAFT" ? (
            <Link className="btn btn-primary" to={`/app/applications/new?draft=${app.id}`}>Продолжить заполнение <ArrowRight size={16} /></Link>
          ) : canOpenResult ? (
            <Link className="btn btn-primary" to={route}>{app.status === "NEED_INFO" ? "Ответить на запрос" : "Открыть решение"} <ArrowRight size={16} /></Link>
          ) : (
            <span className="pending-pill"><Clock3 size={16} /> Идут проверки</span>
          )}
          <button className="btn btn-secondary" onClick={() => window.print()}>Печать сведений</button>
        </div>
      </div>

      {searchParams.get("submitted") && <Alert tone="success" title="Заявка отправлена">Автоматические проверки запущены. Статус обновляется автоматически.</Alert>}
      {isPending && <div className="pipeline-strip"><span className="pulse-dot" /> Автоматический конвейер работает: данные сохраняются после каждого этапа.</div>}

      <Card className={`status-banner ${app.status === "NEED_INFO" ? "status-banner-warning" : app.status === "REJECTED" ? "status-banner-danger" : ""}`}>
        <div className="status-banner-icon">{app.status === "NEED_INFO" ? <Clock3 size={24} /> : stage === 3 ? <CheckCircle2 size={24} /> : <ShieldCheck size={24} />}</div>
        <div className="status-banner-copy">
          <span className="eyebrow">Текущий статус</span>
          <h2>{next.title}</h2>
          <p>{next.body}</p>
          <div className="status-progress"><ProgressBar value={progress} /><span>{progress}%</span></div>
        </div>
        <div className="status-banner-side">
          <span>Обновлено</span>
          <strong>{formatDateTime(app.updated_at)}</strong>
          {app.assigned_employee && <><span className="muted small">Сотрудник</span><strong>{app.assigned_employee.full_name}</strong></>}
        </div>
      </Card>

      <div className="detail-grid">
        <div className="detail-main">
          <Card>
            <div className="card-head">
              <div><span className="eyebrow">Путь заявки</span><h2>Этапы рассмотрения</h2></div>
              {isPending && <Badge tone="info">Обновляется</Badge>}
            </div>
            <ol className="stage-list">
              <StageItem index={1} title="Заявка отправлена" done={stage >= 0} active={stage === 0} text="Заявка зафиксирована в системе, данные переданы на автоматические проверки." time={app.submitted_at} />
              <StageItem index={2} title="Автоматические проверки" done={stage >= 2} active={stage === 1} text="ИНН и реквизиты, реестр, кредитная история и скоринг." time={stage >= 2 ? app.updated_at : null} />
              <StageItem index={3} title="Рассмотрение сотрудником" done={stage >= 3} active={stage === 2} text={app.status === "NEED_INFO" ? "Сотрудник или автоматическая проверка ожидает данные от вас." : "Финальное решение принимает сотрудник банка с учётом предварительной оценки."} time={stage >= 3 ? app.updated_at : null} />
              <StageItem index={4} title="Решение и оферта" done={stage >= 3} active={stage === 3} text="Условия, оферта, демонстрационное подписание и зачисление." time={null} last />
            </ol>
          </Card>

          <Card>
            <div className="card-head"><div><span className="eyebrow">Хронология</span><h2>История событий</h2></div><span className="muted small">Синхронизировано с сервером</span></div>
            <Timeline events={app.events} />
          </Card>

          <Card>
            <div className="card-head"><div><span className="eyebrow">Файлы</span><h2>Документы заявки</h2></div><Badge tone="neutral">{app.documents.length}</Badge></div>
            {app.documents.length === 0 ? (
              <p className="muted">Документы не приложены. Заявка может рассматриваться без них, если данных достаточно.</p>
            ) : (
              <div className="document-list">
                {app.documents.map((doc) => (
                  <div className="document-row" key={doc.id}>
                    <span className="file-badge"><FileText size={17} /></span>
                    <div><strong>{doc.original_name}</strong><small>{(doc.size_bytes / 1024).toFixed(0)} КБ · {formatDate(doc.created_at)}</small></div>
                    <button className="icon-button" onClick={() => downloadDocument(app.id, doc.id, doc.original_name, "client")} aria-label="Скачать документ"><Download size={17} /></button>
                  </div>
                ))}
              </div>
            )}
            {["DRAFT", "NEED_INFO"].includes(app.status) && <Link className="text-link" to={app.status === "DRAFT" ? `/app/applications/new?draft=${app.id}` : route}>Добавить документы <ArrowRight size={14} /></Link>}
          </Card>
        </div>

        <aside className="detail-aside">
          <Card>
            <div className="card-head"><h2>Параметры заявки</h2></div>
            <div className="summary-lines">
              <div><span>Продукт</span><strong>{app.product.name}</strong></div>
              <div><span>Запрошенная сумма</span><strong>{formatMoney(app.amount)}</strong></div>
              <div><span>Срок</span><strong>{app.term_months} мес.</strong></div>
              <div><span>Ставка</span><strong>от {app.product.rate.toFixed(1).replace(".", ",")}%</strong></div>
              <div><span>Цель</span><strong>{app.purpose_label}</strong></div>
              <div><span>Обеспечение</span><strong>{app.collateral ? "Да" : "Нет"}</strong></div>
              <div><span>Платёж (оценка)</span><strong>{formatMoney(monthlyPayment)} / мес.</strong></div>
            </div>
          </Card>

          <Card>
            <div className="card-head"><h2><Building2 size={18} /> Компания</h2></div>
            <div className="summary-lines">
              <div><span>Наименование</span><strong>{app.company_name}</strong></div>
              <div><span>ИНН</span><strong>{app.company_inn}</strong></div>
              {app.registry_snapshot && <><div><span>Статус</span><strong>{app.registry_snapshot.status}</strong></div><div><span>ОКВЭД</span><strong>{app.registry_snapshot.okved}</strong></div></>}
            </div>
            <Link className="text-link" to="/app/company">Профиль компании <ArrowRight size={14} /></Link>
          </Card>

        </aside>
      </div>
    </div>
  );
}

function StageItem({
  index,
  title,
  text,
  done,
  active,
  time,
  last = false
}: {
  index: number;
  title: string;
  text: string;
  done: boolean;
  active: boolean;
  time: string | null;
  last?: boolean;
}) {
  return (
    <li className={`stage-item ${done ? "done" : ""} ${active ? "active" : ""} ${last ? "last" : ""}`}>
      <span className="stage-marker">{done ? <CheckCircle2 size={18} /> : index}</span>
      <div>
        <div className="stage-head"><strong>{title}</strong>{(done || active) && <span className={`badge ${done ? "badge-success" : "badge-info"}`}>{done ? "Завершено" : "В процессе"}</span>}{time && <time>{formatDateTime(time)}</time>}</div>
        <p>{text}</p>
      </div>
    </li>
  );
}
