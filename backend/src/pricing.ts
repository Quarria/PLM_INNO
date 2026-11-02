import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';

export type TierInput = { minQuantity: number; maxQuantityExclusive: number | null; method: 'fixed' | 'add' | 'markup' | 'discount'; value: string | number };
export type PriceLine = { quantity: number; unitPrice: string; totalAmount: string; segments: Array<{ quantity: number; unitPrice: string; amount: string; from: number; to: number | null }> };
const money = (n: Decimal) => n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function validateTiers(tiers: TierInput[]) {
  if (!Array.isArray(tiers) || !tiers.length || tiers.some((tier) => !tier || typeof tier !== 'object')) throw new BadRequestException('至少需要设置一个有效数量档');
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  const methods = ['fixed', 'add', 'markup', 'discount'];
  if (sorted[0].minQuantity !== 1) throw new BadRequestException('首档数量下限必须为 1');
  sorted.forEach((tier, index) => {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 1) throw new BadRequestException('数量下限必须为正整数');
    if (!methods.includes(tier.method)) throw new BadRequestException('不支持的价格计算方式');
    if (tier.maxQuantityExclusive !== null && (!Number.isInteger(tier.maxQuantityExclusive) || tier.maxQuantityExclusive <= tier.minQuantity)) throw new BadRequestException('数量上限必须大于下限');
    if (index < sorted.length - 1 && tier.maxQuantityExclusive !== sorted[index + 1].minQuantity) throw new BadRequestException('阶梯数量区间必须连续且不能重叠');
    let value: Decimal;
    try { value = new Decimal(String(tier.value)); } catch { throw new BadRequestException('价格参数必须是有效数字'); }
    if (!value.isFinite() || value.isNegative()) throw new BadRequestException('价格参数必须是大于或等于 0 的数字');
    if (tier.method === 'discount' && value.gt(100)) throw new BadRequestException('折扣百分比不能超过 100%');
  });
  if (sorted[sorted.length - 1].maxQuantityExclusive !== null) throw new BadRequestException('最后一个数量档必须包含更高数量');
  return sorted;
}

function unitPrice(tier: TierInput, basePrice: string | null | undefined): Decimal {
  const value = new Decimal(tier.value);
  if (tier.method === 'fixed') return money(value);
  if (basePrice === null || basePrice === undefined) throw new BadRequestException('采购基准价缺失；此规则不能计算，请改用本次固定价格');
  const base = new Decimal(basePrice);
  if (tier.method === 'add') return money(base.plus(value));
  if (tier.method === 'markup') return money(base.mul(new Decimal(1).plus(value.div(100))));
  return money(base.mul(value.div(100)));
}

export function calculateQuantity(quantity: number, tiers: TierInput[], mode: 'whole' | 'segmented', basePrice: string | null | undefined): PriceLine {
  if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('订购数量必须为正整数');
  const ordered = validateTiers(tiers);
  const segments: PriceLine['segments'] = [];
  if (mode === 'whole') {
    const tier = ordered.find((t) => quantity >= t.minQuantity && (t.maxQuantityExclusive === null || quantity < t.maxQuantityExclusive));
    if (!tier) throw new BadRequestException(`数量 ${quantity} 未落入有效阶梯`);
    const price = unitPrice(tier, basePrice);
    const total = money(price.mul(quantity));
    segments.push({ quantity, unitPrice: price.toFixed(2), amount: total.toFixed(2), from: tier.minQuantity, to: tier.maxQuantityExclusive });
    return { quantity, unitPrice: price.toFixed(2), totalAmount: total.toFixed(2), segments };
  }

  let nextUnit = 1;
  let remaining = quantity;
  let total = new Decimal(0);
  for (const tier of ordered) {
    if (remaining <= 0) break;
    if (tier.maxQuantityExclusive !== null && nextUnit >= tier.maxQuantityExclusive) continue;
    const capacity = tier.maxQuantityExclusive === null ? remaining : tier.maxQuantityExclusive - nextUnit;
    const used = Math.min(remaining, capacity);
    if (used <= 0) continue;
    const price = unitPrice(tier, basePrice);
    const amount = money(price.mul(used));
    segments.push({ quantity: used, unitPrice: price.toFixed(2), amount: amount.toFixed(2), from: tier.minQuantity, to: tier.maxQuantityExclusive });
    total = total.plus(amount);
    remaining -= used;
    nextUnit += used;
  }
  if (remaining > 0) throw new BadRequestException('数量区间不完整，无法计算分段价格');
  const roundedTotal = money(total);
  const average = money(roundedTotal.div(quantity));
  return { quantity, unitPrice: average.toFixed(2), totalAmount: roundedTotal.toFixed(2), segments };
}
