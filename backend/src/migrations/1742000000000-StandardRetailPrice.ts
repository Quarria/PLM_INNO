import { MigrationInterface, QueryRunner } from 'typeorm';

export class StandardRetailPrice1742000000000 implements MigrationInterface {
  private table(): string {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    return `"${schema}"."product_base_prices"`;
  }
  async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE ${this.table()} ADD COLUMN standard_retail_price numeric(14,2) NULL`); }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE ${this.table()} DROP COLUMN standard_retail_price`); }
}
