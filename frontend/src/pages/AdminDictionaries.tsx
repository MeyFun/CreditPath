import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, History, Newspaper, Pencil, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  formatDate,
  formatMoney,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  useToast
} from "../components/ui";
import type { AdminNewsItem, Product } from "../types";

type Tab = "products" | "scoring" | "news";

const SCORING_FIELDS: { path: string; label: string; group: string; step?: number }[] = [
  { path: "base_score", label: "Базовая оценка", group: "База", step: 1 },
  { path: "age.lt_1_year", label: "Возраст < 1 года", group: "Возраст бизнеса", step: 1 },
  { path: "age.from_3_to_7_years", label: "Возраст 3–7 лет", group: "Возраст бизнеса", step: 1 },
  { path: "age.gt_7_years", label: "Возраст > 7 лет", group: "Возраст бизнеса", step: 1 },
  { path: "amount_to_revenue.high_threshold", label: "Порог высокой суммы к выручке", group: "Сумма к выручке", step: 0.05 },
  { path: "amount_to_revenue.high_penalty", label: "Штраф за высокую сумму", group: "Сумма к выручке", step: 1 },
  { path: "amount_to_revenue.low_threshold", label: "Порог комфортной суммы", group: "Сумма к выручке", step: 0.05 },
  { path: "amount_to_revenue.low_bonus", label: "Бонус за комфортную сумму", group: "Сумма к выручке", step: 1 },
  { path: "profit.loss_penalty", label: "Штраф за убыток", group: "Прибыль", step: 1 },
  { path: "profit.margin_threshold_percent", label: "Порог рентабельности, %", group: "Прибыль", step: 1 },
  { path: "profit.margin_bonus", label: "Бонус за рентабельность", group: "Прибыль", step: 1 },
  { path: "bki.active_overdue_penalty", label: "Активная просрочка", group: "Кредитная история", step: 1 },
  { path: "bki.closed_overdue_recent_penalty", label: "Недавно закрытая просрочка", group: "Кредитная история", step: 1 },
  { path: "bki.no_overdue_bonus", label: "Нет просрочек", group: "Кредитная история", step: 1 },
  { path: "debt_load.high_threshold", label: "Порог высокой долговой нагрузки", group: "Долговая нагрузка", step: 0.05 },
  { path: "debt_load.high_penalty", label: "Штраф за высокую нагрузку", group: "Долговая нагрузка", step: 1 },
  { path: "debt_load.low_threshold", label: "Порог низкой нагрузки", group: "Долговая нагрузка", step: 0.05 },
  { path: "debt_load.low_bonus", label: "Бонус за низкую нагрузку", group: "Долговая нагрузка", step: 1 },
  { path: "okved.penalty", label: "Рисковый ОКВЭД", group: "Отрасль", step: 1 },
  { path: "collateral.bonus", label: "Бонус за обеспечение", group: "Обеспечение", step: 1 },
  { path: "decision.approve_threshold", label: "Порог одобрения", group: "Кредитная логика", step: 1 },
  { path: "decision.changed_threshold", label: "Порог других условий", group: "Кредитная логика", step: 1 },
  { path: "decision.changed_term_cap_months", label: "Ограничение срока, мес.", group: "Кредитная логика", step: 1 },
  { path: "decision.offer_valid_days", label: "Срок оферты, дней", group: "Кредитная логика", step: 1 }
];

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);
}

function setPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const copy = structuredClone(source);
  const parts = path.split(".");
  let cursor: Record<string, unknown> = copy;
  parts.slice(0, -1).forEach((key) => {
    cursor[key] = { ...(cursor[key] as Record<string, unknown>) };
    cursor = cursor[key] as Record<string, unknown>;
  });
  cursor[parts[parts.length - 1]] = value;
  return copy;
}

export default function AdminDictionaries() {
  const [tab, setTab] = useState<Tab>("products");
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Администрирование"
        title="Справочники и лимиты"
        description="Продукты, параметры скоринга и новости кабинета. Все изменения фиксируются в аудите."
      />
      <div className="tabs-row section-tabs">
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><BookOpenCheck size={16} /> Продукты</button>
        <button className={tab === "scoring" ? "active" : ""} onClick={() => setTab("scoring")}><SlidersHorizontal size={16} /> Параметры скоринга</button>
        <button className={tab === "news" ? "active" : ""} onClick={() => setTab("news")}><Newspaper size={16} /> Новости</button>
      </div>
      {tab === "products" ? <ProductsTab /> : tab === "scoring" ? <ScoringTab /> : <NewsTab />}
    </div>
  );
}

function ProductsTab() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = useQuery({ queryKey: ["admin-products"], queryFn: api.admin.products });
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.admin.updateProduct(editing!.id, {
        name: form.name,
        short_description: form.short_description,
        description: form.description,
        min_amount: Number(form.min_amount),
        max_amount: Number(form.max_amount),
        min_term_months: Number(form.min_term_months),
        max_term_months: Number(form.max_term_months),
        rate: Number(form.rate),
        min_business_age_months: Number(form.min_business_age_months),
        revenue_limit_ratio: Number(form.revenue_limit_ratio),
        requires_collateral: form.requires_collateral === "true",
        is_active: form.is_active === "true"
      }),
    onSuccess: () => {
      push("Продукт обновлён", "success");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["public-products"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось обновить продукт")
  });

  function open(product: Product) {
    setEditing(product);
    setError("");
    setForm({
      name: product.name,
      short_description: product.short_description,
      description: product.description,
      min_amount: String(product.min_amount),
      max_amount: String(product.max_amount),
      min_term_months: String(product.min_term_months),
      max_term_months: String(product.max_term_months),
      rate: String(product.rate),
      min_business_age_months: String(product.min_business_age_months),
      revenue_limit_ratio: String(product.revenue_limit_ratio),
      requires_collateral: String(product.requires_collateral),
      is_active: String(product.is_active)
    });
  }

  if (query.isLoading) return <LoadingBlock />;

  return (
    <>
      <Card>
        <div className="card-head"><div><span className="eyebrow">Справочник</span><h2>Кредитные продукты</h2></div><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => query.refetch()}>Обновить</Button></div>
        <div className="product-admin-list">
          {query.data?.map((product) => (
            <div className="product-admin-row" key={product.id}>
              <div><strong>{product.name}</strong><small>{product.code} · {formatMoney(product.min_amount)} — {formatMoney(product.max_amount)} · {product.rate}%</small></div>
              <div className="inline-meta"><Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Активен" : "Скрыт"}</Badge>{product.requires_collateral && <Badge tone="info">Залог</Badge>}</div>
              <Button variant="secondary" className="btn-sm" icon={<Pencil size={14} />} onClick={() => open(product)}>Изменить</Button>
            </div>
          ))}
        </div>
      </Card>
      <Modal open={Boolean(editing)} title={`Редактирование: ${editing?.name ?? ""}`} onClose={() => setEditing(null)} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Отмена</Button><Button loading={mutation.isPending} onClick={() => mutation.mutate()}>Сохранить</Button></>}>
        {editing && (
          <div className="modal-form">
            <Field label="Название"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Краткое описание"><Input value={form.short_description} onChange={(event) => setForm({ ...form, short_description: event.target.value })} /></Field>
            <Field label="Описание"><textarea className="input textarea" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
            <div className="form-grid">
              <Field label="Мин. сумма"><Input type="number" value={form.min_amount} onChange={(event) => setForm({ ...form, min_amount: event.target.value })} /></Field>
              <Field label="Макс. сумма"><Input type="number" value={form.max_amount} onChange={(event) => setForm({ ...form, max_amount: event.target.value })} /></Field>
              <Field label="Мин. срок, мес."><Input type="number" value={form.min_term_months} onChange={(event) => setForm({ ...form, min_term_months: event.target.value })} /></Field>
              <Field label="Макс. срок, мес."><Input type="number" value={form.max_term_months} onChange={(event) => setForm({ ...form, max_term_months: event.target.value })} /></Field>
              <Field label="Ставка, %"><Input type="number" step="0.1" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></Field>
              <Field label="Мин. возраст, мес."><Input type="number" value={form.min_business_age_months} onChange={(event) => setForm({ ...form, min_business_age_months: event.target.value })} /></Field>
              <Field label="Лимит к выручке"><Input type="number" step="0.05" value={form.revenue_limit_ratio} onChange={(event) => setForm({ ...form, revenue_limit_ratio: event.target.value })} /></Field>
              <Field label="Требуется залог"><select className="input" value={form.requires_collateral} onChange={(event) => setForm({ ...form, requires_collateral: event.target.value })}><option value="false">Нет</option><option value="true">Да</option></select></Field>
            </div>
            <Field label="Доступность"><select className="input" value={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.value })}><option value="true">Активен</option><option value="false">Скрыт</option></select></Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Alert tone="info">Изменение фиксируется в журнале аудита. Новые заявки используют обновлённые параметры.</Alert>
          </div>
        )}
      </Modal>
    </>
  );
}

function ScoringTab() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = useQuery({ queryKey: ["admin-scoring"], queryFn: api.admin.scoringConfig });
  const history = useQuery({ queryKey: ["admin-scoring-history"], queryFn: api.admin.scoringHistory });
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.admin.updateScoringConfig(config!),
    onSuccess: (data) => {
      push(`Создана версия скоринга v${data.version}`, "success");
      queryClient.invalidateQueries({ queryKey: ["admin-scoring"] });
      queryClient.invalidateQueries({ queryKey: ["admin-scoring-history"] });
      setConfig(data.config);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось сохранить параметры")
  });

  useEffect(() => {
    if (query.data) setConfig(structuredClone(query.data.config));
  }, [query.data]);

  if (query.isLoading || !config) return <LoadingBlock />;
  const groups = [...new Set(SCORING_FIELDS.map((field) => field.group))];

  return (
    <div className="scoring-admin-grid">
      <Card>
        <div className="card-head"><div><span className="eyebrow">Версия {query.data?.version}</span><h2>Параметры скоринга</h2></div><Badge tone="success">Активна</Badge></div>
        {error && <Alert tone="danger">{error}</Alert>}
        {groups.map((group) => (
          <div className="config-group" key={group}>
            <h3>{group}</h3>
            <div className="config-fields">
              {SCORING_FIELDS.filter((field) => field.group === group).map((field) => (
                <Field key={field.path} label={field.label}>
                  <Input
                    type="number"
                    step={field.step ?? 1}
                    value={String(getPath(config, field.path) ?? "")}
                    onChange={(event) => setConfig((current) => current ? setPath(current, field.path, Number(event.target.value)) : current)}
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
        <Field label="Рисковые префиксы ОКВЭД" hint="Через запятую">
          <Input value={((getPath(config, "okved.risky_prefixes") as string[]) ?? []).join(", ")} onChange={(event) => setConfig((current) => current ? setPath(current, "okved.risky_prefixes", event.target.value.split(",").map((item) => item.trim()).filter(Boolean)) : current)} />
        </Field>
        <div className="config-actions">
          <Button variant="secondary" onClick={() => setConfig(structuredClone(query.data!.config))}>Сбросить</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>Сохранить новую версию</Button>
        </div>
        <Alert tone="info">Сохранение создаёт новую версию. Старые заявки не пересчитываются; новые используют активную версию.</Alert>
      </Card>
      <Card>
        <div className="card-head"><div><span className="eyebrow">История</span><h2><History size={18} /> Версии</h2></div></div>
        <div className="version-list">
          {history.data?.map((version) => (
            <div className={`version-row ${version.is_active ? "active" : ""}`} key={version.id}>
              <span className="version-number">v{version.version}</span>
              <div><strong>{version.is_active ? "Активная версия" : "Архив"}</strong><small>{formatDate(version.created_at)}</small></div>
              {version.is_active && <Badge tone="success">Сейчас</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const NEWS_STATUSES: { code: string; label: string }[] = [
  { code: "NEED_INFO", label: "Требуется уточнение" },
  { code: "APPROVED", label: "Одобрено" },
  { code: "APPROVED_CHANGED", label: "Одобрено на других условиях" },
  { code: "REJECTED", label: "Отказ" },
  { code: "DISBURSED", label: "Средства перечислены" }
];

const EMPTY_NEWS = {
  title: "",
  body: "",
  okved: "",
  maxAge: "",
  opf: [] as string[],
  products: [] as string[],
  statuses: [] as string[]
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function targetingLabel(item: AdminNewsItem): string {
  const t = item.targeting;
  const parts = [
    t.okved_prefixes?.length && `ОКВЭД ${t.okved_prefixes.join(", ")}`,
    t.opf?.length && t.opf.join("/"),
    t.max_age_months && `до ${t.max_age_months} мес.`,
    t.products?.length && `продукты: ${t.products.join(", ")}`,
    t.statuses?.length && `статусы: ${t.statuses.join(", ")}`
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Все клиенты";
}

function NewsTab() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const news = useQuery({ queryKey: ["admin-news"], queryFn: api.admin.news });
  const products = useQuery({ queryKey: ["admin-products"], queryFn: api.admin.products });
  const [form, setForm] = useState(EMPTY_NEWS);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.admin.createNews({
        title: form.title,
        body: form.body,
        category: "admin",
        targeting: {
          okved_prefixes: form.okved.split(",").map((item) => item.trim()).filter(Boolean),
          opf: form.opf,
          products: form.products,
          statuses: form.statuses,
          max_age_months: form.maxAge ? Number(form.maxAge) : null
        }
      }),
    onSuccess: () => {
      push("Новость опубликована", "success");
      setOpen(false);
      setForm(EMPTY_NEWS);
      queryClient.invalidateQueries({ queryKey: ["admin-news"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Не удалось опубликовать новость")
  });

  const toggleActive = useMutation({
    mutationFn: (item: AdminNewsItem) => api.admin.updateNews(item.id, { is_active: !item.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-news"] }),
    onError: (err) => push(err instanceof ApiError ? err.message : "Не удалось изменить новость", "danger")
  });

  if (news.isLoading) return <LoadingBlock />;
  if (news.isError) return <Alert tone="danger">Не удалось загрузить новости.</Alert>;

  return (
    <>
      <Card>
        <div className="card-head">
          <div><span className="eyebrow">Лента клиентов</span><h2>Новости и таргетинг</h2></div>
          <Button icon={<Plus size={16} />} onClick={() => { setError(""); setOpen(true); }}>Новая новость</Button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Новость</th><th>Кому показывается</th><th>Дата</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {news.data!.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.title}</strong><small className="block muted">{item.body}</small></td>
                  <td>{targetingLabel(item)}</td>
                  <td>{formatDate(item.published_at)}</td>
                  <td>{item.is_active ? <Badge tone="success">Опубликована</Badge> : <Badge tone="neutral">Скрыта</Badge>}</td>
                  <td>
                    <Button
                      variant="ghost"
                      className="btn-sm"
                      loading={toggleActive.isPending && toggleActive.variables?.id === item.id}
                      onClick={() => toggleActive.mutate(item)}
                    >
                      {item.is_active ? "Скрыть" : "Показать"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal
        open={open}
        title="Новая новость"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button loading={create.isPending} disabled={form.title.trim().length < 3 || form.body.trim().length < 3} onClick={() => create.mutate()}>Опубликовать</Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Заголовок"><Input value={form.title} maxLength={160} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
        <Field label="Текст"><textarea className="input textarea" rows={3} value={form.body} maxLength={4000} onChange={(event) => setForm({ ...form, body: event.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Префиксы ОКВЭД" hint="Через запятую, например 46, 47.1"><Input value={form.okved} onChange={(event) => setForm({ ...form, okved: event.target.value })} /></Field>
          <Field label="Возраст бизнеса до, мес." hint="Пусто — без ограничения"><Input type="number" min={1} value={form.maxAge} onChange={(event) => setForm({ ...form, maxAge: event.target.value })} /></Field>
        </div>
        <fieldset className="news-targeting">
          <legend>Форма бизнеса</legend>
          {["ООО", "ИП"].map((opf) => (
            <label className="inline-checkbox" key={opf}><input type="checkbox" checked={form.opf.includes(opf)} onChange={() => setForm({ ...form, opf: toggle(form.opf, opf) })} />{opf}</label>
          ))}
        </fieldset>
        <fieldset className="news-targeting">
          <legend>Продукт в заявках</legend>
          {(products.data ?? []).map((product) => (
            <label className="inline-checkbox" key={product.code}><input type="checkbox" checked={form.products.includes(product.code)} onChange={() => setForm({ ...form, products: toggle(form.products, product.code) })} />{product.name}</label>
          ))}
        </fieldset>
        <fieldset className="news-targeting">
          <legend>Статус заявки</legend>
          {NEWS_STATUSES.map((status) => (
            <label className="inline-checkbox" key={status.code}><input type="checkbox" checked={form.statuses.includes(status.code)} onChange={() => setForm({ ...form, statuses: toggle(form.statuses, status.code) })} />{status.label}</label>
          ))}
        </fieldset>
        <p className="muted">Без условий новость увидят все клиенты. Каждое выбранное условие обязательно.</p>
      </Modal>
    </>
  );
}
