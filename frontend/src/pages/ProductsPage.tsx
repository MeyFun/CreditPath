import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Banknote, Check, CreditCard, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, ErrorState, LoadingBlock, PageHeader } from "../components/ui";

const ICONS = [WalletCards, Banknote, CreditCard];

/** «30 млн ₽», «300 тыс. ₽»: в карточке важен порядок суммы, а не все нули. */
function compactMoney(value: number): string {
  const format = (number: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(number);
  if (value >= 1_000_000) return `${format(value / 1_000_000)} млн ₽`;
  if (value >= 1_000) return `${format(value / 1_000)} тыс. ₽`;
  return `${format(value)} ₽`;
}

export default function ProductsPage() {
  const query = useQuery({ queryKey: ["public-products"], queryFn: api.public.products });
  return (
    <div className="page-stack">
      <PageHeader
        title="Кредитные продукты"
        description="Выберите продукт под задачу бизнеса. Условия можно рассчитать до подачи заявки."
      />
      {query.isLoading ? (
        <LoadingBlock variant="list" />
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить продукты" onRetry={() => query.refetch()} />
      ) : (
        <div className="product-page-grid">
          {query.data?.map((product, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <Card className="product-tile" key={product.code}>
                <div className="product-tile-head">
                  <span className="product-icon"><Icon size={22} /></span>
                  <div>
                    <h2>{product.name}</h2>
                    <span className={`product-tile-tag ${product.requires_collateral ? "with-collateral" : ""}`}>
                      {product.requires_collateral ? "Под залог приобретаемого имущества" : "Без залога"}
                    </span>
                  </div>
                </div>
                <p className="product-tile-desc">{product.description}</p>
                <dl className="product-tile-figures">
                  <div className="figure-rate">
                    <dt>Ставка</dt>
                    <dd>от {product.rate.toFixed(1).replace(".", ",")}%</dd>
                    <small>годовых</small>
                  </div>
                  <div>
                    <dt>Сумма</dt>
                    <dd>до {compactMoney(product.max_amount)}</dd>
                    <small>от {compactMoney(product.min_amount)}</small>
                  </div>
                  <div>
                    <dt>Срок</dt>
                    <dd>до {product.max_term_months} мес.</dd>
                    <small>от {product.min_term_months} мес.</small>
                  </div>
                </dl>
                <div className="product-tile-purposes">
                  <span className="product-tile-label">Подходит для</span>
                  <ul>
                    {product.purposes.map((purpose) => <li key={purpose.code}><Check size={14} /> {purpose.label}</li>)}
                  </ul>
                </div>
                <div className="product-tile-foot">
                  <span>Бизнесу от {product.min_business_age_months} мес.</span>
                  <Link className="btn btn-primary" to={`/app/applications/new?product=${product.code}`}>
                    Оформить заявку <ArrowRight size={16} />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
