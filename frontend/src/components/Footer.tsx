import { ArrowUpRight, Clock3, Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Logo, Modal } from "./ui";

// Вымышленные реквизиты ООО «КредитПас»: проверьте номера перед публикацией, чтобы они не совпали с реальной организацией.
const CONTACTS = {
  phone: "8 800 555-14-27",
  email: "support@creditpath.ru",
  address: "г. Москва, Тверская ул., д. 18",
  hours: "Пн–Пт, 9:00–20:00 (МСК)"
};

const COMPANY = "ООО «КредитПас»";
const REQUISITES = "ИНН 7718452038 · ОГРН 1157746994019";

interface LegalDocument {
  title: string;
  body: string[];
}

const DOCUMENTS: LegalDocument[] = [
  {
    title: "Политика обработки персональных данных",
    body: [
      "Мы обрабатываем данные, которые вы указываете в кабинете и заявке: ФИО, логин, ИНН и реквизиты компании, параметры кредита и приложенные документы.",
      "Данные используются только для рассмотрения заявки, связи с вами в кабинете и исполнения договора. Доступ к заявке есть у вас, назначенного сотрудника банка и администратора.",
      "Каждое действие с заявкой фиксируется в журнале аудита, который нельзя изменить."
    ]
  },
  {
    title: "Согласие на запрос в бюро кредитных историй",
    body: [
      "Отправляя заявку, вы разрешаете запросить кредитную историю компании в бюро кредитных историй.",
      "Сведения о платёжной дисциплине, текущих обязательствах и просрочках используются для оценки заявки и не передаются третьим лицам."
    ]
  },
  {
    title: "Условия использования сервиса",
    body: [
      "Кабинет позволяет подобрать продукт, подать заявку от имени компании, отслеживать её статус, принять предложение и подписать договор.",
      "Заявку может подать собственник, руководитель или сотрудник, уполномоченный действовать от имени компании.",
      "Предварительный расчёт в калькуляторе не является офертой: итоговые условия фиксируются в решении банка."
    ]
  },
  {
    title: "Раскрытие информации",
    body: [
      `${COMPANY}, ${REQUISITES}.`,
      `Адрес: ${CONTACTS.address}. Поддержка: ${CONTACTS.phone}, ${CONTACTS.email}, ${CONTACTS.hours}.`
    ]
  }
];

function useDocumentModal() {
  const [open, setOpen] = useState<LegalDocument | null>(null);
  const links = DOCUMENTS.map((doc) => (
    <button key={doc.title} type="button" className="footer-link" onClick={() => setOpen(doc)}>{doc.title}</button>
  ));
  const modal = (
    <Modal open={Boolean(open)} title={open?.title ?? ""} onClose={() => setOpen(null)} footer={<Button variant="secondary" onClick={() => setOpen(null)}>Закрыть</Button>}>
      <div className="legal-doc">{open?.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
    </Modal>
  );
  return { links, modal };
}

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const { links, modal } = useDocumentModal();

  if (compact) {
    return (
      <footer className="app-footer">
        <span className="app-footer-copy">© 2026 {COMPANY}</span>
        <nav className="app-footer-links" aria-label="Документы">{links}</nav>
        <a className="app-footer-phone" href={`tel:${CONTACTS.phone.replace(/\D/g, "")}`}><Phone size={13} /> {CONTACTS.phone}</a>
        {modal}
      </footer>
    );
  }

  return (
    <footer className="public-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <Logo />
          <p>Кредиты для малого бизнеса онлайн: заявка, проверки и решение — в одном кабинете.</p>
          <Link className="footer-cta" to="/register">Открыть кабинет <ArrowUpRight size={16} /></Link>
        </div>
        <nav aria-label="Продукты">
          <h4>Продукты</h4>
          <a href="/#products">Оборотный кредит</a>
          <a href="/#products">Кредит на оборудование</a>
          <a href="/#products">Овердрафт</a>
          <a href="/#calculator">Калькулятор платежа</a>
        </nav>
        <nav aria-label="Клиентам">
          <h4>Клиентам</h4>
          <a href="/#how">Как получить кредит</a>
          <a href="/#faq">Вопросы и ответы</a>
          <Link to="/login">Войти в кабинет</Link>
        </nav>
        <nav aria-label="Документы">
          <h4>Документы</h4>
          {links}
        </nav>
        <address className="footer-contacts">
          <h4>Поддержка</h4>
          <a className="footer-phone" href={`tel:${CONTACTS.phone.replace(/\D/g, "")}`}>{CONTACTS.phone}</a>
          <span><Mail size={14} /> <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a></span>
          <span><Clock3 size={14} /> {CONTACTS.hours}</span>
          <span><MapPin size={14} /> {CONTACTS.address}</span>
        </address>
      </div>
      <div className="footer-bottom">
        <span>© 2026 {COMPANY}</span>
        <span>{REQUISITES}</span>
      </div>
      {modal}
    </footer>
  );
}
