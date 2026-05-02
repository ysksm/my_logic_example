// Mirror of the Go IR1/IR2 types. Keep in sync with server/internal/{domain,ui}.

export type FieldType =
  | "string"
  | "text"
  | "int"
  | "bool"
  | "date"
  | "enum"
  | "ref"
  | "vo";

export interface Field {
  name: string;
  type: FieldType;
  required?: boolean;
  enumValues?: string[];
  refTo?: string;
  voTypeRef?: string;
  many?: boolean;
}

export interface ValueObject {
  name: string;
  fields: Field[];
  isIdentifier?: boolean;
}

export interface Entity {
  name: string;
  fields: Field[];
  children?: string[];
  isRoot?: boolean;
}

export interface UIHint {
  pattern?: "" | "P1" | "P2" | "P3" | "P4" | "P5";
  formStyle?: "" | "inline" | "modal" | "dialog";
  childStyle?: "" | "tab" | "section" | "table";
}

export interface Aggregate {
  name: string;
  isSingleton?: boolean;
  root: Entity;
  entities?: Entity[];
  valueObjects?: ValueObject[];
  uiHint?: UIHint;
}

export interface Service {
  name: string;
  aggregateRef: string;
  inputs?: Field[];
  confirm?: boolean;
}

export interface DomainModel {
  id: string;
  name: string;
  aggregates: Aggregate[];
  services?: Service[];
}

export type Pattern = "P1" | "P2" | "P3" | "P4" | "P5";

export interface Component {
  type: string;
  bind?: string;
  label?: string;
  props?: Record<string, unknown>;
  children?: Component[];
}

export interface Screen {
  id: string;
  kind: string;
  title: string;
  aggregateRef: string;
  entityRef?: string;
  parentScreen?: string;
  components: Component[];
  stepIndex?: number;
}

export interface Transition {
  from: string;
  to: string;
  event: string;
}

export interface AggregatePlan {
  aggregateRef: string;
  pattern: Pattern;
  reason: string;
  screenIds: string[];
  navLabel: string;
}

export interface AppSpec {
  domainId: string;
  domainName: string;
  plans: AggregatePlan[];
  screens: Screen[];
  transitions: Transition[];
  navRoots: string[];
}

export interface RulesConfig {
  SmallFormFieldLimit: number;
  WizardFieldLimit: number;
}

export interface SampleInfo {
  id: string;
  name: string;
  description?: string;
  aggregateCount: number;
}

export interface Sample {
  id: string;
  name: string;
  description?: string;
  aggregateCount: number;
  domain: DomainModel;
}

export type RunStatus =
  | "generating"
  | "installing"
  | "starting"
  | "ready"
  | "stopped"
  | "error";

export interface Run {
  domainId: string;
  path: string;
  port: number;
  url?: string;
  status: RunStatus;
  error?: string;
  startedAt: string;
  updatedAt: string;
  logPath?: string;
}
