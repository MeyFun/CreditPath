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
  UserRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { SiteFooter } from "../components/Footer";
import { homeForRole, useAuth } from "../auth";
import { Alert, Button, Field, Input, Logo } from "../components/ui";

const DEMO_ACCOUNTS = [
  { username: "client1", title: "Клиент", text: "ООО «Северный Ветер», торговля", icon: UserRound, tone: "red" },
  { username: "client3", title: "Клиент · связанное лицо", text: "ИП Кузнецова, родственница employee3", icon: Building2, tone: "blue" },
  { username: "employee1", title: "Сотрудник банка", text: "Очередь заявок и решения", icon: BadgeCheck, tone: "green" },
  { username: "admin", title: "Администратор", text: "Роли, справочники, аудит", icon: ShieldCheck, tone: "dark" }
];

export default function AuthPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    setPassword(hint.data?.password_hint ?? "");
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
          <h1>Вход в личный кабинет</h1>
          <p className="auth-subtitle">Доступ выдаёт банк при подключении к сервису. Единый вход для клиентов, сотрудников и администраторов.</p>
          <form onSubmit={handleLogin} className="auth-form">
            <Field label="Логин" required>
              <div className="input-icon-wrap"><UserRound size={18} /><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Логин" autoComplete="username" required /></div>
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
          <details className="demo-access">
            <summary>Тестовые данные</summary>
            <div className="demo-access-head">
              <span>Выберите роль — логин и пароль заполнятся сами.</span>
              {hint.data?.password_hint && <span>Пароль: <code>{hint.data.password_hint}</code></span>}
            </div>
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
          </details>
        </section>

        <aside className="auth-aside">
          <h2>От заявки до решения — в одном кабинете</h2>
          <p>Подайте заявку, следите за проверками и получите решение без визита в банк.</p>
          <div className="auth-metrics">
            <div><strong>до 50 млн ₽</strong><span>лимит</span></div>
            <div><strong>от 13,8%</strong><span>ставка</span></div>
            <div><strong>~10 минут</strong><span>на заявку</span></div>
          </div>
          <div className="auth-benefits">
            <div><span className="benefit-icon"><Building2 size={19} /></span><div><strong>Данные вводятся один раз</strong><p>По ИНН данные компании заполнятся автоматически.</p></div></div>
            <div><span className="benefit-icon"><CheckCircle2 size={19} /></span><div><strong>Статус всегда виден</strong><p>Этапы и история заявки в кабинете.</p></div></div>
            <div><span className="benefit-icon"><LockKeyhole size={19} /></span><div><strong>Понятное решение</strong><p>Факторы скоринга и понятная причина для каждого исхода.</p></div></div>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
