import type { Product, ProductStock } from '../types';
import type { SearchableCatalogItem } from '../hooks/useStoreCatalog';
import { availableBase, availablePresentation } from './stock-availability';

export function salePresentations(stock: ProductStock, product?: Product): SearchableCatalogItem[] {
  const unit = product?.unit ?? stock.unit ?? 'UN';
  return [
    {
      ...stock,
      searchKey: `${stock.productId}_base`,
      factor: 1,
      presentationUnit: unit,
      presentationLabel: `Unidad base (${unit})`,
      salePrice: product?.salePrice ?? stock.salePrice,
      barcode: product?.barcode ?? stock.barcode,
      quantity: availableBase(stock, product?.presentations)
    },
    ...(product?.presentations ?? []).flatMap((presentation, index) => {
      const id = presentation.id || `legacy-${index + 1}`;
      const label = presentation.description || `${presentation.unit} x${presentation.factor}`;
      return [
        {
          ...stock,
          productName: `${stock.productName} (${label})`,
          searchKey: `${stock.productId}_${id}`,
          presentationId: id,
          presentationUnit: presentation.unit,
          presentationLabel: label,
          factor: presentation.factor,
          salePrice: presentation.salePrice,
          barcode: presentation.barcode,
          allowFractionalSale: presentation.allowFractionalSale === true && presentation.autoUnpackEnabled === true,
          autoUnpackEnabled: presentation.autoUnpackEnabled,
          fractionStep: presentation.fractionStep ?? 0.5,
          quantity: availablePresentation(stock, product?.presentations, presentation)
        }
      ];
    })
  ];
}
