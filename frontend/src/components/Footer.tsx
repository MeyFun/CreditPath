import { Logo } from "./ui";

// Контакты и реквизиты — заглушки демо-организации. Ни один шаг сценария не идёт через них.
const CONTACTS = {
  phone: "8 800 000-00-00",
  email: "support@creditpath.example",
  address: "г. Москва, ул. Примерная, д. 1",
  hours: "Пн–Пт, 9:00–20:00 (МСК)"
};

const LEGAL_LINE = "© 2026 ООО «КредитПас» (демо-организация) · ИНН 0000000000 · ОГРН 0000000000000";
const DISCLAIMER = "Прототип для хакатона. Не является кредитной организацией и публичной офертой. Все данные синтетические.";

const DOCUMENTS = [
  "Политика обработки персональных данных",
  "Согласие на запрос в бюро кредитных историй",
  "Условия использования сервиса",
  "Раскрытие информации"
];

function DocumentLinks() {
  return (
    <>
      {DOCUMENTS.map((title) => (
        <a key={title} href="#" onClick={(event) => event.preventDefault()}>{title}</a>
      ))}
    </>
  );
}

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="app-footer">
        <div className="app-footer-links">
          <span>{CONTACTS.phone}</span>
          <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
          <DocumentLinks />
        </div>
        <div className="app-footer-legal">
          <span>{LEGAL_LINE}</span>
          <span>{DISCLAIMER}</span>
        </div>
      </footer>
    );
  }
  return (
    <footer className="public-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <Logo />
          <p>Кредитный кабинет для малого и микробизнеса.</p>
        </div>
        <div>
          <h4>Продукты</h4>
          <a href="/#products">Оборотный кредит</a>
          <a href="/#products">Кредит на оборудование</a>
          <a href="/#products">Овердрафт</a>
          <a href="/#calculator">Калькулятор</a>
        </div>
        <div>
          <h4>Клиентам</h4>
          <a href="/#how">Как получить кредит</a>
          <a href="/#faq">Вопросы и ответы</a>
          <a href="/login">Войти в кабинет</a>
          <a href="/register">Регистрация</a>
        </div>
        <div>
          <h4>Документы</h4>
          <DocumentLinks />
        </div>
        <div>
          <h4>Контакты</h4>
          <span>{CONTACTS.phone}</span>
          <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
          <span>{CONTACTS.address}</span>
          <span>{CONTACTS.hours}</span>
        </div>
      </div>
      <div className="footer-bottom">
        <span>{LEGAL_LINE}</span>
        <span>{DISCLAIMER}</span>
      </div>
    </footer>
  );
}
