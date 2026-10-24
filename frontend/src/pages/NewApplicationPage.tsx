import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  Alert,
  Button,
  Card,
  Field,
  formatMoney,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Stepper,
  useToast
} from "../components/ui";
import type { DocumentItem, Product, RegistryCompany } from "../types";

const STEPS = [
  { title: "Цель и продукт", description: "Что финансируем" },
  { title: "Компания", description: "Проверка ИНН" },
  { title: "Параметры", description: "Сумма и срок" },
  { title: "Документы", description: "По желанию" },
  { title: "Проверка и отправка", description: "Финальный шаг" }
];

const DEMO_INNS = [
  ["9900000017", "Здоровая компания → одобрение"],
  ["9900000024", "Активная просрочка → отказ"],
  ["9900000031", "Сумма выше выручки → другие условия"],
  ["9900000049", "Нет финпоказателей → нужны данные"],
  ["9900000056", "Ликвидированная компания"],
  ["990000001246", "ИП"],
  ["9900000063", "Молодая компания"],
  ["9900000070", "Рисковый ОКВЭД"],
  ["9900000088", "Несуществующий ИНН"]
];

function annuity(amount: number, rate: number, months: number) {
  const monthly = rate / 100 / 12;
  if (!months) return 0;
  if (monthly === 0) return amount / months;
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -months));
}

const SIGNER_POSITIONS = [
  ["owner", "Собственник бизнеса"],
  ["ceo", "Генеральный директор"],
  ["cfo", "Финансовый директор"],
  ["accountant", "Бухгалтер"],
  ["authorized", "Уполномоченный сотрудник"],
  ["entrepreneur", "Индивидуальный предприниматель"]
];

const INN_WEIGHTS_10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN_WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN_WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

function innCheck(digits: string, weights: number[]): number {
  return (weights.reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0) % 11) % 10;
}

/** Та же проверка контрольной суммы ФНС, что и на сервере: ошибку видно до запроса в реестр. */
function innError(value: string): string {
  if (!/^\d{10}$|^\d{12}$/.test(value)) return "ИНН должен содержать 10 цифр для юрлица или 12 для ИП";
  const valid = value.length === 10
    ? innCheck(value, INN_WEIGHTS_10) === Number(value[9])
    : innCheck(value, INN_WEIGHTS_11) === Number(value[10]) && innCheck(value, INN_WEIGHTS_12) === Number(value[11]);
  return valid ? "" : "Неверная контрольная сумма ИНН — проверьте цифры";
}

type StepField = "product" | "purpose" | "inn" | "amount" | "term" | "collateral";
interface StepProblem {
  field: StepField;
  message: string;
}

/** Поле, в котором видна ошибка шага: к нему прокручиваем экран и ставим фокус. */
const FIELD_TARGET: Partial<Record<StepField, string>> = {
  inn: "wizard-inn",
  amount: "wizard-amount",
  term: "wizard-term"
};

function newKey() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function NewApplicationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const draftParam = Number(searchParams.get("draft") ?? 0);
  const productParam = searchParams.get("product");

  const productsQuery = useQuery({ queryKey: ["public-products"], queryFn: api.public.products });
  const draftQuery = useQuery({
    queryKey: ["application-draft", draftParam],
    queryFn: () => api.client.application(draftParam),
    enabled: Boolean(draftParam)
  });

  const [draftId, setDraftId] = useState<number | null>(draftParam || null);
  const [step, setStep] = useState(draftParam ? 1 : 0);
  const [initialized, setInitialized] = useState(!draftParam);
  const [productId, setProductId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState("");
  const [inn, setInn] = useState("");
  const [company, setCompany] = useState<RegistryCompany | null>(null);
  const [amount, setAmount] = useState(3_000_000);
  const [term, setTerm] = useState(24);
  const [collateral, setCollateral] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState("");
  // Черновик открыт с ИНН, но без снимка реестра: перепроверяем ИНН автоматически.
  const [autoVerify, setAutoVerify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<StepProblem | null>(null);
  // Направление перехода: шаг въезжает справа при «Продолжить» и слева при «Назад».
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const mainRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [idempotencyKey] = useState(newKey);
  const [signerPosition, setSignerPosition] = useState("ceo");
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false);
  const [consentBki, setConsentBki] = useState(false);
  const [consentPersonalData, setConsentPersonalData] = useState(false);
  const consentsGiven = authorityConfirmed && consentBki && consentPersonalData;

  const products = productsQuery.data ?? [];
  const product = products.find((item) => item.id === productId) ?? null;

  useEffect(() => {
    if (!products.length) return;
    if (productsQuery.data && !productId) {
      const fromQuery = products.find((item) => item.code === productParam);
      const initial = fromQuery ?? products[0];
      setProductId(initial.id);
      setPurpose(initial.purposes[0]?.code ?? "");
      setAmount(Math.min(Math.max(3_000_000, initial.min_amount), initial.max_amount));
      setTerm(Math.min(24, initial.max_term_months));
      setCollateral(initial.requires_collateral);
    }
  }, [products, productsQuery.data, productParam, productId]);

  useEffect(() => {
    if (!draftQuery.data || initialized) return;
    const data = draftQuery.data;
    if (data.status !== "DRAFT") {
      navigate(`/app/applications/${data.id}`, { replace: true });
      return;
    }
    setProductId(data.product.id);
    setPurpose(data.purpose);
    setInn(data.company_inn ?? "");
    setAmount(data.amount);
    setTerm(data.term_months);
    setCollateral(data.collateral);
    setDocuments(data.documents);
    if (data.registry_snapshot) setCompany(data.registry_snapshot);
    else if (data.company_inn) setAutoVerify(true);
    setDraftId(data.id);
    setInitialized(true);
  }, [draftQuery.data, initialized, navigate]);

  useEffect(() => {
    if (product) {
      setCollateral((value) => (product.requires_collateral ? true : value));
    }
  }, [productId]);

  useEffect(() => {
    if (!autoVerify || !inn) return;
    setAutoVerify(false);
    void verifyInn();
  }, [autoVerify, inn]);

  // Новый шаг начинается с заголовка: если карточка уехала вверх, возвращаем её в кадр.
  useEffect(() => {
    const top = mainRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const payment = useMemo(() => (product ? annuity(amount, product.rate, term) : 0), [product, amount, term]);

  function selectProduct(next: Product) {
    setProductId(next.id);
    setPurpose(next.purposes[0]?.code ?? "");
    setAmount(Math.min(Math.max(3_000_000, next.min_amount), next.max_amount));
    setTerm(Math.min(24, next.max_term_months));
    setCollateral(next.requires_collateral);
    setError("");
    setProblem(null);
  }

  async function verifyInn() {
    setRegistryError("");
    setCompany(null);
    setProblem(null);
    const formatError = innError(inn);
    if (formatError) {
      setRegistryError(formatError);
      return;
    }
    setSignerPosition(inn.length === 12 ? "entrepreneur" : "ceo");
    setRegistryLoading(true);
    try {
      const data = await api.public.registry(inn);
      setCompany(data.company);
      if (data.company.status !== "Действующая") {
        setRegistryError("Компания не действует. Заявку можно создать, но решение будет отрицательным.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setRegistryError("Компания с таким ИНН не найдена в реестре. Проверьте номер.");
      } else {
        setRegistryError(err instanceof ApiError ? err.message : "Не удалось проверить ИНН");
      }
    } finally {
      setRegistryLoading(false);
    }
  }

  async function ensureDraft(): Promise<number> {
    if (draftId) return draftId;
    if (!product) throw new Error("Выберите продукт");
    const created = await api.client.create({
      product_id: product.id,
      amount,
      term_months: term,
      purpose,
      company_inn: inn || undefined,
      // Пустая строка, а не undefined: сервер должен забыть название прежней компании.
      company_name: company?.name ?? "",
      collateral
    });
    setDraftId(created.id);
    navigate(`/app/applications/new?draft=${created.id}`, { replace: true });
    setDocuments(created.documents);
    return created.id;
  }

  async function persist(): Promise<number> {
    const id = await ensureDraft();
    await api.client.update(id, {
      product_id: productId,
      amount,
      term_months: term,
      purpose,
      company_inn: inn || undefined,
      // Пустая строка, а не undefined: сервер должен забыть название прежней компании.
      company_name: company?.name ?? "",
      collateral
    });
    setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
    queryClient.invalidateQueries({ queryKey: ["application-draft", id] });
    return id;
  }

  async function saveOnly() {
    setError("");
    setSaving(true);
    try {
      await persist();
      push("Черновик сохранён", "success");
    } catch (err) {
      // Кнопка в шапке: ошибка у нижних кнопок была бы вне экрана, поэтому — тостом.
      push(err instanceof ApiError ? err.message : "Не удалось сохранить черновик", "danger");
    } finally {
      setSaving(false);
    }
  }

  const amountError = product && (amount < product.min_amount || amount > product.max_amount)
    ? `Сумма должна быть от ${formatMoney(product.min_amount)} до ${formatMoney(product.max_amount)}`
    : "";
  const termError = product && (!Number.isInteger(term) || term < product.min_term_months || term > product.max_term_months)
    ? `Срок должен быть от ${product.min_term_months} до ${product.max_term_months} месяцев`
    : "";

  function validateStep(current: number): StepProblem | null {
    if (current === 0) {
      if (!product) return { field: "product", message: "Выберите продукт" };
      if (!purpose) return { field: "purpose", message: "Выберите цель кредита" };
    }
    if (current === 1 && !company) {
      return { field: "inn", message: registryError || "Нажмите «Проверить», чтобы найти компанию по ИНН" };
    }
    if (current === 2 && product) {
      if (amountError) return { field: "amount", message: amountError };
      if (termError) return { field: "term", message: termError };
      if (product.requires_collateral && !collateral) return { field: "collateral", message: "Для продукта требуется обеспечение" };
    }
    return null;
  }

  /** Ошибку видно сразу: экран едет к полю (или к сообщению у кнопок), фокус — в поле. */
  function revealProblem(found: StepProblem) {
    setProblem(found);
    requestAnimationFrame(() => {
      const targetId = FIELD_TARGET[found.field];
      const target = targetId ? document.getElementById(targetId) : null;
      (target ?? errorRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
  }

  function back() {
    setError("");
    setProblem(null);
    setDirection("back");
    setStep((value) => Math.max(0, value - 1));
  }

  async function removeDraft() {
    if (!draftId) return;
    setDeleting(true);
    try {
      await api.client.remove(draftId);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard"] });
      push("Черновик удалён", "success");
      navigate("/app/applications", { replace: true });
    } catch (err) {
      setConfirmDelete(false);
      setError(err instanceof ApiError ? err.message : "Не удалось удалить черновик");
    } finally {
      setDeleting(false);
    }
  }

  async function next() {
    setError("");
    const found = validateStep(step);
    if (found) {
      revealProblem(found);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await persist();
      setDirection("forward");
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить шаг");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setUploading(true);
    try {
      const id = await ensureDraft();
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`Файл «${file.name}» больше 10 МБ`);
          continue;
        }
        const uploaded = await api.client.upload(id, file);
        setDocuments((current) => [...current, uploaded]);
      }
      queryClient.invalidateQueries({ queryKey: ["application-draft", id] });
      push("Документы загружены", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить документ");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const id = await persist();
      const submitted = await api.client.submit(id, idempotencyKey, {
        signer_position: signerPosition,
        authority_confirmed: authorityConfirmed,
        consent_bki: consentBki,
        consent_personal_data: consentPersonalData
      });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["client-dashboard"] });
      push("Заявка отправлена. Автоматические проверки начались.", "success");
      navigate(`/app/applications/${submitted.id}?submitted=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить заявку");
    } finally {
      setSubmitting(false);
    }
  }

  // После первого сохранения в URL появляется ?draft=: мастер уже заполнен, лоадер не нужен.
  if (productsQuery.isLoading || (draftParam && draftQuery.isLoading && !initialized)) {
    return <LoadingBlock label="Готовим мастер заявки…" />;
  }
  if (draftQuery.isError) {
    return (
      <Card>
        <Alert tone="danger" title="Черновик не найден">Вернитесь к списку заявок и создайте новую.</Alert>
        <Link className="btn btn-secondary" to="/app/applications">К моим заявкам</Link>
      </Card>
    );
  }
  if (!product) return <LoadingBlock />;

  return (
    <div className="wizard-page">
      <div className="wizard-header">
        <Link to="/app/applications" className="back-link"><ArrowLeft size={17} /> К моим заявкам</Link>
        <div className="wizard-title-row">
          <div>
            
            <h1>Новая заявка на кредит</h1>
            <p>Около 10 минут. Черновик сохраняется на каждом шаге.</p>
          </div>
          <div className="wizard-save">
            {draftId && <Button variant="ghost" onClick={() => setConfirmDelete(true)} icon={<Trash2 size={16} />}>Удалить черновик</Button>}
            {savedAt ? <span className="saved-note"><CheckCircle2 size={16} /> Черновик сохранён в {savedAt}</span> : <span className="muted small">{draftId ? "Черновик" : "Новый черновик"}</span>}
            <Button variant="secondary" onClick={saveOnly} loading={saving} icon={<FileText size={16} />}>Сохранить черновик</Button>
          </div>
        </div>
        <Stepper steps={STEPS} current={step} />
      </div>

      <div className="wizard-grid">
        <div className="card wizard-main" ref={mainRef}>
          {step === 0 && (
            <div className={`wizard-step step-${direction}`}>
              <div className="step-heading"><span className="step-chip">Шаг 1 из 5</span><h2>Выберите условия и цель кредитования</h2><p>Мы подстроим расчёт под продукт и цель.</p></div>
              <h3 className="subheading">Кредитный продукт</h3>
              <div className="wizard-products">
                {products.map((item) => (
                  <button key={item.id} type="button" className={`wizard-product ${product.id === item.id ? "selected" : ""}`} onClick={() => selectProduct(item)}>
                    <span className="radio-circle">{product.id === item.id && <span />}</span>
                    <span><strong>{item.name}</strong><small>{item.short_description}</small><em>от {item.rate.toFixed(1).replace(".", ",")}% · {item.min_term_months}–{item.max_term_months} мес.</em></span>
                  </button>
                ))}
              </div>
              <h3 className="subheading">Цель кредитования</h3>
              <div className="purpose-grid">
                {product.purposes.map((item) => (
                  <button key={item.code} type="button" className={`purpose-option ${purpose === item.code ? "selected" : ""}`} onClick={() => setPurpose(item.code)}>
                    <span className="radio-circle">{purpose === item.code && <span />}</span>
                    <span><strong>{item.label}</strong><small>Соответствует продукту «{product.name}»</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className={`wizard-step step-${direction}`}>
              <div className="step-heading"><span className="step-chip">Шаг 2 из 5</span><h2>Сведения о компании</h2><p>Введите ИНН — реквизиты заполнятся автоматически.</p></div>
              <Field label="ИНН организации (10 цифр) или ИП (12 цифр)" required error={company ? "" : registryError || (problem?.field === "inn" ? problem.message : "")}>
                <div className="inn-row">
                  <div className="input-icon-wrap"><Building2 size={18} /><Input id="wizard-inn" value={inn} aria-invalid={!company && Boolean(registryError || problem?.field === "inn")} onChange={(event) => { setInn(event.target.value.replace(/\D/g, "").slice(0, 12)); setCompany(null); setRegistryError(""); setProblem(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void verifyInn(); } }} inputMode="numeric" placeholder="10 или 12 цифр" /></div>
                  <Button variant="secondary" onClick={verifyInn} loading={registryLoading} icon={registryLoading ? undefined : <RefreshCw size={16} />}>Проверить</Button>
                </div>
              </Field>
              {company && registryError && <Alert tone="warning">{registryError}</Alert>}
              {company && (company.revenue == null || company.profit == null) && (
                <Alert tone="warning" title="В реестре нет финансовых показателей">
                  После отправки банк попросит указать выручку и прибыль за последний год — подготовьте цифры из отчётности.
                </Alert>
              )}
              {company && (
                <div className="registry-card">
                  <div className="registry-head">
                    <span className="success-check"><Check size={17} /></span>
                    <div><span className="eyebrow">Найдено в реестре</span><h3>{company.name}</h3><p>ИНН {company.inn} · {company.legal_form}</p></div>
                    <span className={`badge ${company.status === "Действующая" ? "badge-success" : "badge-danger"}`}>{company.status}</span>
                  </div>
                  <div className="registry-grid">
                    <div><span>Дата регистрации</span><strong>{new Date(company.registration_date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</strong></div>
                    <div><span>ОКВЭД</span><strong>{company.okved}</strong></div>
                    <div><span>Руководитель</span><strong>{company.director}</strong></div>
                    <div><span>Выручка за {company.financial_year}</span><strong>{formatMoney(company.revenue)}</strong></div>
                    <div><span>Прибыль</span><strong>{formatMoney(company.profit)}</strong></div>
                    <div><span>Сотрудники</span><strong>{company.employees ?? "—"}</strong></div>
                  </div>
                  <p className="registry-address">{company.address}</p>
                </div>
              )}
              <details className="demo-access">
                <summary>Тестовые данные</summary>
                <div className="demo-inn-list">
                  {DEMO_INNS.map(([value, label]) => (
                    <button key={value} type="button" onClick={() => { setInn(value); setCompany(null); setRegistryError(""); setProblem(null); }}>
                      <code>{value}</code><span>{label}</span>
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}

          {step === 2 && (
            <div className={`wizard-step step-${direction}`}>
              <div className="step-heading"><span className="step-chip">Шаг 3 из 5</span><h2>Параметры кредита</h2><p>Диапазоны ограничены выбранным продуктом.</p></div>
              <div className="amount-display">
                <label htmlFor="wizard-amount">Сумма кредита</label>
                <div className={amountError ? "invalid" : ""}><input id="wizard-amount" type="number" aria-invalid={Boolean(amountError)} value={amount} min={product.min_amount} max={product.max_amount} step={100000} onChange={(event) => setAmount(Number(event.target.value))} /><span>₽</span></div>
                {amountError ? <small className="field-error">{amountError}</small> : <small>{formatMoney(product.min_amount)} — {formatMoney(product.max_amount)}</small>}
              </div>
              <input className="range" type="range" min={product.min_amount} max={product.max_amount} step={100000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label="Сумма кредита" />
              <div className="range-labels"><span>{formatMoney(product.min_amount)}</span><span>{formatMoney(product.max_amount)}</span></div>
              <div className="term-section">
                <div className="calc-row"><span className="calc-label">Срок кредитования</span><strong>{term} мес.</strong></div>
                <div className="term-buttons">
                  {[6, 12, 18, 24, 36, 48, 60]
                    .filter((value) => value >= product.min_term_months && value <= product.max_term_months)
                    .map((value) => <button type="button" key={value} className={term === value ? "active" : ""} onClick={() => setTerm(value)}>{value} мес.</button>)}
                </div>
                <Field label="Или укажите точный срок" hint={`от ${product.min_term_months} до ${product.max_term_months} месяцев`} error={termError}>
                  <Input id="wizard-term" type="number" aria-invalid={Boolean(termError)} value={term} min={product.min_term_months} max={product.max_term_months} onChange={(event) => setTerm(Number(event.target.value))} />
                </Field>
              </div>
              <label className="toggle-row">
                <span><strong>Обеспечение по заявке</strong><small>{product.requires_collateral ? "Обязательно для этого продукта" : "Может повысить оценку и снизить риск"}</small></span>
                <input type="checkbox" checked={collateral} onChange={(event) => setCollateral(event.target.checked)} disabled={product.requires_collateral} />
              </label>
              <Alert tone="info" title="Предварительный расчёт">
                Ежемесячный платёж — <strong>{formatMoney(payment)}</strong>, всего к возврату — <strong>{formatMoney(payment * term)}</strong>. Расчёт не является офертой.
              </Alert>
            </div>
          )}

          {step === 3 && (
            <div className={`wizard-step step-${direction}`}>
              <div className="step-heading"><span className="step-chip">Шаг 4 из 5</span><h2>Документы компании</h2><p>Необязательный шаг. PDF, JPEG или PNG, до 10 МБ.</p></div>
              <button type="button" className="upload-zone" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={28} /> : <UploadCloud size={30} />}
                <strong>{uploading ? "Загружаем…" : "Нажмите, чтобы выбрать файлы"}</strong>
                <span>Можно приложить отчётность, выписку или другой документ</span>
              </button>
              <input ref={fileInput} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => uploadFiles(event.target.files)} />
              <div className="document-list">
                {documents.length === 0 ? (
                  <p className="muted">Пока документов нет. Заявку можно отправить и без них.</p>
                ) : (
                  documents.map((doc) => (
                    <div className="document-row" key={doc.id}>
                      <span className="file-badge"><FileText size={17} /></span>
                      <div><strong>{doc.original_name}</strong><small>{Math.round(doc.size_bytes / 1024)} КБ · загружен</small></div>
                      <span className="badge badge-success">Готово</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className={`wizard-step step-${direction}`}>
              <div className="step-heading"><span className="step-chip">Шаг 5 из 5</span><h2>Проверьте заявку</h2><p>После отправки начнутся автоматические проверки. До отправки можно вернуться и всё изменить.</p></div>
              <div className="review-grid">
                <div><span>Продукт</span><strong>{product.name}</strong></div>
                <div><span>Цель</span><strong>{product.purposes.find((item) => item.code === purpose)?.label}</strong></div>
                <div><span>Компания</span><strong>{company?.name ?? "—"}</strong></div>
                <div><span>ИНН</span><strong>{inn}</strong></div>
                <div><span>Сумма</span><strong>{formatMoney(amount)}</strong></div>
                <div><span>Срок</span><strong>{term} мес.</strong></div>
                <div><span>Ставка</span><strong>от {product.rate.toFixed(1).replace(".", ",")}% годовых</strong></div>
                <div><span>Обеспечение</span><strong>{collateral ? "Да" : "Нет"}</strong></div>
                <div><span>Документы</span><strong>{documents.length} шт.</strong></div>
                <div><span>Платёж</span><strong>{formatMoney(payment)} / мес.</strong></div>
              </div>
              <div className="consent-box">
                <ShieldCheck size={20} />
                <div><strong>Отправка заявки</strong><p>Нажимая «Отправить заявку», вы передаёте данные заявки на автоматические проверки и рассмотрение сотрудником банка.</p></div>
              </div>
              <Field label="Кто подаёт заявку" required>
                <Select value={signerPosition} onChange={(event) => setSignerPosition(event.target.value)}>
                  {SIGNER_POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <label className="checkbox-row"><input type="checkbox" checked={authorityConfirmed} onChange={(event) => setAuthorityConfirmed(event.target.checked)} /><span>Подтверждаю, что уполномочен подавать заявку на кредит от имени {company?.name ?? "компании"}.</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={consentBki} onChange={(event) => setConsentBki(event.target.checked)} /><span>Согласен на запрос кредитной истории в бюро кредитных историй.</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={consentPersonalData} onChange={(event) => setConsentPersonalData(event.target.checked)} /><span>Согласен на обработку персональных данных для рассмотрения заявки.</span></label>
            </div>
          )}

          <div ref={errorRef}>
            {(error || (problem && !FIELD_TARGET[problem.field])) && <Alert tone="danger">{error || problem?.message}</Alert>}
            {step === STEPS.length - 1 && !consentsGiven && (
              <p className="muted small consent-hint">Чтобы отправить заявку, отметьте {missingConsents()}.</p>
            )}
          </div>
          <div className="wizard-footer">
            <Button variant="secondary" onClick={back} disabled={step === 0} icon={<ArrowLeft size={16} />}>Назад</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} loading={saving}>Продолжить <ArrowRight size={16} /></Button>
            ) : (
              <Button onClick={submit} loading={submitting} disabled={!consentsGiven} icon={<ShieldCheck size={17} />}>Отправить заявку</Button>
            )}
          </div>
        </div>

        <aside className="wizard-aside">
          <Card className="calc-panel">
            <span className="eyebrow">{step < 2 ? "Предварительный расчёт" : "Расчёт параметров"}</span>
            <h3>{product.name}</h3>
            <div className="calc-payment calc-payment-small">{formatMoney(payment)}<small>/ мес.</small></div>
            <div className="summary-lines">
              <div><span>Сумма</span><strong>{formatMoney(amount)}</strong></div>
              <div><span>Срок</span><strong>{term} мес.</strong></div>
              <div><span>Ставка</span><strong>от {product.rate.toFixed(1).replace(".", ",")}%</strong></div>
              <div><span>Переплата</span><strong>{formatMoney(Math.max(0, payment * term - amount))}</strong></div>
            </div>
            <p className="muted small">Расчёт не является офертой: итоговые условия — после проверок и решения сотрудника.</p>
          </Card>
        </aside>
      </div>
      <Modal
        open={confirmDelete}
        title="Удалить черновик?"
        onClose={() => setConfirmDelete(false)}
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button><Button variant="danger" loading={deleting} onClick={removeDraft}>Удалить</Button></>}
      >
        <p>Черновик и приложенные к нему файлы будут удалены без возможности восстановления.</p>
      </Modal>
    </div>
  );

  function missingConsents(): string {
    return [
      !authorityConfirmed && "подтверждение полномочий",
      !consentBki && "согласие на запрос в бюро кредитных историй",
      !consentPersonalData && "согласие на обработку персональных данных"
    ].filter(Boolean).join(", ");
  }
}
