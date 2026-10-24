import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  FileSignature,
  LineChart,
  MousePointerClick,
  Route,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SiteFooter } from "../components/Footer";
import { useAuth } from "../auth";
import { formatMoney, Logo, prefersReducedMotion, SegmentedControl, ThemeToggle } from "../components/ui";
import type { Product } from "../types";

const PRODUCT_ICONS: Record<string, typeof WalletCards> = { OBOROT: WalletCards, EQUIPMENT: Banknote, OVERDRAFT: CreditCard };

const FAQ = [
  {
    q: "Кто может получить финансирование?",
    a: "Действующие компании и индивидуальные предприниматели с корректным ИНН. Возраст бизнеса и требования зависят от продукта: для оборотного кредита — от 6 месяцев, для оборудования — от 12 месяцев."
  },
  {
    q: "Какие документы нужны?",
    a: "На старте достаточно ИНН: данные компании подтягиваются из реестра. Дополнительно можно приложить PDF, JPEG или PNG — до 10 МБ на файл. OCR и автоматическое распознавание не используются."
  },
  {
    q: "Нужен ли залог?",
    a: "Оборотный кредит и овердрафт доступны без залога. Для кредита на оборудование обеспечением выступает приобретаемая техника или оборудование."
  },
  {
    q: "Как получить доступ к кабинету?",
    a: "Кабинет предназначен для клиентов банка: логин выдаётся при подключении к сервису, отдельная регистрация не нужна. Каталог, калькулятор и ответы на вопросы доступны без входа."
  },
  {
    q: "Как быстро принимается решение?",
    a: "Автоматические проверки занимают несколько секунд, после чего заявка попадает сотруднику банка. Финальное решение всегда принимает человек в рабочем месте сотрудника."
  },
  {
    q: "Что означает «Одобрено на других условиях»?",
    a: "Банк готов выдать финансирование, но на изменённых условиях: например, с меньшей суммой или другим сроком. Точные параметры видны в решении и оферте."
  }
];

const STEPS = [
  { icon: MousePointerClick, title: "Заявка онлайн", text: "Компания уже подставлена из профиля — остаётся выбрать продукт, сумму и срок." },
  { icon: LineChart, title: "Автоматические проверки", text: "Реестр, кредитная история и скоринг формируют предварительное решение за секунды." },
  { icon: BadgeCheck, title: "Решение сотрудника", text: "Заявку проверяет сотрудник банка. Вы видите статус и историю в кабинете." },
  { icon: CheckCircle2, title: "Оферта и выдача", text: "Примите условия, подпишите договор и получите средства — всё в кабинете." }
];

const TERMS = [6, 12, 24, 36];

function annuity(amount: number, rate: number, months: number): number {
  const monthly = rate / 100 / 12;
  if (!months) return 0;
  if (monthly === 0) return amount / months;
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -months));
}

/** Первые платежи по аннуитету: сколько уходит на проценты, а сколько — на сам долг. */
function firstPayments(amount: number, rate: number, months: number, count = 3) {
  const payment = annuity(amount, rate, months);
  const rows: { month: number; interest: number; principal: number }[] = [];
  let balance = amount;
  for (let month = 1; month <= Math.min(count, months); month += 1) {
    const interest = balance * (rate / 100 / 12);
    rows.push({ month, interest, principal: payment - interest });
    balance -= payment - interest;
  }
  return rows;
}

/** «Кредит на оборудование» → «Оборудование»: во вкладке калькулятора хватает сути. */
function shortName(name: string): string {
  const short = name.replace("Кредит на ", "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₽`;
  return `${Math.round(value / 1000).toLocaleString("ru-RU")} тыс. ₽`;
}

/** Шаги демонстрации в hero: та же лестница статусов, что видит клиент в кабинете. */
const HERO_STAGES = [
  { label: "Заявка", badge: "Заявка отправлена", tone: "info", event: "Заявка CP-2026-7F3A принята" },
  { label: "Проверки", badge: "Идут проверки", tone: "info", event: "Реестр и кредитная история проверены" },
  { label: "Решение", badge: "У сотрудника банка", tone: "warning", event: "Скоринг 82 из 100 — рекомендовано одобрить" },
  { label: "Оферта", badge: "Одобрено", tone: "success", event: "Оферта готова: 5 млн ₽ на 24 месяца" }
] as const;

const STAGE_MS = 3200;
const FADE_MS = 450;

/** Окно кабинета в hero: заявка сама проходит путь от отправки до одобрения. */
function HeroDemo() {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState(reduced ? HERO_STAGES.length - 1 : 0);
  // Перед новым кругом карточка мягко гаснет: прогресс не «отматывается» назад на глазах.
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const last = stage === HERO_STAGES.length - 1;
    // На одобрении задерживаемся дольше: это главный момент сцены.
    const timer = window.setTimeout(() => {
      if (!last) {
        setStage(stage + 1);
        return;
      }
      setFading(true);
      window.setTimeout(() => {
        setStage(0);
        setFading(false);
      }, FADE_MS);
    }, last ? STAGE_MS * 1.6 : STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [stage, reduced]);

  const current = HERO_STAGES[stage];
  const approved = stage === HERO_STAGES.length - 1;
  const segments = HERO_STAGES.length - 1;

  return (
    <div className="app-window" aria-hidden="true">
      <div className="app-window-bar">
        <span className="app-window-mark"><Route size={14} strokeWidth={2.6} /></span>
        <span>Кабинет предпринимателя</span>
        <span className="app-window-user">СА</span>
      </div>
      <div className="app-window-body">
        <div className="mini-nav">
          {["Главная", "Мои заявки", "Новая заявка", "Уведомления"].map((item, index) => (
            <span key={item} className={index === 1 ? "active" : ""}><i />{item}</span>
          ))}
        </div>
        <div className={`mini-main ${fading ? "fading" : ""}`}>
          <div className="mini-head">
            <div>
              <small>Заявка CP-2026-7F3A</small>
              <strong>Оборотный кредит</strong>
            </div>
            <span className={`badge badge-${current.tone} mini-badge`}><span className="badge-dot" /><span key={current.badge} className="mini-soft-in">{current.badge}</span></span>
          </div>
          <div className={`mini-offer ${approved ? "approved" : ""}`}>
            <small>{approved ? "Одобрено банком" : "Запрошено"}</small>
            <strong>5 000 000 ₽</strong>
            <div className="mini-offer-meta">
              <span>Срок <b>24 мес.</b></span>
              <span>Ставка <b>14,5%</b></span>
              <span>Платёж <b>{formatMoney(annuity(5_000_000, 14.5, 24))}</b></span>
            </div>
            {approved && <span className="mini-offer-check"><CheckCircle2 size={22} /></span>}
          </div>
          <ol className="mini-track">
            {/* Линия всё время ползёт к следующему этапу и приходит ровно к его началу — без пауз на месте. */}
            <span
              key={stage}
              className="mini-track-fill"
              aria-hidden="true"
              style={{
                ["--from" as string]: String(stage / segments),
                ["--to" as string]: String(Math.min(stage + 1, segments) / segments),
                animationDuration: reduced ? "0s" : `${STAGE_MS}ms`
              }}
            />
            {HERO_STAGES.map((item, index) => {
              const done = index < stage || approved;
              return (
                <li key={item.label} className={done ? "done" : index === stage ? "now" : ""}>
                  <span className="mini-track-dot">{done ? <CheckCircle2 size={14} /> : index === stage ? <Clock3 size={13} /> : null}</span>
                  {item.label}
                </li>
              );
            })}
          </ol>
          <div className="mini-event">
            <span className="mini-event-dot" key={stage} />
            <span key={current.event} className="mini-soft-in">{current.event}</span>
            <small>только что</small>
          </div>
        </div>
      </div>
      <div className={`mini-float ${stage >= 2 && !fading ? "visible" : ""}`}>
        <span className="mini-float-score">82</span>
        <div><small>Предварительная оценка</small><strong>низкий риск</strong></div>
      </div>
    </div>
  );
}

/** Экраны тура: упрощённые фрагменты настоящих страниц кабинета. */
function TourScreen({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="tour-card">
        <span className="tour-card-label">Новая заявка, шаг 2 из 5</span>
        <h3>Сведения о компании</h3>
        <div className="tour-company">
          <span className="tour-company-icon"><Building2 size={20} /></span>
          <div><small>Компания из профиля</small><strong>ООО «Северный Ветер»</strong><span>ИНН 9900000017</span></div>
        </div>
        <div className="tour-ok"><ShieldCheck size={18} /> Полномочия подтверждены автоматически</div>
        <span className="btn btn-primary tour-fake-btn">Продолжить <ArrowRight size={16} /></span>
      </div>
    );
  }
  if (index === 1) {
    const checks = [
      ["Реестр ЕГРЮЛ", "Компания действует с 2012 года"],
      ["Бюро кредитных историй", "Просрочек нет, долговая нагрузка в норме"],
      ["Скоринг", "82 из 100 — низкий риск"],
      ["Кредитные правила", "Рекомендовано одобрить"]
    ];
    return (
      <div className="tour-card">
        <span className="tour-card-label">Заявка CP-2026-7F3A</span>
        <h3>Автоматические проверки</h3>
        <ul className="tour-checks">
          {checks.map(([title, text], position) => (
            <li key={title} style={{ animationDelay: `${position * 0.18}s` }}>
              <CheckCircle2 size={18} />
              <div><strong>{title}</strong><span>{text}</span></div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="tour-card">
        <span className="tour-card-label">Рабочее место сотрудника</span>
        <h3>Решение принимает человек</h3>
        <div className="tour-score">
          <strong>82</strong><span>из 100</span>
          <div className="tour-score-bar"><span style={{ width: "82%" }} /></div>
        </div>
        <div className="tour-decisions">
          <span className="selected"><CheckCircle2 size={16} /> Одобрить</span>
          <span>Другие условия</span>
          <span>Запросить данные</span>
          <span>Отказать</span>
        </div>
      </div>
    );
  }
  return (
    <div className="tour-card">
      <span className="tour-card-label">Решение по заявке</span>
      <h3>Банк одобрил заявку</h3>
      <div className="tour-offer">
        <div><small>Сумма</small><strong>5 000 000 ₽</strong></div>
        <div><small>Срок</small><strong>24 мес.</strong></div>
        <div><small>Ставка</small><strong>14,5%</strong></div>
      </div>
      <span className="btn btn-primary tour-fake-btn"><FileSignature size={16} /> Принять и подписать</span>
    </div>
  );
}

const TOUR_MS = 6000;

/** Тур по этапам: слева шаги, справа экран кабинета. Листается сам, пока виден на экране;
    клик по шагу открывает его, и тур продолжает листать уже с него. */
function ProcessTour() {
  const reduced = prefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);


  return (
    <div className="tour" ref={ref}>
      <ol className="tour-steps" role="tablist" aria-label="Этапы заявки">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <button
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls="tour-panel"
              className={`tour-step ${index === active ? "active" : ""}`}
              onClick={() => setActive(index)}
            >
              <span className="tour-index">{index + 1}</span>
              <span className="tour-copy"><strong>{step.title}</strong><span>{step.text}</span></span>
              {index === active && !reduced && (
                <span
                  key={active}
                  className="tour-progress"
                  style={{ animationDuration: `${TOUR_MS}ms`, animationPlayState: visible ? "running" : "paused" }}
                  onAnimationEnd={() => setActive((value) => (value + 1) % STEPS.length)}
                />
              )}
            </button>
          </li>
        ))}
      </ol>
      <div className="tour-screen" id="tour-panel" role="tabpanel">
        <div className="tour-screen-inner" key={active}><TourScreen index={active} /></div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const productsQuery = useQuery({ queryKey: ["public-products"], queryFn: api.public.products });
  const products = productsQuery.data ?? [];
  const [activeCode, setActiveCode] = useState("OBOROT");
  const activeProduct = products.find((item) => item.code === activeCode) ?? products[0];
  const [amount, setAmount] = useState(5_000_000);
  const [term, setTerm] = useState(24);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const applyPath = user ? "/app/applications/new" : "/login";

  useEffect(() => {
    if (!activeProduct) return;
    setAmount(Math.min(Math.max(amount, activeProduct.min_amount), activeProduct.max_amount));
    setTerm(Math.min(Math.max(term, activeProduct.min_term_months), activeProduct.max_term_months));
  }, [activeCode, products.length]);

  const payment = useMemo(() => (activeProduct ? annuity(amount, activeProduct.rate, term) : 0), [activeProduct, amount, term]);
  const schedule = useMemo(() => (activeProduct ? firstPayments(amount, activeProduct.rate, term) : []), [activeProduct, amount, term]);
  const overpayment = Math.max(0, payment * term - amount);
  const principalShare = payment > 0 ? (amount / (payment * term)) * 100 : 100;
  const terms = activeProduct ? TERMS.filter((value) => value >= activeProduct.min_term_months && value <= activeProduct.max_term_months) : TERMS;
  const maxAmount = Math.max(1, ...products.map((product) => product.max_amount));
  const maxTerm = Math.max(1, ...products.map((product) => product.max_term_months));
  const fill = activeProduct ? ((amount - activeProduct.min_amount) / (activeProduct.max_amount - activeProduct.min_amount)) * 100 : 0;

  function selectProduct(product: Product) {
    setActiveCode(product.code);
    setAmount(Math.min(Math.max(3_000_000, product.min_amount), product.max_amount));
    setTerm(Math.min(24, product.max_term_months));
    document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="public-page">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="public-logo" aria-label="CreditPath — на главную">
            <Logo />
          </Link>
          <nav className="public-nav" aria-label="Навигация">
            <a href="#how">Как это работает</a>
            <a href="#products">Продукты</a>
            <a href="#calculator">Калькулятор</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <div className="public-actions">
            <ThemeToggle />
            {user ? (
              <Link className="btn btn-primary" to={user.role === "client" ? "/app" : user.role === "employee" ? "/staff" : "/admin/users"}>
                Открыть кабинет <ArrowRight size={17} />
              </Link>
            ) : (
              <Link className="btn btn-primary" to="/login">Войти <ArrowRight size={17} /></Link>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="hero-v2">
          <div className="hero-v2-inner">
            <div className="hero-v2-copy">
              <h1>Кредит для бизнеса без визита в банк</h1>
              <p>
                До 50 млн ₽ на оборот, оборудование или овердрафт. Компания подставится из профиля,
                предварительная оценка появится сразу после отправки, а решение сотрудника — в кабинете.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" to={applyPath} state={{ from: "/app/applications/new" }}>
                  Подать заявку <ArrowRight size={18} />
                </Link>
                <a className="btn btn-secondary btn-lg" href="#calculator">Рассчитать платёж</a>
              </div>
              <dl className="hero-v2-facts">
                <div><dt>Лимит</dt><dd>до 50 млн ₽</dd></div>
                <div><dt>Ставка</dt><dd>от 13,8%</dd></div>
                <div><dt>Заявка</dt><dd>~10 минут</dd></div>
              </dl>
            </div>
            <HeroDemo />
          </div>
        </section>

        <section className="landing-section" id="how">
          <div className="landing-heading">
            <h2>Путь заявки — от ИНН до денег на счёте</h2>
            <p>На каждом этапе видно, что происходит с заявкой и что нужно от вас.</p>
          </div>
          <ProcessTour />
        </section>

        <section className="landing-section" id="products">
          <div className="landing-heading">
            <h2>Три продукта под разные задачи</h2>
            <p>Выберите продукт — калькулятор ниже сразу пересчитает платёж.</p>
          </div>
          {productsQuery.isLoading ? (
            <div className="product-rail" role="status" aria-label="Загружаем продукты…">
              {[0, 1, 2].map((item) => (
                <div className="card product-card-v2" key={item}><span className="sk" style={{ width: "60%" }} /><span className="sk sk-title" /><span className="sk sk-block" /></div>
              ))}
            </div>
          ) : (
            <div className="product-rail">
              {products.map((product) => {
                const Icon = PRODUCT_ICONS[product.code] ?? WalletCards;
                const selected = activeProduct?.code === product.code;
                return (
                  <button type="button" key={product.code} className={`card product-card-v2 ${selected ? "selected" : ""}`} onClick={() => selectProduct(product)} aria-pressed={selected}>
                    <span className="product-card-head">
                      <span className="compare-icon"><Icon size={20} /></span>
                      <span className={`badge ${product.requires_collateral ? "badge-neutral" : "badge-success"}`}>{product.requires_collateral ? "Под залог техники" : "Без залога"}</span>
                    </span>
                    <strong className="product-card-name">{product.name}</strong>
                    <span className="product-card-rate">от {product.rate.toFixed(1).replace(".", ",")}%</span>
                    <span className="product-meters">
                      <span className="product-meter">
                        <span className="product-meter-label">Сумма</span>
                        <span className="product-meter-track"><span style={{ width: `${(product.max_amount / maxAmount) * 100}%` }} /></span>
                        <span className="product-meter-value">до {compactMoney(product.max_amount)}</span>
                      </span>
                      <span className="product-meter">
                        <span className="product-meter-label">Срок</span>
                        <span className="product-meter-track"><span style={{ width: `${(product.max_term_months / maxTerm) * 100}%` }} /></span>
                        <span className="product-meter-value">до {product.max_term_months} мес.</span>
                      </span>
                    </span>
                    <span className="product-card-purposes">{product.purposes.map((purpose) => purpose.label).join(", ")}</span>
                    <span className="product-card-cta">{selected ? "Выбран в калькуляторе" : "Рассчитать платёж"} <ArrowRight size={16} /></span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="landing-section" id="calculator">
          <div className="landing-heading">
            <h2>Сколько платить в месяц</h2>
            <p>Предварительный расчёт. Итоговые условия — после проверок и решения сотрудника.</p>
          </div>
          <div className="card calc-v2">
            <div className="calc-v2-params">
              {products.length > 0 && (
                <SegmentedControl
                  label="Продукт"
                  className="segmented-full"
                  options={products.map((product) => ({ value: product.code, label: shortName(product.name) }))}
                  value={activeProduct?.code ?? activeCode}
                  onChange={(code) => setActiveCode(code)}
                />
              )}
              {activeProduct && (
                <>
                  <div className="calc-row">
                    <label htmlFor="calc-amount">Сумма кредита</label>
                    <div className="calc-value"><input id="calc-amount" type="number" value={amount} min={activeProduct.min_amount} max={activeProduct.max_amount} step={100000} onChange={(event) => setAmount(Number(event.target.value))} /><span>₽</span></div>
                  </div>
                  <input
                    className="range range-fill"
                    type="range"
                    min={activeProduct.min_amount}
                    max={activeProduct.max_amount}
                    step={100000}
                    value={amount}
                    style={{ ["--fill" as string]: `${Math.min(100, Math.max(0, fill))}%` }}
                    onChange={(event) => setAmount(Number(event.target.value))}
                    aria-label="Сумма кредита"
                  />
                  <div className="range-labels"><span>{formatMoney(activeProduct.min_amount)}</span><span>{formatMoney(activeProduct.max_amount)}</span></div>
                  <div className="calc-row">
                    <span className="calc-label">Срок кредитования</span>
                    <strong>{term} мес.</strong>
                  </div>
                  <SegmentedControl
                    label="Срок кредитования"
                    options={terms.map((value) => ({ value, label: `${value} мес.` }))}
                    value={term}
                    onChange={setTerm}
                  />
                  <div className="calc-schedule">
                    <div className="calc-split">
                      <div className="calc-split-bar" aria-hidden="true"><span style={{ width: `${principalShare}%` }} /></div>
                      <div className="calc-split-legend">
                        <span><i className="principal" /> Долг {formatMoney(amount)}</span>
                        <span><i className="interest" /> Проценты {formatMoney(overpayment)}</span>
                      </div>
                    </div>
                    <table className="calc-months">
                      <thead><tr><th>Месяц</th><th>Платёж</th><th>В счёт долга</th><th>Проценты</th></tr></thead>
                      <tbody>
                        {schedule.map((row) => (
                          <tr key={row.month}><td>{row.month}-й</td><td>{formatMoney(payment)}</td><td>{formatMoney(row.principal)}</td><td>{formatMoney(row.interest)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className="calc-v2-result">
              <span className="calc-result-label">Ежемесячный платёж</span>
              <div className="calc-payment">{formatMoney(payment)}<small>/ мес.</small></div>
              <div className="calc-lines">
                <div><span>Продукт</span><strong>{activeProduct?.name}</strong></div>
                <div><span>Ставка</span><strong>{activeProduct?.rate.toFixed(1).replace(".", ",")}% годовых</strong></div>
                <div><span>Сумма</span><strong>{formatMoney(amount)}</strong></div>
                <div><span>Переплата</span><strong>{formatMoney(overpayment)}</strong></div>
              </div>
              <Link className="btn btn-primary btn-full btn-lg" to={applyPath} state={{ from: "/app/applications/new" }}>
                Перейти к заявке <ArrowRight size={17} />
              </Link>
              <p className="calc-note"><ShieldCheck size={16} /> Без скрытых комиссий. Расчёт не является офертой.</p>
            </div>
          </div>
        </section>

        <section className="landing-section faq-layout" id="faq">
          <div className="landing-heading faq-heading">
            <h2>Вопросы и ответы</h2>
            <p>Требования, документы, сроки и что значит каждое решение банка.</p>
          </div>
          <div className="faq-list">
            {FAQ.map((item, index) => (
              <div className={`faq-item ${openFaq === index ? "open" : ""}`} key={item.q}>
                <button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}>
                  <span>{item.q}</span>
                  <ChevronDown size={20} />
                </button>
                {openFaq === index && <p>{item.a}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="cta-band">
            <div>
              <h2>Узнайте предварительное решение уже сегодня</h2>
              <p>Статус, вопросы банка и оферта придут в кабинет — без звонков и визитов.</p>
            </div>
            <Link className="btn btn-light btn-lg" to={user ? "/app" : "/login"}>{user ? "Открыть кабинет" : "Войти в кабинет"} <ArrowRight size={18} /></Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
