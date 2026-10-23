import { useQuery } from "@tanstack/react-query";
import { Building2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { api } from "../api";
import { Alert, Badge, Button, Card, EmptyState, formatDate, formatMoney, LoadingBlock, PageHeader } from "../components/ui";

export default function CompanyPage() {
  const query = useQuery({ queryKey: ["client-company"], queryFn: api.client.company });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 size={26} />}
          title="Профиль компании недоступен"
          description="Сервис реестра временно не отвечает. Повторите попытку позже."
          action={<Button onClick={() => query.refetch()} icon={<RefreshCw size={16} />}>Обновить</Button>}
        />
      </Card>
    );
  }
  const data = query.data!;
  const company = data.company;
  if (!company) {
    return (
      <div className="page-stack">
        <PageHeader title="Компания" description="Реквизиты и финансовые показатели компании." />
        <Alert tone="warning" title="Компания не привязана">Укажите ИНН при создании заявки — профиль заполнится автоматически.</Alert>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={company.name}
        description="Реквизиты из реестра."
        actions={<Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => query.refetch()}>Обновить</Button>}
      />
      <div className="company-hero">
        <Card className="company-summary">
          <div className="company-logo"><Building2 size={30} /></div>
          <div>
            <div className="inline-meta"><Badge tone={company.status === "Действующая" ? "success" : "danger"}>{company.status}</Badge><span>{company.legal_form}</span></div>
            <h2>{company.name}</h2>
            <p>ИНН {company.inn} · ОКВЭД {company.okved} · {company.okved_name}</p>
          </div>
          <span className="source-pill"><ShieldCheck size={15} /> {data.source}</span>
        </Card>
        <Card className="company-finance">
          <span className="eyebrow">Финансы за {company.financial_year}</span>
          <div className="finance-row"><div><span>Выручка</span><strong>{formatMoney(company.revenue)}</strong></div><div><span>Прибыль</span><strong>{formatMoney(company.profit)}</strong></div></div>
          <div className="finance-row"><div><span>Сотрудники</span><strong>{company.employees ?? "—"}</strong></div><div><span>Капитал</span><strong>{formatMoney(company.authorized_capital)}</strong></div></div>
        </Card>
      </div>
      <div className="two-columns">
        <Card>
          <div className="card-head"><h2>Реквизиты</h2></div>
          <dl className="details-list">
            <div><dt>Полное наименование</dt><dd>{company.name}</dd></div>
            <div><dt>ИНН</dt><dd>{company.inn}</dd></div>
            <div><dt>Организационно-правовая форма</dt><dd>{company.legal_form}</dd></div>
            <div><dt>Дата регистрации</dt><dd>{formatDate(company.registration_date)}</dd></div>
            <div><dt>Основной ОКВЭД</dt><dd>{company.okved} — {company.okved_name}</dd></div>
            <div><dt>Юридический адрес</dt><dd>{company.address}</dd></div>
            <div><dt>Руководитель</dt><dd>{company.director}</dd></div>
          </dl>
        </Card>
        <Card>
          <div className="card-head"><h2><Users size={19} /> Учредители</h2></div>
          <div className="founders">
            {company.founders.map((founder) => (
              <div key={founder.name}><span className="avatar avatar-small">{founder.name.slice(0, 1)}</span><div><strong>{founder.name}</strong><small>Доля {founder.share}%</small></div></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
