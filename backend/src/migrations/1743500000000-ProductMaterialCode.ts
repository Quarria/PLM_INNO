import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductMaterialCode1743500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    await q.query(`ALTER TABLE "${schema}".products ADD COLUMN material_code varchar(80) NOT NULL DEFAULT ('WL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)), ADD CONSTRAINT products_material_code_unique UNIQUE(material_code)`);
  }
  async down(): Promise<void> { throw new Error('Material identity removal requires reviewed manual migration'); }
}
