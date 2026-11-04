import {
  Column, CreateDateColumn, Entity, Index, JoinTable, ManyToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) name!: string;
  @Column() label!: string;
  @Column({ type: 'jsonb', default: '[]' }) permissions!: string[];
}

@Entity('users')
@Index(['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() username!: string;
  @Column() displayName!: string;
  @Column() passwordHash!: string;
  @Column({ default: true }) active!: boolean;
  @ManyToMany(() => Role, { eager: true })
  @JoinTable({ name: 'user_roles', joinColumn: { name: 'user_id' }, inverseJoinColumn: { name: 'role_id' } })
  roles!: Role[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'material_code', type: 'varchar', length: 80, unique: true, default: () => "('WL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))" }) materialCode!: string;
  @Column({ unique: true }) sku!: string;
  @Column() name!: string;
  @Column({ type: 'varchar' }) kind!: 'product' | 'accessory' | 'bundle';
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ name: 'selling_points', type: 'text', default: '' }) sellingPoints!: string;
  @Column({ type: 'text', nullable: true }) imagePath!: string | null;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('product_variants')
@Index(['productId', 'specification'], { unique: true })
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId!: string;
  @Column() specification!: string;
  @Column() unit!: string;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('product_base_prices')
@Index(['variantId'], { unique: true })
export class ProductBasePrice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'variant_id', type: 'uuid' }) variantId!: string;
  @Column({ name: 'purchase_price', type: 'numeric', precision: 14, scale: 2, nullable: true }) purchasePrice!: string | null;
  @Column({ name: 'standard_retail_price', type: 'numeric', precision: 14, scale: 2, nullable: true }) standardRetailPrice!: string | null;
  @Column({ name: 'finance_cost', type: 'numeric', precision: 14, scale: 2, nullable: true }) financeCost!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('bom_components')
@Index(['parentVariantId', 'componentVariantId'], { unique: true })
export class BomComponent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'parent_variant_id', type: 'uuid' }) parentVariantId!: string;
  @Column({ name: 'component_variant_id', type: 'uuid' }) componentVariantId!: string;
  @Column({ type: 'numeric', precision: 14, scale: 4 }) quantity!: string;
}

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ type: 'text', default: '' }) contact!: string;
  @Column({ type: 'text', default: '' }) phone!: string;
  @Column({ type: 'text', default: '' }) notes!: string;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('brands')
export class Brand {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ type: 'varchar' }) kind!: 'own' | 'customer';
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('price_rules')
export class PriceRule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) quoteType!: 'own' | 'private';
  @Column({ name: 'variant_id', type: 'uuid' }) variantId!: string;
  @Column({ name: 'brand_id', type: 'uuid' }) brandId!: string;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ type: 'varchar' }) quantityMode!: 'whole' | 'segmented';
  @Column({ default: true }) active!: boolean;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('price_tiers')
@Index(['ruleId', 'minQuantity'], { unique: true })
export class PriceTier {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'rule_id', type: 'uuid' }) ruleId!: string;
  @Column({ name: 'min_quantity', type: 'int' }) minQuantity!: number;
  @Column({ name: 'max_quantity_exclusive', type: 'int', nullable: true }) maxQuantityExclusive!: number | null;
  @Column({ type: 'varchar' }) method!: 'fixed' | 'add' | 'markup' | 'discount';
  @Column({ type: 'numeric', precision: 14, scale: 4 }) value!: string;
}

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'quote_number', unique: true }) quoteNumber!: string;
  @Column({ type: 'varchar' }) quoteType!: 'own' | 'private';
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'brand_id', type: 'uuid' }) brandId!: string;
  @Column({ type: 'varchar', default: 'draft' }) status!: 'draft' | 'pending' | 'confirmed' | 'void';
  @Column({ name: 'quote_date', type: 'date' }) quoteDate!: string;
  @Column({ name: 'expires_at', type: 'date' }) expiresAt!: string;
  @Column({ type: 'text', default: '' }) terms!: string;
  @Column({ name: 'customer_snapshot', type: 'jsonb' }) customerSnapshot!: Record<string, unknown>;
  @Column({ name: 'brand_snapshot', type: 'jsonb' }) brandSnapshot!: Record<string, unknown>;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ type: 'int', default: 1 }) version!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('quote_items')
export class QuoteItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'quote_id', type: 'uuid' }) quoteId!: string;
  @Column({ name: 'variant_id', type: 'uuid', nullable: true }) variantId!: string | null;
  @Column({ type: 'varchar' }) kind!: 'product' | 'accessory' | 'bundle';
  @Column({ name: 'product_snapshot', type: 'jsonb' }) productSnapshot!: Record<string, unknown>;
  @Column({ name: 'rule_id', type: 'uuid', nullable: true }) ruleId!: string | null;
  @Column({ name: 'rule_version', type: 'int', nullable: true }) ruleVersion!: number | null;
  @Column({ name: 'base_price_snapshot', type: 'numeric', precision: 14, scale: 2, nullable: true }) basePriceSnapshot!: string | null;
  @Column({ name: 'market_retail_price', type: 'numeric', precision: 14, scale: 2, nullable: true }) marketRetailPrice!: string | null;
  @Column({ name: 'suggested_first_quantity', type: 'int', nullable: true }) suggestedFirstQuantity!: number | null;
  @Column({ name: 'calculation_snapshot', type: 'jsonb' }) calculationSnapshot!: Record<string, unknown>;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true }) confirmedBy!: string | null;
}

@Entity('quote_tiers')
export class QuoteTier {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'quote_item_id', type: 'uuid' }) quoteItemId!: string;
  @Column({ type: 'int' }) quantity!: number;
  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2 }) unitPrice!: string;
  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2 }) totalAmount!: string;
  @Column({ type: 'jsonb' }) calculation!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!: string | null;
  @Column() action!: string;
  @Column({ name: 'entity_type' }) entityType!: string;
  @Column({ name: 'entity_id', type: 'uuid', nullable: true }) entityId!: string | null;
  @Column({ type: 'jsonb', default: {} }) detail!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('opportunities')
export class Opportunity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) number!: string;
  @Column() name!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ type: 'varchar', default: 'in_progress' }) status!: 'in_progress' | 'completed' | 'terminated';
  @Column({ name: 'current_stage_run_id', type: 'uuid', nullable: true }) currentStageRunId!: string | null;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ name: 'expected_amount', type: 'numeric', precision: 14, scale: 2, nullable: true }) expectedAmount!: string | null;
  @Column({ name: 'expected_completion_date', type: 'date', nullable: true }) expectedCompletionDate!: string | null;
  @Column({ name: 'termination_reason', type: 'text', nullable: true }) terminationReason!: string | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('opportunity_stage_runs')
export class OpportunityStageRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column() stage!: string;
  @Column({ type: 'int' }) round!: number;
  @Column({ name: 'entered_at', type: 'timestamptz' }) enteredAt!: Date;
  @Column({ name: 'exited_at', type: 'timestamptz', nullable: true }) exitedAt!: Date | null;
  @Column({ type: 'varchar', nullable: true }) result!: string | null;
  @Column({ name: 'previous_run_id', type: 'uuid', nullable: true }) previousRunId!: string | null;
}

@Entity('opportunity_items')
export class OpportunityItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column({ name: 'variant_id', type: 'uuid' }) variantId!: string;
  @Column({ type: 'jsonb', default: '{}' }) snapshot!: Record<string, unknown>;
}

@Entity('opportunity_documents')
export class OpportunityDocument {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column({ name: 'stage_run_id', type: 'uuid' }) stageRunId!: string;
  @Column() name!: string;
  @Column() type!: string;
  @Column({ name: 'business_date', type: 'date' }) businessDate!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ name: 'extra_data', type: 'jsonb', default: '{}' }) extraData!: Record<string, unknown>;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'is_void', default: false }) isVoid!: boolean;
  @Column({ name: 'void_reason', type: 'text', nullable: true }) voidReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('opportunity_attachments')
export class OpportunityAttachment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column({ name: 'document_id', type: 'uuid', nullable: true }) documentId!: string | null;
  @Column({ name: 'storage_key' }) storageKey!: string;
  @Column({ name: 'file_name' }) fileName!: string;
  @Column({ name: 'mime_type' }) mimeType!: string;
  @Column({ type: 'bigint' }) size!: string;
  @Column() sha256!: string;
  @Column({ name: 'uploaded_by', type: 'uuid' }) uploadedBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('opportunity_quote_links')
export class OpportunityQuoteLink {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column({ name: 'quote_id', type: 'uuid' }) quoteId!: string;
}

@Entity('opportunity_events')
export class OpportunityEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @Column() action!: string;
  @Column({ name: 'from_run_id', type: 'uuid', nullable: true }) fromRunId!: string | null;
  @Column({ name: 'to_run_id', type: 'uuid', nullable: true }) toRunId!: string | null;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @Column({ type: 'text', default: '' }) reason!: string;
  @Column({ name: 'request_id', type: 'uuid', nullable: true }) requestId!: string | null;
  @Column({ type: 'jsonb', default: '{}' }) detail!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
