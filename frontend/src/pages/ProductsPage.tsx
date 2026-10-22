import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Banknote, CreditCard, ShieldCheck, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Badge, Card, formatMoney, LoadingBlock, PageHeader } from "../components/ui";

const ICONS = [WalletCards, Banknote, CreditCard];

export default function ProductsPage() {
  const query = useQuery({ queryKey: ["public-products"], queryFn: api.public.products });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Каталог"
        title="Кредитные продукты"
        description="Выберите продукт под задачу бизнеса. Условия можно рассчитать до подачи заявки."
      />
      {query.isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="product-page-grid">
          {query.data?.map((product, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <Card className="product-detail-card" key={product.code}>
                <div className="product-top">
                  <span className="product-icon"><Icon size={23} /></span>
                  <Badge tone={product.requires_collateral ? "info" : "success"}>
                    {product.requires_collateral ? "С залогом" : "Без залога"}
                  </Badge>
                </div>
                <h2>{product.name}</h2>
                <p>{product.description}</p>
                <div className="product-specs">
                  <div><span>Сумма</span><strong>{formatMoney(product.min_amount)} — {formatMoney(product.max_amount)}</strong></div>
                  <div><span>Срок</span><strong>{product.min_term_months}–{product.max_term_months} мес.</strong></div>
                  <div><span>Ставка</span><strong className="accent-text">от {product.rate.toFixed(1).replace(".", ",")}% годовых</strong></div>
                  <div><span>Возраст бизнеса</span><strong>от {product.min_business_age_months} мес.</strong></div>
                </div>
                <div className="purpose-list">
                  {product.purposes.map((purpose) => <span key={purpose.code}><ShieldCheck size={14} /> {purpose.label}</span>)}
                </div>
                <Link className="btn btn-primary btn-full" to={`/app/applications/new?product=${product.code}`}>
                  Оформить заявку <ArrowRight size={16} />
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
