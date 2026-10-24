import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Landmark,
  LineChart,
  MousePointerClick,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SiteFooter } from "../components/Footer";
import { useAuth } from "../auth";
import { Card, formatMoney, Logo, prefersReducedMotion } from "../components/ui";
import type { Product } from "../types";

const PRODUCT_ICONS = [WalletCards, Banknote, CreditCard];

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
    q: "Можно ли подать заявку без регистрации?",
    a: "Каталог, калькулятор и FAQ доступны без входа. Для черновика, отправки заявки, загрузки документов и отслеживания статуса нужна учётная запись."
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
  { icon: MousePointerClick, title: "Заявка онлайн", text: "Выберите продукт, укажите ИНН и параметры. Данные компании подтянутся автоматически." },
  { icon: LineChart, title: "Автоматические проверки", text: "Реестр, кредитная история и скоринг формируют предварительное решение." },
  { icon: BadgeCheck, title: "Решение сотрудника", text: "Заявку проверяет сотрудник банка. Вы видите статус и историю в кабинете." },
  { icon: CheckCircle2, title: "Оферта и выдача", text: "Примите условия, подпишите договор и получите средства — всё в кабинете." }
];

function annuity(amount: number, rate: number, months: number): number {
  const monthly = rate / 100 / 12;
  if (!months) return 0;
  if (monthly === 0) return amount / months;
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -months));
}

/** Шаги демонстрации в hero: та же лестница статусов, что видит клиент в кабинете. */
const HERO_STAGES = [
  { label: "Заявка", badge: "Заявка отправлена", tone: "info", progress: 16, event: "Заявка CP-2026-7F3A принята" },
  { label: "Проверки", badge: "Идут проверки", tone: "info", progress: 44, event: "ИНН, реестр и кредитная история проверены" },
  { label: "Решение", badge: "У сотрудника банка", tone: "warning", progress: 72, event: "Скоринг 82 из 100 — рекомендовано одобрить" },
  { label: "Оферта", badge: "Одобрено", tone: "success", progress: 100, event: "Оферта готова: 5 млн ₽ на 24 месяца" }
] as const;

const STAGE_MS = 2600;
const ROUTE = "M24 410 C 10 300, 30 170, 60 96 S 220 8, 330 22 S 510 90, 500 230";
const ROUTE_NODES = [[24, 410], [60, 96], [330, 22], [500, 230]];

function HeroDemo() {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState(reduced ? HERO_STAGES.length - 1 : 0);

  useEffect(() => {
    if (reduced) return;
    // На одобрении задерживаемся дольше: это главный момент сцены.
    const delay = stage === HERO_STAGES.length - 1 ? STAGE_MS * 1.8 : STAGE_MS;
    const timer = window.setTimeout(() => setStage((value) => (value + 1) % HERO_STAGES.length), delay);
    return () => window.clearTimeout(timer);
  }, [stage, reduced]);

  const current = HERO_STAGES[stage];
  const approved = stage === HERO_STAGES.length - 1;

  return (
    <div className="hero-visual" aria-hidden="true">
      <svg className="hero-route" viewBox="0 0 520 440" preserveAspectRatio="none">
        <path className="hero-route-base" d={ROUTE} />
        <path className="hero-route-flow" d={ROUTE} />
        {ROUTE_NODES.map(([x, y], index) => (
          <g key={index} className={`hero-node ${index <= stage ? "on" : ""} ${index === stage ? "now" : ""}`} transform={`translate(${x} ${y})`}>
            <circle r="13" className="hero-node-halo" />
            <circle r="6" className="hero-node-dot" />
          </g>
        ))}
      </svg>
      <div className="hero-card hero-card-main">
        <div className="hero-card-head">
          <span className="mini-icon"><ShieldCheck size={18} /></span>
          <span>Заявка CP-2026-7F3A</span>
          <span key={current.badge} className={`badge badge-${current.tone} hero-badge`}><span className="badge-dot" />{current.badge}</span>
        </div>
        <div className={`hero-offer ${approved ? "hero-offer-approved" : ""}`}>
          <span>{approved ? "Одобрено банком" : "Запрошено"}</span>
          <strong>5 000 000 ₽</strong>
          <div className="hero-offer-meta">
            <span>Срок <b>24 мес.</b></span>
            <span>Ставка <b>14,5%</b></span>
            <span>Платёж <b>{formatMoney(annuity(5_000_000, 14.5, 24))}</b></span>
          </div>
          {approved && <span className="hero-offer-check"><CheckCircle2 size={22} /></span>}
        </div>
        <div className="hero-progress">
          <div className="hero-progress-line"><span style={{ width: `${current.progress}%` }} /></div>
          <div className="hero-stages">
            {HERO_STAGES.map((item, index) => {
              const done = index < stage || approved;
              return (
                <span key={item.label} className={done ? "done" : index === stage ? "active" : ""}>
                  {done ? <CheckCircle2 size={14} /> : index === stage ? <Clock3 size={14} /> : null} {item.label}
                </span>
              );
            })}
          </div>
        </div>
        <div className="hero-event" key={stage}>
          <span className="hero-event-dot" />
          <span>{current.event}</span>
          <small>только что</small>
        </div>
      </div>
      <div className={`hero-card hero-card-float ${stage >= 2 ? "visible" : ""}`}>
        <span className="mini-icon mini-icon-dark"><Landmark size={18} /></span>
        <div><small>Предварительная оценка</small><strong>82 из 100 · низкий риск</strong></div>
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

  useEffect(() => {
    if (!activeProduct) return;
    setAmount(Math.min(Math.max(amount, activeProduct.min_amount), activeProduct.max_amount));
    setTerm(Math.min(Math.max(term, activeProduct.min_term_months), activeProduct.max_term_months));
  }, [activeCode, products.length]);

  const payment = useMemo(() => {
    if (!activeProduct) return 0;
    return annuity(amount, activeProduct.rate, term);
  }, [activeProduct, amount, term]);

  function selectProduct(product: Product) {
    setActiveCode(product.code);
    setAmount(Math.min(Math.max(3_000_000, product.min_amount), product.max_amount));
    setTerm(Math.min(24, product.max_term_months));
    document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="public-page">
      <header className="public-header">
        <Link to="/" className="public-logo">
          <Logo />
        </Link>
        <nav className="public-nav" aria-label="Навигация">
          <a href="#products">Продукты</a>
          <a href="#how">Как это работает</a>
          <a href="#faq">Вопросы и ответы</a>
        </nav>
        <div className="public-actions">
          {user ? (
            <Link className="btn btn-primary" to={user.role === "client" ? "/app" : user.role === "employee" ? "/staff" : "/admin/users"}>
              Открыть кабинет <ArrowRight size={17} />
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/login">Войти</Link>
              <Link className="btn btn-primary" to="/register">Регистрация <ArrowRight size={17} /></Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="live-dot" /> Кредиты для ИП и ООО</span>
            <h1>До 50 млн ₽ на оборот, оборудование или овердрафт</h1>
            <p>
              Заявка онлайн за 10 минут: реквизиты заполнятся по ИНН, предварительная оценка
              появится сразу после отправки, а решение сотрудника банка — в вашем кабинете.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" to={user ? "/app/applications/new" : "/login"} state={{ from: "/app/applications/new" }}>
                Подать заявку <ArrowRight size={18} />
              </Link>
              <a className="btn btn-secondary btn-lg" href="#products">Подобрать продукт</a>
            </div>
            <div className="hero-stats">
              <div><strong>до 50 млн ₽</strong><span>лимит финансирования</span></div>
              <div><strong>от 13,8%</strong><span>ставка по продуктам</span></div>
              <div><strong>~10 минут</strong><span>на подачу заявки</span></div>
            </div>
          </div>
          <HeroDemo />
        </section>

        <section className="section" id="products">
          <div className="section-heading">
            
            <h2>Кредитные продукты для вашего бизнеса</h2>
            <p>Три сценария финансирования с разными требованиями и условиями.</p>
          </div>
          {productsQuery.isLoading ? (
            <div className="product-grid" role="status" aria-label="Загружаем продукты…">
              {[0, 1, 2].map((item) => (
                <div className="card skeleton-card" key={item}>
                  <span className="sk sk-circle" />
                  <span className="sk" style={{ width: "60%" }} />
                  <span className="sk sk-thin" style={{ width: "90%" }} />
                  <span className="sk sk-block" />
                </div>
              ))}
            </div>
          ) : (
            <div className="product-grid">
              {products.map((product, index) => {
                const Icon = PRODUCT_ICONS[index % PRODUCT_ICONS.length];
                return (
                  <Card className="product-card" key={product.code}>
                    <div className="product-top">
                      <span className="product-icon"><Icon size={22} /></span>
                      <span className={`badge ${product.requires_collateral ? "badge-info" : "badge-success"}`}>
                        {product.requires_collateral ? "Залог — оборудование" : "Без залога"}
                      </span>
                    </div>
                    <h3>{product.name}</h3>
                    <p>{product.short_description}</p>
                    <div className="product-specs">
                      <div><span>Сумма</span><strong>{formatMoney(product.min_amount)} — {formatMoney(product.max_amount)}</strong></div>
                      <div><span>Срок</span><strong>{product.min_term_months} — {product.max_term_months} мес.</strong></div>
                      <div><span>Ставка</span><strong className="accent-text">от {product.rate.toFixed(1).replace(".", ",")}% годовых</strong></div>
                    </div>
                    <button className="btn btn-secondary btn-full" onClick={() => selectProduct(product)}>
                      Рассчитать условия <ArrowRight size={16} />
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section className="section calcular" id="calculator">
          <div className="section-heading">
            
            <h2>Рассчитайте параметры кредитования</h2>
            <p>Предварительный расчёт. Итоговые условия определяются после проверок и решения сотрудника.</p>
          </div>
          <div className="calculator-grid">
            <Card className="calculator">
              <div className="calc-tabs" role="tablist">
                {products.map((product) => (
                  <button
                    key={product.code}
                    role="tab"
                    aria-selected={activeProduct?.code === product.code}
                    className={activeProduct?.code === product.code ? "active" : ""}
                    onClick={() => setActiveCode(product.code)}
                  >
                    {product.name.replace("Кредит на ", "")}
                  </button>
                ))}
              </div>
              {activeProduct && (
                <>
                  <div className="calc-row">
                    <label htmlFor="calc-amount">Сумма кредита</label>
                    <div className="calc-value"><input id="calc-amount" type="number" value={amount} min={activeProduct.min_amount} max={activeProduct.max_amount} step={100000} onChange={(event) => setAmount(Number(event.target.value))} /><span>₽</span></div>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min={activeProduct.min_amount}
                    max={activeProduct.max_amount}
                    step={100000}
                    value={amount}
                    onChange={(event) => setAmount(Number(event.target.value))}
                    aria-label="Сумма кредита"
                  />
                  <div className="range-labels"><span>{formatMoney(activeProduct.min_amount)}</span><span>{formatMoney(activeProduct.max_amount)}</span></div>
                  <div className="calc-row">
                    <span className="calc-label">Срок кредитования</span>
                    <strong>{term} мес.</strong>
                  </div>
                  <div className="term-buttons">
                    {[6, 12, 24, 36].filter((value) => value >= activeProduct.min_term_months && value <= activeProduct.max_term_months).map((value) => (
                      <button key={value} className={term === value ? "active" : ""} onClick={() => setTerm(value)}>{value} мес.</button>
                    ))}
                  </div>
                  {!([6, 12, 24, 36].some((v) => v === term)) && <p className="muted small">Выбранный срок: {term} мес.</p>}
                </>
              )}
            </Card>
            <Card className="calc-result">
              <span className="eyebrow">Ориентировочный платёж</span>
              <div className="calc-payment">{formatMoney(payment)}<small>/ мес.</small></div>
              <div className="calc-lines">
                <div><span>Продукт</span><strong>{activeProduct?.name}</strong></div>
                <div><span>Процентная ставка</span><strong>{activeProduct?.rate.toFixed(1).replace(".", ",")}% годовых</strong></div>
                <div><span>Сумма</span><strong>{formatMoney(amount)}</strong></div>
                <div><span>Переплата</span><strong>{formatMoney(payment * term - amount)}</strong></div>
              </div>
              <div className="calc-security"><ShieldCheck size={18} /><span>Никаких скрытых комиссий. Данные для расчёта не покидают продукт.</span></div>
              <Link className="btn btn-primary btn-full" to={user ? "/app/applications/new" : "/login"} state={{ from: "/app/applications/new" }}>
                Перейти к заявке <ArrowRight size={16} />
              </Link>
              <p className="muted small">Расчёт предварительный и не является офертой.</p>
            </Card>
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-heading centered">
            
            <h2>Как это работает</h2>
            <p>Четыре этапа, и на каждом видно, что происходит с заявкой и что нужно от вас.</p>
          </div>
          <div className="steps-grid">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <div className="how-step" key={step.title}>
                  <div className="how-top"><span className="step-number">{index + 1}</span><span className="step-icon"><Icon size={21} /></span></div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="section-heading centered">
            
            <h2>Часто задаваемые вопросы</h2>
            <p>Требования, документы, сроки и что значит каждое решение банка.</p>
          </div>
          <div className="faq-list">
            {FAQ.map((item, index) => (
              <div className={`faq-item ${openFaq === index ? "open" : ""}`} key={item.q}>
                <button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}>
                  <span>{item.q}</span>
                  <ChevronDown size={19} />
                </button>
                {openFaq === index && <p>{item.a}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="cta-section">
          <div>
            
            <h2>Узнайте предварительное решение уже сегодня</h2>
            <p>Подайте заявку за 10 минут — статус, вопросы банка и оферта придут в кабинет.</p>
          </div>
          <div className="cta-actions">
            <Link className="btn btn-primary btn-lg" to={user ? "/app" : "/register"}>Создать кабинет <ArrowRight size={18} /></Link>
            <Link className="btn btn-secondary btn-lg" to="/login">У меня уже есть доступ</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
