import type { SearchableCatalogItem } from '../../hooks/useStoreCatalog';
import type { SaleItem, Product, ProductStock } from '../../types';
import { remainingPresentation, needsStockReconciliation, initialSaleQuantity } from '../../lib/stock-availability';
import { money } from '../../lib/utils';

export function PresentationSelector({
  choices,
  stock,
  product,
  baseUnit,
  cart,
  onSelect
}: {
  choices: SearchableCatalogItem[];
  stock?: ProductStock;
  product?: Product;
  baseUnit: string;
  cart: SaleItem[];
  onSelect: (choice: SearchableCatalogItem) => void;
}) {
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        Las cajas cerradas tienen stock propio. Las presentaciones que se pueden abrir comparten las unidades disponibles.
      </p>
      {needsStockReconciliation(stock, product?.presentations) && <p className="mb-3 text-sm text-critical">Este saldo estaba unificado. Pide al administrador reclasificar las cajas cerradas en Ajustes antes de vender.</p>}
      <div className="space-y-2">
        {choices.map((choice) => {
          const factor = choice.factor ?? 1;
          const remaining = remainingPresentation(stock, product, cart, choice.productId, choice.presentationId);
          const quantity =
            choice.salePrice > 0
              ? initialSaleQuantity(
                  remaining,
                  choice.presentationId
                    ? {
                        factor,
                        allowFractionalSale: choice.allowFractionalSale,
                        autoUnpackEnabled: choice.autoUnpackEnabled,
                        fractionStep: choice.fractionStep
                      }
                    : null, baseUnit
                )
              : 0;
          return (
            <button
              key={choice.searchKey}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-primary disabled:opacity-50"
              disabled={quantity <= 0}
              onClick={() => onSelect(choice)}
            >
              <span>
                <strong className="block">{choice.presentationLabel}</strong>
                <small className="block text-slate-500">
                  1 presentación = {factor} {baseUnit}
                </small>
                <small className="block text-slate-500">
                  {!choice.presentationId
                    ? 'Venta en unidades base'
                    : choice.allowFractionalSale
                      ? `Fracciones de ${choice.fractionStep ?? 0.5}`
                      : 'Venta por presentación completa'}
                </small>
                <small className="block">
                  {quantity > 0
                    ? `Agregar ${quantity} · consume ${Math.round(quantity * factor * 1000) / 1000} ${baseUnit}`
                    : choice.salePrice <= 0
                      ? 'Sin precio de venta configurado'
                      : 'Stock insuficiente para la cantidad permitida'}
                </small>
              </span>
              <span className="shrink-0 text-right font-mono font-bold">
                {money(choice.salePrice)}
                <small className="block font-sans font-normal text-slate-500">por presentación</small>
                {quantity > 0 && quantity !== 1 && (
                  <small className="block">Total: {money(choice.salePrice * quantity)}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
