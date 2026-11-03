import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommerceOperations1745000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    const q = (name: string) => `"${schema}"."${name}"`;
    await queryRunner.query(`
      CREATE TABLE ${q('ops_stores')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(platform, name)
      );
      CREATE TABLE ${q('ops_campaigns')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
        store_id uuid REFERENCES ${q('ops_stores')}(id) ON DELETE RESTRICT,
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
        notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_at >= starts_at)
      );
      CREATE TABLE ${q('ops_campaign_items')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES ${q('ops_campaigns')}(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES ${q('products')}(id) ON DELETE RESTRICT,
        list_price numeric(14,2) NOT NULL CHECK (list_price >= 0),
        product_snapshot jsonb NOT NULL DEFAULT '{}', UNIQUE(campaign_id, product_id)
      );
      CREATE TABLE ${q('ops_campaign_rules')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_item_id uuid NOT NULL REFERENCES ${q('ops_campaign_items')}(id) ON DELETE CASCADE,
        rule_index integer NOT NULL CHECK (rule_index >= 0), name text NOT NULL,
        type text NOT NULL CHECK (type IN ('fixed','percent','threshold')),
        amount numeric(14,2) NOT NULL CHECK (amount >= 0), threshold numeric(14,2), cap numeric(14,2),
        bearer text NOT NULL CHECK (bearer IN ('merchant','platform')), exclusive_group text,
        CHECK ((type <> 'threshold') OR (threshold IS NOT NULL AND threshold >= 0)), UNIQUE(campaign_item_id, rule_index)
      );
      CREATE TABLE ${q('ops_campaign_versions')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES ${q('ops_campaigns')}(id) ON DELETE RESTRICT,
        version integer NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL CHECK (status IN ('draft','published','archived')),
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id, version)
      );
      CREATE TABLE ${q('ops_sales_orders')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE,
        external_number text, channel text NOT NULL, store_id uuid REFERENCES ${q('ops_stores')}(id) ON DELETE RESTRICT,
        customer_name text NOT NULL DEFAULT '', recipient_phone text NOT NULL DEFAULT '', shipping_address text NOT NULL DEFAULT '', ordered_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','partial','shipped','cancelled')),
        original_amount numeric(14,2) NOT NULL CHECK(original_amount >= 0), discount_amount numeric(14,2) NOT NULL CHECK(discount_amount >= 0),
        paid_amount numeric(14,2) NOT NULL CHECK(paid_amount >= 0), shipping_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(shipping_amount >= 0),
        refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(refunded_amount >= 0), discounts_complete boolean NOT NULL DEFAULT true,
        undisclosed_discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(undisclosed_discount_amount >= 0),
        notes text NOT NULL DEFAULT '', created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (discount_amount <= original_amount), CHECK (refunded_amount <= paid_amount)
      );
      CREATE UNIQUE INDEX "ops_sales_orders_store_external_uq" ON ${q('ops_sales_orders')}(store_id, external_number) WHERE external_number IS NOT NULL;
      CREATE TABLE ${q('ops_sales_order_items')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${q('ops_sales_orders')}(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES ${q('products')}(id) ON DELETE RESTRICT, quantity integer NOT NULL CHECK(quantity > 0),
        unit_price numeric(14,2) NOT NULL CHECK(unit_price >= 0), original_amount numeric(14,2) NOT NULL CHECK(original_amount >= 0),
        discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0), paid_amount numeric(14,2) NOT NULL CHECK(paid_amount >= 0),
        undisclosed_discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(undisclosed_discount_amount >= 0),
        campaign_id uuid REFERENCES ${q('ops_campaigns')}(id) ON DELETE RESTRICT, campaign_version integer,
        campaign_snapshot jsonb, product_snapshot jsonb NOT NULL DEFAULT '{}'
      );
      CREATE TABLE ${q('ops_sales_order_discounts')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${q('ops_sales_orders')}(id) ON DELETE RESTRICT,
        name text NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount >= 0), bearer text NOT NULL CHECK(bearer IN ('merchant','platform')),
        product_id uuid REFERENCES ${q('products')}(id) ON DELETE RESTRICT, allocations jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${q('ops_sales_order_refunds')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${q('ops_sales_orders')}(id) ON DELETE RESTRICT,
        amount numeric(14,2) NOT NULL CHECK(amount > 0), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
      );
      CREATE TABLE ${q('ops_sales_order_discount_revisions')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ${q('ops_sales_orders')}(id) ON DELETE RESTRICT,
        previous_discounts jsonb NOT NULL, replacement_discounts jsonb NOT NULL,
        previous_discounts_complete boolean NOT NULL, actor_id uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "ops_campaigns_status_dates_idx" ON ${q('ops_campaigns')}(status, starts_at, ends_at);
      CREATE INDEX "ops_sales_orders_ordered_idx" ON ${q('ops_sales_orders')}(ordered_at DESC);
      CREATE INDEX "ops_sales_order_items_campaign_idx" ON ${q('ops_sales_order_items')}(campaign_id, product_id);
    `);
  }

  async down(): Promise<void> {
    throw new Error('Commerce data is business history; use a reviewed manual rollback if required.');
  }
}
