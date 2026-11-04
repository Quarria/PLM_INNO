import { MigrationInterface, QueryRunner } from 'typeorm';

export class Opportunities1746000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    const schema = process.env.DB_SCHEMA || 'plm';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    const q = (name: string) => `"${schema}"."${name}"`;
    await qr.query(`
      CREATE SEQUENCE ${q('opportunity_number_seq')};
      CREATE TABLE ${q('opportunities')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE,
        name text NOT NULL, customer_id uuid NOT NULL REFERENCES ${q('customers')}(id) ON DELETE RESTRICT,
        owner_id uuid NOT NULL REFERENCES ${q('users')}(id) ON DELETE RESTRICT,
        created_by uuid NOT NULL REFERENCES ${q('users')}(id) ON DELETE RESTRICT,
        description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','terminated')),
        current_stage_run_id uuid, version integer NOT NULL DEFAULT 1 CHECK(version>0),
        expected_amount numeric(14,2) CHECK(expected_amount IS NULL OR expected_amount>=0), expected_completion_date date,
        termination_reason text, completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${q('opportunity_stage_runs')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        stage text NOT NULL CHECK(stage IN ('sampling','delivery','feedback','contract','completed')),
        round integer NOT NULL CHECK(round>0), entered_at timestamptz NOT NULL DEFAULT now(), exited_at timestamptz,
        result text CHECK(result IS NULL OR result IN ('completed','returned')), previous_run_id uuid REFERENCES ${q('opportunity_stage_runs')}(id) ON DELETE RESTRICT,
        UNIQUE(opportunity_id,stage,round)
      );
      ALTER TABLE ${q('opportunities')} ADD CONSTRAINT "opportunities_current_run_fk" FOREIGN KEY(current_stage_run_id) REFERENCES ${q('opportunity_stage_runs')}(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
      CREATE TABLE ${q('opportunity_items')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        variant_id uuid NOT NULL REFERENCES ${q('product_variants')}(id) ON DELETE RESTRICT, snapshot jsonb NOT NULL DEFAULT '{}', UNIQUE(opportunity_id,variant_id)
      );
      CREATE TABLE ${q('opportunity_quote_links')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        quote_id uuid NOT NULL REFERENCES ${q('quotes')}(id) ON DELETE RESTRICT, UNIQUE(opportunity_id,quote_id)
      );
      CREATE TABLE ${q('opportunity_documents')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        stage_run_id uuid NOT NULL REFERENCES ${q('opportunity_stage_runs')}(id) ON DELETE RESTRICT,
        name text NOT NULL, type text NOT NULL, business_date date NOT NULL, description text NOT NULL DEFAULT '', extra_data jsonb NOT NULL DEFAULT '{}',
        created_by uuid NOT NULL REFERENCES ${q('users')}(id) ON DELETE RESTRICT,
        is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${q('opportunity_attachments')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        document_id uuid REFERENCES ${q('opportunity_documents')}(id) ON DELETE RESTRICT, storage_key text NOT NULL UNIQUE,
        file_name text NOT NULL, mime_type text NOT NULL, size bigint NOT NULL CHECK(size>0 AND size<=20971520), sha256 char(64) NOT NULL,
        uploaded_by uuid NOT NULL REFERENCES ${q('users')}(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${q('opportunity_events')} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES ${q('opportunities')}(id) ON DELETE RESTRICT,
        action text NOT NULL, from_run_id uuid REFERENCES ${q('opportunity_stage_runs')}(id) ON DELETE RESTRICT,
        to_run_id uuid REFERENCES ${q('opportunity_stage_runs')}(id) ON DELETE RESTRICT,
        actor_id uuid NOT NULL REFERENCES ${q('users')}(id) ON DELETE RESTRICT, reason text NOT NULL DEFAULT '',
        request_id uuid, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX "opportunity_events_request_uq" ON ${q('opportunity_events')}(opportunity_id,request_id) WHERE request_id IS NOT NULL;
      CREATE INDEX "opportunities_list_idx" ON ${q('opportunities')}(status,updated_at DESC);
      CREATE INDEX "opportunities_owner_idx" ON ${q('opportunities')}(owner_id,status);
      CREATE INDEX "opportunity_runs_history_idx" ON ${q('opportunity_stage_runs')}(opportunity_id,entered_at);
      CREATE INDEX "opportunity_documents_run_idx" ON ${q('opportunity_documents')}(stage_run_id,created_at);
      CREATE INDEX "opportunity_attachments_doc_idx" ON ${q('opportunity_attachments')}(document_id);
      UPDATE ${q('roles')} SET permissions=(SELECT jsonb_agg(DISTINCT p) FROM jsonb_array_elements_text(permissions || '["opportunity:view","opportunity:create","opportunity:write"]'::jsonb) p) WHERE name='business';
    `);
  }

  async down(): Promise<void> {
    throw new Error('商机记录和附件属于业务历史，回滚需人工评审；不执行自动删除。');
  }
}
