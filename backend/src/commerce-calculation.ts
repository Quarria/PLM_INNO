import Decimal from 'decimal.js';

export const money = (value: unknown, field: string, allowZero = true): Decimal => {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${field} 必须是金额`);
  const raw = String(value);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${field} 必须为非负两位小数金额`);
  const result = new Decimal(raw).toDecimalPlaces(2);
  if (!allowZero && result.lte(0)) throw new Error(`${field} 必须大于零`);
  if (result.gt('999999999999.99')) throw new Error(`${field} 超出金额范围`);
  return result;
};

export const cents = (value: Decimal): number => value.mul(100).toNumber();
export const fromCents = (value: number): string => new Decimal(value).div(100).toFixed(2);

export interface AllocationTarget { id: string; weight: Decimal }

/** Stable largest-remainder allocation. Allocations always sum to the input cents. */
export function allocateCents(total: number, targets: AllocationTarget[]): Map<string, number> {
  const result = new Map<string, number>();
  if (total === 0) return result;
  const weightTotal = targets.reduce((sum, target) => sum.add(target.weight), new Decimal(0));
  if (weightTotal.lte(0)) throw new Error('无法将优惠分摊到金额为零的商品');
  const parts = targets.map((target, index) => {
    const raw = new Decimal(total).mul(target.weight).div(weightTotal);
    const base = raw.floor().toNumber();
    return { id: target.id, index, base, fraction: raw.sub(base) };
  });
  let remaining = total - parts.reduce((sum, part) => sum + part.base, 0);
  for (const part of [...parts].sort((a, b) => b.fraction.cmp(a.fraction) || a.index - b.index)) {
    if (remaining-- <= 0) break;
    part.base += 1;
  }
  for (const part of parts) result.set(part.id, part.base);
  return result;
}

export function calculateCampaign(
  listPrice: Decimal,
  quantity: number,
  rules: Array<{ name: string; type: 'fixed' | 'percent' | 'threshold'; amount: Decimal; threshold?: Decimal; cap?: Decimal; bearer: 'merchant' | 'platform'; exclusive_group?: string | null }>,
  indexes: number[],
) {
  const originalTotal = listPrice.mul(quantity);
  if (!Number.isSafeInteger(originalTotal.mul(100).toNumber()) || originalTotal.gt('999999999999.99')) throw new Error('测算金额超出范围');
  const originalCents = cents(originalTotal);
  const selected = new Set<number>();
  const groups = new Set<string>();
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= rules.length || selected.has(index)) throw new Error('优惠规则选择无效');
    selected.add(index);
    const group = rules[index].exclusive_group;
    if (group && groups.has(group)) throw new Error('互斥组中的优惠不能同时使用');
    if (group) groups.add(group);
  }
  let appliedCents = 0;
  const discounts = [...indexes].sort((a, b) => a - b).map((index) => {
    const rule = rules[index];
    const original = new Decimal(originalCents).div(100);
    const remaining = new Decimal(Math.max(0, originalCents - appliedCents)).div(100);
    if (rule.type === 'threshold' && (!rule.threshold || original.lt(rule.threshold))) throw new Error(`未达到优惠门槛：${rule.name}`);
    let amount = rule.type === 'percent' ? remaining.mul(rule.amount).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : rule.amount;
    if (rule.cap && amount.gt(rule.cap)) amount = rule.cap;
    if (amount.gt(remaining)) amount = remaining;
    const amountCents = cents(amount);
    appliedCents += amountCents;
    return { name: rule.name, amount_cents: amountCents, bearer: rule.bearer };
  });
  let discountCents = discounts.reduce((sum, discount) => sum + discount.amount_cents, 0);
  // Sequential discounts cannot make the total negative; trim the final selected rules deterministically.
  let excess = Math.max(0, discountCents - originalCents);
  for (let i = discounts.length - 1; i >= 0 && excess > 0; i--) {
    const reduction = Math.min(excess, discounts[i].amount_cents);
    discounts[i].amount_cents -= reduction;
    excess -= reduction;
  }
  discountCents = discounts.reduce((sum, discount) => sum + discount.amount_cents, 0);
  return { original_amount: fromCents(originalCents), discounts: discounts.map((d) => ({ name: d.name, amount: fromCents(d.amount_cents), bearer: d.bearer })), discount_amount: fromCents(discountCents), paid_amount: fromCents(originalCents - discountCents) };
}
