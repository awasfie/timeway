export declare const TENANT_FIELDS: readonly string[];
export declare const TENANT_ROOTS: readonly string[];
export declare const SCHEMA_PATH: string;
export declare const GENERATED_PATH: string;
export interface TenantModel {
  model: string;
  table: string;
  root: boolean;
  tenantFields: { name: string; type: string; nullable: boolean }[];
  nullable: boolean;
}
export interface TenantModelsDoc {
  note: string;
  rule: { tenantFields: string[]; roots: string[] };
  count: number;
  models: TenantModel[];
}
export declare function buildTenantModels(schemaPath?: string): Promise<TenantModelsDoc>;
export declare function serialize(doc: TenantModelsDoc): string;
export declare function isSameDoc(a: string, b: string): boolean;
