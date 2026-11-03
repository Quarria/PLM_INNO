import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductSellingPoints1743000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    await queryRunner.query(`ALTER TABLE "${schema}"."products" ADD COLUMN selling_points text NOT NULL DEFAULT ''`);
  }

  async down(): Promise<void> {
    throw new Error('Removing product selling points may delete business data; perform a reviewed manual migration if needed.');
  }
}
