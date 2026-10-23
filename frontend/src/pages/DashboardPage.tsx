import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BellRing,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Plus,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  formatMoney,
  formatShortDate,
  LoadingBlock,
  StatusBadge
} from "../components/ui";
import type { ApplicationSummary } from "../types";

export default function DashboardPage() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["client-dashboard"], queryFn: api.client.dashboard });

  if (query.isLoading) return <LoadingBlock label="Собираем данные кабинета…" />;
  if (query.isError) {
    return <Card><EmptyState title="Не удалось загрузить кабинет" description="Обновите страницу или повторите позже." action={<Button onClick={() => query.refetch()}>Повторить</Button>} /></Card>;
  }
  const data = query.data!;
  const active = data.applications.filter((app) => !["DRAFT", "REJECTED", "OFFER_DECLINED", "DISBURSED"].includes(app.status));
  const next = data.applications.find((app) => app.status === "NEED_INFO") ?? active[0];
  const firstName = user?.full_name.split(" ")[1] ?? user?.full_name.split(" ")[0] ?? "";
  const company = data.company;

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <span className="eyebrow">Личный кабинет заёмщика</span>
          <h1>Добрый день, {firstName}!</h1>
          <p>Рады видеть вас в CreditPath. Ключевые показатели и статусы — под рукой.</p>
        </div>
        <div className="welcome-actions">
          <Link className="btn btn-secondary" to="/app/products">Подобрать продукт</Link>
          <Link className="btn btn-primary" to="/app/applications/new"><Plus size={17} /> Новая заявка</Link>
        </div>
      </div>

      {next && (
        <Card className={`next-action ${next.status === "NEED_INFO" ? "next-action-warning" : ""}`}>
          <span className="next-action-icon">{next.status === "NEED_INFO" ? <BellRing size={23} /> : <Clock3 size={23} />}</span>
          <div className="next-action-body">
            <span className="eyebrow">Что дальше?</span>
            <h2>{next.status === "NEED_INFO" ? "Нужны уточнения по заявке" : next.status === "DRAFT" ? "Завершите черновик" : "Следующий шаг по заявке"}</h2>
            <p>
              {next.status === "NEED_INFO"
                ? "Банк ждёт ответ на запрос. Откройте заявку и дополните данные — проверки продолжатся автоматически."
                : next.status === "DRAFT"
                  ? "Черновик сохранён. Проверьте параметры и отправьте заявку на рассмотрение."
                  : `Заявка ${next.number} на ${formatMoney(next.amount)} находится в работе.`}
            </p>
            <div className="inline-meta">
              <StatusBadge status={next.status} />
              <span>{next.product.name}</span>
              <span>№ {next.number}</span>
            </div>
          </div>
          <div className="next-action-actions">
            <Link className="btn btn-primary" to={next.status === "DRAFT" ? `/app/applications/new?draft=${next.id}` : `/app/applications/${next.id}`}>
              {next.status === "NEED_INFO" ? "Ответить" : next.status === "DRAFT" ? "Продолжить" : "Открыть заявку"} <ArrowRight size={16} />
            </Link>
            <Link className="btn btn-ghost" to={`/app/applications/${next.id}`}>Все детали</Link>
          </div>
        </Card>
      )}

      <div className="kpi-grid">
        <Card className="kpi-card">
          <span className="kpi-icon kpi-icon-red"><WalletCards size={20} /></span>
          <div><span>Доступный лимит (демо)</span><strong>{formatMoney(data.total_approved_amount || 7_500_000)}</strong><small>Рассчитан по одобренным заявкам</small></div>
        </Card>
        <Card className="kpi-card">
          <span className="kpi-icon kpi-icon-blue"><Clock3 size={20} /></span>
          <div><span>В работе</span><strong>{data.counts.active ?? 0}</strong><small>{data.counts.needs_action ? `${data.counts.needs_action} требует действия` : "Нет срочных действий"}</small></div>
        </Card>
        <Card className="kpi-card">
          <span className="kpi-icon kpi-icon-green"><CheckCircle2 size={20} /></span>
          <div><span>Одобрено</span><strong>{data.counts.approved ?? 0}</strong><small>Решений по заявкам</small></div>
        </Card>
        <Card className="kpi-card">
          <span className="kpi-icon kpi-icon-amber"><BellRing size={20} /></span>
          <div><span>Уведомления</span><strong>{data.unread_notifications}</strong><small>{data.unread_notifications ? "Есть непрочитанные" : "Всё прочитано"}</small></div>
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="company-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Профиль компании</span>
              <h2>{company?.name ?? "Компания пока не привязана"}</h2>
            </div>
            {company && <Badge tone={company.status === "Действующая" ? "success" : "danger"}>{company.status}</Badge>}
          </div>
          {company ? (
            <>
              <div className="company-meta-grid">
                <div><span>ИНН</span><strong>{company.inn}</strong></div>
                <div><span>ОПФ</span><strong>{company.legal_form}</strong></div>
                <div><span>Регистрация</span><strong>{formatDate(company.registration_date)}</strong></div>
                <div><span>ОКВЭД</span><strong>{company.okved}</strong></div>
                <div><span>Руководитель</span><strong>{company.director}</strong></div>
                <div><span>Выручка за {company.financial_year}</span><strong>{formatMoney(company.revenue)}</strong></div>
              </div>
              <div className="company-footer">
                <span><ShieldCheck size={16} /> Снимок из демонстрационного реестра</span>
                <Link to="/app/company">Профиль компании <ArrowRight size={15} /></Link>
              </div>
            </>
          ) : (
            <p className="muted">Укажите ИНН в первой заявке — данные компании подтянутся автоматически.</p>
          )}
        </Card>
        <Card className="tip-card">
          <span className="tip-icon"><Sparkles size={20} /></span>
          <h3>Как ускорить решение</h3>
          <ul>
            <li>Проверьте ИНН до отправки — данные заполнятся автоматически.</li>
            <li>Приложите финансовые документы в PDF или изображении.</li>
            <li>Отвечайте на запросы уточнений в кабинете.</li>
          </ul>
          <Link to="/#faq" className="text-link">Открыть FAQ <ArrowRight size={15} /></Link>
        </Card>
      </div>

      <Card className="apps-card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Кредитный портфель</span>
            <h2>Заявки на финансирование</h2>
          </div>
          <div className="card-head-actions">
            <Link className="btn btn-ghost" to="/app/applications">Все заявки <ArrowRight size={15} /></Link>
            <Link className="btn btn-primary btn-sm" to="/app/applications/new"><Plus size={16} /> Новая</Link>
          </div>
        </div>
        {data.applications.length === 0 ? (
          <EmptyState
            icon={<FileText size={25} />}
            title="Заявок пока нет"
            description="Выберите продукт и отправьте первую демонстрационную заявку."
            action={<Link className="btn btn-primary" to="/app/applications/new"><Plus size={16} /> Создать заявку</Link>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Заявка и продукт</th><th>Сумма</th><th>Дата</th><th>Статус</th><th /></tr></thead>
              <tbody>
                {data.applications.map((item) => <ApplicationRow key={item.id} app={item} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="dashboard-footer-grid">
        <Card className="mini-info-card">
          <span className="mini-icon"><Building2 size={20} /></span>
          <div><strong>Профиль компании</strong><p>Реквизиты и финансовые показатели из реестра.</p><Link to="/app/company">Перейти <ArrowRight size={14} /></Link></div>
        </Card>
        <Card className="mini-info-card">
          <span className="mini-icon"><ShieldCheck size={20} /></span>
          <div><strong>Данные защищены</strong><p>Все проверки на сервере, действия фиксируются в аудите.</p><Link to="/app/products">Каталог продуктов <ArrowRight size={14} /></Link></div>
        </Card>
      </div>
    </div>
  );
}

function ApplicationRow({ app }: { app: ApplicationSummary }) {
  return (
    <tr>
      <td>
        <div className="table-primary">
          <span className="file-badge"><FileText size={17} /></span>
          <div><strong>{app.product.name}</strong><small>№ {app.number} · {app.term_months} мес.</small></div>
        </div>
      </td>
      <td><strong>{formatMoney(app.amount)}</strong><small className="block muted">{app.status === "APPROVED_CHANGED" || app.status === "APPROVED" ? `Одобрено: ${formatMoney(app.approved_amount)}` : app.purpose_label}</small></td>
      <td>{formatShortDate(app.submitted_at ?? app.created_at)}</td>
      <td><StatusBadge status={app.status} /></td>
      <td><Link className="row-arrow" to={app.status === "DRAFT" ? `/app/applications/new?draft=${app.id}` : `/app/applications/${app.id}`} aria-label="Открыть заявку"><ArrowRight size={17} /></Link></td>
    </tr>
  );
}
