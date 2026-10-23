import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, History, Pencil, RefreshCw, SlidersHorizontal } from "lucide-react";
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
import type { Product } from "../types";

type Tab = "products" | "scoring";

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
        description="Продукты и параметры скоринга."
      />
      <div className="tabs-row section-tabs">
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><BookOpenCheck size={16} /> Продукты</button>
        <button className={tab === "scoring" ? "active" : ""} onClick={() => setTab("scoring")}><SlidersHorizontal size={16} /> Параметры скоринга</button>
      </div>
      {tab === "products" ? <ProductsTab /> : <ScoringTab />}
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
