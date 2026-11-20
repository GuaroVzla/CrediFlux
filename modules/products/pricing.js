// Margen por defecto (30%) y precio calculado en modo automático
export const DEFAULT_PROFIT_MARGIN = 30;

export function getProductMargin(prod) {
  const margin = Number(prod?.profitMarginPercent);
  return Number.isFinite(margin) ? margin : DEFAULT_PROFIT_MARGIN;
}

export function getAutoSalePrice(prod) {
  const cost = Number(prod?.costPrice) || 0;
  return Number((cost * (1 + getProductMargin(prod) / 100)).toFixed(2));
}
