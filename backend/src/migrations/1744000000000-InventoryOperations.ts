import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryOperations1744000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    await queryRunner.query(`
      CREATE TABLE "${schema}".ops_warehouses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO "${schema}".ops_warehouses(name) VALUES ('自有仓库');
      CREATE TABLE "${schema}".ops_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number varchar(32) NOT NULL UNIQUE,
        type varchar(24) NOT NULL CHECK (type IN ('purchase','initial','return','borrow_return','sale','sample','borrow','internal','scrap','assembly','disassembly','inspection','bundle_components','reservation','release')),
        reason text NOT NULL DEFAULT '', warehouse_id uuid NOT NULL REFERENCES "${schema}".ops_warehouses(id),
        occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        recipient text NOT NULL DEFAULT '', sales_order_id uuid NULL, carrier text NOT NULL DEFAULT '', tracking_number text NOT NULL DEFAULT '',
        shipping_cost numeric(14,2) NULL CHECK (shipping_cost IS NULL OR shipping_cost >= 0), expected_return_at timestamptz NULL, notes text NOT NULL DEFAULT '',
        actor_id uuid NOT NULL, actor_name text NOT NULL
      );
      CREATE INDEX ops_movements_order_idx ON "${schema}".ops_movements(sales_order_id) WHERE sales_order_id IS NOT NULL;
      CREATE TABLE "${schema}".ops_units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES "${schema}".products(id),
        serial_number text NOT NULL, batch_number text NOT NULL DEFAULT '',
        status varchar(24) NOT NULL CHECK (status IN ('available','reserved','pending','borrowed','shipped','assembled','disassembled','scrapped')),
        warehouse_id uuid NULL REFERENCES "${schema}".ops_warehouses(id), parent_id uuid NULL REFERENCES "${schema}".ops_units(id),
        reserved_order_id uuid NULL, traceability_pending boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(product_id, serial_number), CHECK (parent_id IS NULL OR parent_id <> id),
        CHECK ((status = 'reserved') = (reserved_order_id IS NOT NULL)),
        CHECK ((status IN ('available','reserved','pending')) = (warehouse_id IS NOT NULL)),
        CHECK ((status = 'assembled') = (parent_id IS NOT NULL))
      );
      CREATE INDEX ops_units_status_idx ON "${schema}".ops_units(product_id,status,warehouse_id);
      CREATE INDEX ops_units_batch_idx ON "${schema}".ops_units(product_id,batch_number);
      CREATE TABLE "${schema}".ops_movement_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), movement_id uuid NOT NULL REFERENCES "${schema}".ops_movements(id),
        unit_id uuid NOT NULL REFERENCES "${schema}".ops_units(id), product_id uuid NOT NULL REFERENCES "${schema}".products(id),
        batch_number text NOT NULL, from_status varchar(24) NULL, to_status varchar(24) NOT NULL,
        from_warehouse_id uuid NULL REFERENCES "${schema}".ops_warehouses(id), to_warehouse_id uuid NULL REFERENCES "${schema}".ops_warehouses(id),
        source_movement_item_id uuid NULL REFERENCES "${schema}".ops_movement_items(id),
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(movement_id,unit_id)
      );
      CREATE INDEX ops_movement_items_unit_idx ON "${schema}".ops_movement_items(unit_id,movement_id);
      CREATE UNIQUE INDEX ops_movement_items_source_once_idx ON "${schema}".ops_movement_items(source_movement_item_id) WHERE source_movement_item_id IS NOT NULL;
      CREATE TABLE "${schema}".ops_assembly_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_unit_id uuid NOT NULL REFERENCES "${schema}".ops_units(id),
        child_unit_id uuid NOT NULL REFERENCES "${schema}".ops_units(id), assembly_movement_id uuid NOT NULL REFERENCES "${schema}".ops_movements(id),
        disassembly_movement_id uuid NULL REFERENCES "${schema}".ops_movements(id), valid_from timestamptz NOT NULL,
        valid_to timestamptz NULL, CHECK(parent_unit_id <> child_unit_id)
      );
      CREATE UNIQUE INDEX ops_assembly_active_child_idx ON "${schema}".ops_assembly_links(child_unit_id) WHERE valid_to IS NULL;
      CREATE INDEX ops_assembly_parent_idx ON "${schema}".ops_assembly_links(parent_unit_id,valid_from);
    `);
  }

  async down(): Promise<void> {
    throw new Error('Inventory movements contain business history; use a reviewed manual migration to remove them.');
  }
}
