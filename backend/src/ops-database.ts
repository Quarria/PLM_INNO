import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class OpsDatabase {
  constructor(readonly db: DataSource) {}
  table(name: string): string {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema) || !/^[a-z_]+$/.test(name)) throw new Error('Invalid database identifier');
    return `"${schema}"."${name}"`;
  }
}
