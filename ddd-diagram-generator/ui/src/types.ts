export type Stereotype =
  | "aggregate"
  | "entity"
  | "valueObject"
  | "repository"
  | "service"
  | "factory"
  | "event"
  | "command"
  | "query"
  | "policy"
  | "enum"
  | "typeAlias"
  | "interface"
  | "class";

export type Kind = "class" | "interface" | "enum" | "typeAlias";

export type EdgeKind = "extends" | "implements" | "field" | "method" | "aggregate";

export interface ApiField {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  typeRefs: string[];
}

export interface ApiMethod {
  name: string;
  returnType: string;
  typeRefs: string[];
}

export interface ApiNode {
  id: string;
  name: string;
  kind: Kind;
  stereotype: Stereotype;
  file: string;
  line: number;
  module: string;
  extends: string[];
  implements: string[];
  fields: ApiField[];
  methods: ApiMethod[];
  enumValues?: string[];
  aggregate?: string;
  exported: boolean;
}

export interface ApiEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface ApiModule {
  name: string;
  path: string;
  nodes: string[];
}

export interface ApiGraph {
  root: string;
  nodes: ApiNode[];
  edges: ApiEdge[];
  modules: ApiModule[];
  stats: {
    filesScanned: number;
    nodeCount: number;
    edgeCount: number;
    moduleCount: number;
  };
}

export type LayoutName = "dagre-lr" | "dagre-tb" | "grid" | "cluster-aggregate" | "cluster-module";

export type GroupBy = "none" | "aggregate" | "module" | "stereotype";
