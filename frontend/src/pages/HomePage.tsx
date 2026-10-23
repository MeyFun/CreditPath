import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Landmark,
  LineChart,
  LockKeyhole,
  MousePointerClick,
  Route,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SiteFooter } from "../components/Footer";
import { useAuth } from "../auth";
import { Button, Card, formatMoney, Logo, Spinner } from "../components/ui";
import type { Product } from "../types";

const PRODUCT_ICONS = [WalletCards, Banknote, CreditCard];

const FAQ = [
  {
    q: "Кто может получить финансирование?",
    a: "Действующие компании и индивидуальные предприниматели с корректным ИНН. Возраст бизнеса и требования зависят от продукта: для оборотного кредита — от 6 месяцев, для оборудования — от 12 месяцев."
  },
  {
    q: "Какие документы нужны?",
    a: "На старте достаточно ИНН: данные компании подтягиваются из демонстрационного реестра. Дополнительно можно приложить PDF, JPEG или PNG — до 10 МБ на файл. OCR и автоматическое распознавание не используются."
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
    a: "В демонстрационном сценарии автоматические проверки занимают несколько секунд, после чего заявка попадает сотруднику банка. Финальное решение всегда принимает человек в рабочем месте сотрудника."
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
  { icon: CheckCircle2, title: "Оферта и демо-выдача", text: "Примите условия, подпишите договор и завершите сделку в демонстрационном режиме." }
];

function annuity(amount: number, rate: number, months: number): number {
  const monthly = rate / 100 / 12;
  if (!months) return 0;
  if (monthly === 0) return amount / months;
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -months));
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

      <div className="demo-strip">
        <Sparkles size={15} />
        <span>Демонстрационный прототип. Все данные синтетические, подписание и зачисление средств имитируются.</span>
      </div>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="live-dot" /> Кредитный конвейер для малого бизнеса</span>
            <h1>Кредит для бизнеса без визита в банк</h1>
            <p>
              Единый кабинет для ИП и компаний: подберите продукт, проверьте ИНН,
              отправьте заявку и следите за решением.
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
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-card hero-card-main">
              <div className="hero-card-head">
                <span className="mini-icon"><ShieldCheck size={18} /></span>
                <span>Статус заявки</span>
                <span className="badge badge-success"><span className="badge-dot" />Проверки пройдены</span>
              </div>
              <div className="hero-offer">
                <span>Предварительный лимит</span>
                <strong>5 млн ₽</strong>
                <div className="hero-offer-meta">
                  <span>Срок <b>24 мес.</b></span>
                  <span>Ставка <b>14,5%</b></span>
                  <span>Платёж <b>{formatMoney(annuity(5_000_000, 14.5, 24))}</b></span>
                </div>
              </div>
              <div className="hero-progress">
                <div className="hero-progress-line"><span /></div>
                <div className="hero-stages">
                  <span><CheckCircle2 size={14} /> Заявка</span>
                  <span><CheckCircle2 size={14} /> Проверки</span>
                  <span className="active"><Clock3 size={14} /> Решение</span>
                  <span>Оферта</span>
                </div>
              </div>
              <div className="hero-note"><LockKeyhole size={15} /> Данные защищены. Реестр и БКИ в демо — локальные моки.</div>
            </div>
            <div className="hero-card hero-card-float">
              <span className="mini-icon mini-icon-dark"><Landmark size={18} /></span>
              <div><small>Решение сотрудника</small><strong>Понятные причины</strong></div>
            </div>
            <div className="hero-orbit" />
          </div>
        </section>

        <section className="section" id="products">
          <div className="section-heading">
            <span className="eyebrow">Финансовые инструменты</span>
            <h2>Кредитные продукты для вашего бизнеса</h2>
            <p>Три сценария финансирования с разными требованиями и условиями.</p>
          </div>
          {productsQuery.isLoading ? (
            <div className="center"><Spinner /><span>Загружаем продукты…</span></div>
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
            <span className="eyebrow">Калькулятор платежей</span>
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
              <p className="demo-note">Расчёт предварительный и не является офертой.</p>
            </Card>
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-heading centered">
            <span className="eyebrow">Как это работает</span>
            <h2>Как это работает</h2>
            <p>От заявки до решения — четыре понятных этапа, каждый со статусом в кабинете.</p>
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
            <span className="eyebrow">Справочный центр</span>
            <h2>Часто задаваемые вопросы</h2>
            <p>Всё, что нужно знать о правилах и этапах финансирования.</p>
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
            <span className="eyebrow">Готовы начать?</span>
            <h2>Подайте заявку и наблюдайте за решением онлайн</h2>
            <p>Решение по заявке и все уведомления — в личном кабинете.</p>
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
