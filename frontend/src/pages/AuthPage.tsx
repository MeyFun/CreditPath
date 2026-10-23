import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { homeForRole, useAuth } from "../auth";
import { Alert, Button, Field, Input, Logo } from "../components/ui";

type Tab = "login" | "register";

const DEMO_ACCOUNTS = [
  { username: "client1", title: "Клиент", text: "Кабинет предпринимателя", icon: UserRound, tone: "red" },
  { username: "client2", title: "Клиент", text: "Другая компания", icon: Building2, tone: "blue" },
  { username: "employee1", title: "Сотрудник банка", text: "Очередь, решения и клиентский кабинет", icon: BadgeCheck, tone: "green" },
  { username: "admin", title: "Администратор", text: "Роли, аудит и клиентский кабинет", icon: ShieldCheck, tone: "dark" }
];

export default function AuthPage({ initialTab = "login" }: { initialTab?: Tab }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [inn, setInn] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreement, setAgreement] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const hint = useQuery({ queryKey: ["demo-hint"], queryFn: api.auth.demoHint });

  const destination = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (user) navigate(destination ?? homeForRole(user), { replace: true });
  }, [user, destination, navigate]);

  function chooseDemo(account: string) {
    setUsername(account);
    setPassword(hint.data?.password_hint ?? "DemoPass123!");
    setTab("login");
    setError("");
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const logged = await login(username.trim(), password);
      navigate(destination ?? homeForRole(logged), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (!agreement) {
      setError("Подтвердите согласие с правилами демонстрационного сервиса");
      return;
    }
    setLoading(true);
    try {
      const created = await register({
        username: username.trim(),
        password,
        full_name: fullName.trim(),
        ...(inn.trim() ? { company_inn: inn.trim() } : {})
      });
      navigate(destination ?? homeForRole(created), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setError(err.details.map((item) => item.message).join("; "));
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось зарегистрироваться");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link to="/" className="back-link"><ArrowLeft size={18} /> Вернуться на главную</Link>
        <Logo />
        <div className="auth-header-right">
          <span className="secure-pill"><ShieldCheck size={16} /> Безопасное соединение</span>
          <a href="/#faq">Помощь</a>
        </div>
      </header>

      <main className="auth-layout">
        <section className="auth-panel">
          <div className="auth-tabs">
            <button className={tab === "login" ? "active" : ""} onClick={() => { setTab("login"); setError(""); }}>Вход</button>
            <button className={tab === "register" ? "active" : ""} onClick={() => { setTab("register"); setError(""); }}>Регистрация</button>
            <span className="auth-online"><span className="live-dot" /> Демо-контур активен</span>
          </div>

          {tab === "login" ? (
            <>
              <h1>Вход в личный кабинет</h1>
              <p className="auth-subtitle">Единый вход для клиентов, сотрудников банка и администраторов.</p>
              <form onSubmit={handleLogin} className="auth-form">
                <Field label="Логин" required>
                  <div className="input-icon-wrap"><UserRound size={18} /><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Например, client1" autoComplete="username" required /></div>
                </Field>
                <Field label="Пароль" required>
                  <div className="input-icon-wrap">
                    <KeyRound size={18} />
                    <Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" autoComplete="current-password" required />
                    <button type="button" className="icon-button input-eye" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
                {error && <Alert tone="danger">{error}</Alert>}
                <Button type="submit" loading={loading} icon={<ArrowRight size={18} />}>Войти в кабинет</Button>
              </form>
              <div className="demo-access">
                <div className="demo-access-head">
                  <span className="eyebrow"><Sparkles size={14} /> Демо-доступ</span>
                  <span>Пароль: <code>{hint.data?.password_hint ?? "DemoPass123!"}</code></span>
                </div>
                <p>Выберите роль — логин и пароль заполнятся автоматически.</p>
                <div className="demo-account-grid">
                  {DEMO_ACCOUNTS.map((account) => {
                    const Icon = account.icon;
                    return (
                      <button type="button" key={account.username} className="demo-account" onClick={() => chooseDemo(account.username)}>
                        <span className={`demo-icon demo-icon-${account.tone}`}><Icon size={18} /></span>
                        <span><strong>{account.title}</strong><small>{account.text}</small><em>@{account.username}</em></span>
                        <ArrowRight size={16} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              <h1>Регистрация в кабинете</h1>
              <p className="auth-subtitle">Создайте демонстрационный профиль предпринимателя. Подтверждения вне сайта не требуются.</p>
              <form onSubmit={handleRegister} className="auth-form">
                <Field label="Логин" hint="От 3 до 32 символов: буквы, цифры, точка, дефис." required>
                  <div className="input-icon-wrap"><UserRound size={18} /><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Например, client3" minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" required /></div>
                </Field>
                <Field label="Имя и фамилия" required>
                  <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Как к вам обращаться" minLength={2} required />
                </Field>
                <Field label="ИНН компании или ИП" hint="Необязательно. Можно указать позже — в мастере заявки.">
                  <Input value={inn} onChange={(event) => setInn(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="10 или 12 цифр" inputMode="numeric" />
                </Field>
                <div className="auth-two-columns">
                  <Field label="Пароль" hint="Минимум 8 символов, буквы и цифры." required>
                    <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Придумайте пароль" minLength={8} required autoComplete="new-password" />
                  </Field>
                  <Field label="Повторите пароль" required>
                    <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Ещё раз" minLength={8} required autoComplete="new-password" />
                  </Field>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} />
                  <span>Я принимаю правила демонстрационного сервиса и согласен на обработку синтетических данных в рамках прототипа.</span>
                </label>
                {error && <Alert tone="danger">{error}</Alert>}
                <Button type="submit" loading={loading} icon={<ArrowRight size={18} />}>Зарегистрироваться</Button>
              </form>
              <p className="auth-switch">Уже есть доступ? <button onClick={() => setTab("login")}>Войти</button></p>
            </>
          )}
        </section>

        <aside className="auth-aside">
          <span className="eyebrow"><Sparkles size={14} /> Финансирование МСП за 3 минуты</span>
          <h2>Быстрый старт финансирования вашего бизнеса</h2>
          <p>Заявка, проверки и решение — в одном кабинете. Без внешних подтверждений и лишних переходов.</p>
          <div className="auth-metrics">
            <div><strong>до 50 млн ₽</strong><span>лимит</span></div>
            <div><strong>от 13,8%</strong><span>ставка</span></div>
            <div><strong>3 минуты</strong><span>на заявку</span></div>
          </div>
          <div className="auth-benefits">
            <div><span className="benefit-icon"><Building2 size={19} /></span><div><strong>Данные вводятся один раз</strong><p>ИНН подтягивает компанию из демонстрационного реестра.</p></div></div>
            <div><span className="benefit-icon"><CheckCircle2 size={19} /></span><div><strong>Статус всегда виден</strong><p>Таймлайн, история и центр уведомлений внутри продукта.</p></div></div>
            <div><span className="benefit-icon"><LockKeyhole size={19} /></span><div><strong>Прозрачное решение</strong><p>Факторы скоринга и понятная причина для каждого исхода.</p></div></div>
          </div>
          <div className="auth-quote">
            <div className="quote-stars">Демо-сценарий</div>
            <p>«Подайте заявку по одному из восьми синтетических ИНН и пройдите путь до демонстрационной выдачи средств».</p>
            <span>CreditPath · прототип</span>
          </div>
          <div className="auth-security"><ShieldCheck size={19} /><span>Серверная проверка ролей, аудит действий и короткоживущие токены.</span></div>
        </aside>
      </main>
      <footer className="auth-footer">
        <span>© 2026 CreditPath · демонстрационный прототип</span>
        <span>Все компании, ИНН и финансовые показатели синтетические.</span>
      </footer>
    </div>
  );
}
