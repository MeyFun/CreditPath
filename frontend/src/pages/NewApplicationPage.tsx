import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
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
  DemoNote,
  Field,
  formatMoney,
  Input,
  LoadingBlock,
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
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [idempotencyKey] = useState(newKey);
  const [showDemoInns, setShowDemoInns] = useState(false);

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
    setDraftId(data.id);
    setInitialized(true);
  }, [draftQuery.data, initialized, navigate]);

  useEffect(() => {
    if (product) {
      setCollateral((value) => (product.requires_collateral ? true : value));
    }
  }, [productId]);

  const payment = useMemo(() => (product ? annuity(amount, product.rate, term) : 0), [product, amount, term]);

  function selectProduct(next: Product) {
    setProductId(next.id);
    setPurpose(next.purposes[0]?.code ?? "");
    setAmount(Math.min(Math.max(3_000_000, next.min_amount), next.max_amount));
    setTerm(Math.min(24, next.max_term_months));
    setCollateral(next.requires_collateral);
    setError("");
  }

  async function verifyInn() {
    setRegistryError("");
    setCompany(null);
    if (!/^\d{10}$|^\d{12}$/.test(inn)) {
      setRegistryError("ИНН должен содержать 10 цифр для юрлица или 12 для ИП");
      return;
    }
    setRegistryLoading(true);
    try {
      const data = await api.public.registry(inn);
      setCompany(data.company);
      if (data.company.status !== "Действующая") {
        setRegistryError("Компания не действует. Заявку можно создать, но решение будет отрицательным.");
      }
    } catch (err) {
      setRegistryError(err instanceof ApiError ? err.message : "Не удалось проверить ИНН");
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
      company_name: company?.name,
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
      company_name: company?.name,
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
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить черновик");
    } finally {
      setSaving(false);
    }
  }

  function validateStep(current: number): string {
    if (current === 0) {
      if (!product) return "Выберите продукт";
      if (!purpose) return "Выберите цель кредита";
    }
    if (current === 1) {
      if (!company) return "Проверьте ИНН и дождитесь данных компании";
    }
    if (current === 2 && product) {
      if (amount < product.min_amount || amount > product.max_amount) return "Сумма вне диапазона продукта";
      if (term < product.min_term_months || term > product.max_term_months) return "Срок вне диапазона продукта";
      if (product.requires_collateral && !collateral) return "Для продукта требуется обеспечение";
    }
    return "";
  }

  async function next() {
    setError("");
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await persist();
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
      const submitted = await api.client.submit(id, idempotencyKey);
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

  if (productsQuery.isLoading || (draftParam && draftQuery.isLoading)) {
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
            <span className="eyebrow">Новая заявка</span>
            <h1>Оформление кредита для бизнеса</h1>
            <p>Пять шагов, без бумажных справок и внешних подтверждений.</p>
          </div>
          <div className="wizard-save">
            {savedAt ? <span className="saved-note"><CheckCircle2 size={16} /> Черновик сохранён в {savedAt}</span> : <span className="muted small">{draftId ? "Черновик" : "Новый черновик"}</span>}
            <Button variant="secondary" onClick={saveOnly} loading={saving} icon={<FileText size={16} />}>Сохранить черновик</Button>
          </div>
        </div>
        <Stepper steps={STEPS} current={step} />
      </div>

      <div className="wizard-grid">
        <Card className="wizard-main">
          {error && <Alert tone="danger">{error}</Alert>}

          {step === 0 && (
            <div className="wizard-step">
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
              <DemoNote>Данные заявки можно сохранить и продолжить позже: черновик доступен в разделе «Мои заявки».</DemoNote>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step">
              <div className="step-heading"><span className="step-chip">Шаг 2 из 5</span><h2>Сведения о компании</h2><p>Введите ИНН — реквизиты подтянутся из демонстрационного реестра.</p></div>
              <Field label="ИНН организации (10 цифр) или ИП (12 цифр)" required hint="Данные загружаются из локального мок-сервиса реестра.">
                <div className="inn-row">
                  <div className="input-icon-wrap"><Building2 size={18} /><Input value={inn} onChange={(event) => { setInn(event.target.value.replace(/\D/g, "").slice(0, 12)); setCompany(null); }} inputMode="numeric" placeholder="Например, 9900000017" /></div>
                  <Button variant="secondary" onClick={verifyInn} loading={registryLoading} icon={registryLoading ? undefined : <RefreshCw size={16} />}>Проверить</Button>
                </div>
              </Field>
              {registryError && <Alert tone={company ? "warning" : "danger"}>{registryError}</Alert>}
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
              <button className="text-button demo-inns-toggle" onClick={() => setShowDemoInns((value) => !value)}><Info size={15} /> {showDemoInns ? "Скрыть" : "Показать"} демо-ИНН для проверки сценариев</button>
              {showDemoInns && (
                <div className="demo-inn-list">
                  {DEMO_INNS.map(([value, label]) => (
                    <button key={value} type="button" onClick={() => { setInn(value); setCompany(null); setRegistryError(""); }}>
                      <code>{value}</code><span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <div className="step-heading"><span className="step-chip">Шаг 3 из 5</span><h2>Параметры кредита</h2><p>Диапазоны ограничены выбранным продуктом.</p></div>
              <div className="amount-display">
                <label htmlFor="wizard-amount">Сумма кредита</label>
                <div><input id="wizard-amount" type="number" value={amount} min={product.min_amount} max={product.max_amount} step={100000} onChange={(event) => setAmount(Number(event.target.value))} /><span>₽</span></div>
                <small>{formatMoney(product.min_amount)} — {formatMoney(product.max_amount)}</small>
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
                <Field label="Или укажите точный срок" hint={`от ${product.min_term_months} до ${product.max_term_months} месяцев`}>
                  <Input type="number" value={term} min={product.min_term_months} max={product.max_term_months} onChange={(event) => setTerm(Number(event.target.value))} />
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
            <div className="wizard-step">
              <div className="step-heading"><span className="step-chip">Шаг 4 из 5</span><h2>Документы компании</h2><p>Необязательный шаг. PDF, JPEG или PNG, до 10 МБ. OCR не используется.</p></div>
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
              <Alert tone="info" title="Безопасное хранение">Файлы сохраняются в приватном томе и доступны только вам, назначенному сотруднику и администратору.</Alert>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-step">
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
                <div><strong>Отправка заявки</strong><p>Нажимая «Отправить заявку», вы передаёте синтетические данные в демонстрационный кредитный конвейер. Автоматические проверки и решение сотрудника не имеют юридических последствий.</p></div>
              </div>
              <DemoNote>Подписание и выдача средств на следующих шагах имитируются и явно помечены.</DemoNote>
            </div>
          )}

          <div className="wizard-footer">
            <Button variant="secondary" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0} icon={<ArrowLeft size={16} />}>Назад</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} loading={saving}>Продолжить <ArrowRight size={16} /></Button>
            ) : (
              <Button onClick={submit} loading={submitting} icon={<ShieldCheck size={17} />}>Отправить заявку</Button>
            )}
          </div>
        </Card>

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
            <div className="assurance"><LockKeyhole size={16} /><span>Расчёт не является публичной офертой. Итоговые условия — после проверок и решения сотрудника.</span></div>
          </Card>
          <Card className="help-card">
            <span className="mini-icon"><Info size={18} /></span>
            <div><strong>Нужна подсказка?</strong><p>Откройте FAQ на главной или центр уведомлений — внешние каналы не используются.</p><Link to="/#faq" className="text-link">Перейти в FAQ <ArrowRight size={14} /></Link></div>
          </Card>
          <Card className="help-card">
            <span className="mini-icon"><CheckCircle2 size={18} /></span>
            <div><strong>Демо-сценарий</strong><p>Можно проверить одобрение, отказ, другие условия и запрос данных. Список ИНН — в шаге «Компания».</p></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
