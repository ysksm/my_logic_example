// Shared metadata shapes. These mirror the Go server (storage.App, storage.DataModel)
// but with fully typed Screen/Component objects on the React side.

export type FieldType = "string" | "text" | "int" | "bool" | "date" | "ref";

export interface Field {
  name: string;
  type: FieldType;
  required?: boolean;
  ref?: string;
}

export interface DataModel {
  name: string;
  fields: Field[];
}

export type ComponentType =
  | "Text"
  | "Button"
  | "Input"
  | "Textarea"
  | "NumberInput"
  | "DateInput"
  | "Checkbox"
  | "Table";

export interface ComponentProps {
  x: number;
  y: number;
  w: number;
  h: number;
  // free-form: label, text, bind, model, columns, etc.
  [k: string]: unknown;
}

// A handler describes what should happen when an event fires. The runtime
// in Preview.tsx interprets these declaratively so we never eval user JS.
export interface EventAction {
  action: "navigate" | "saveRecord" | "deleteRecord" | "setVar";
  target?: string;          // navigate target screen id
  model?: string;           // saveRecord/deleteRecord
  from?: string;            // saveRecord: state-var prefix to read values from ("form")
  recordId?: string;        // saveRecord/deleteRecord: id (literal or "$state.x")
  thenEvent?: string;       // saveRecord: event to dispatch after success
  setVars?: Record<string, string>; // navigate: state vars to set, "$row.id" supported
  varName?: string;         // setVar
  value?: unknown;          // setVar
}

export interface AppComponent {
  id: string;
  type: ComponentType;
  props: ComponentProps;
  events?: Record<string, EventAction>;
}

export interface Screen {
  id: string;
  name: string;
  components: AppComponent[];
}

export interface Transition {
  from: string;
  to: string;
  event: string;
}

export interface AppDoc {
  id: string;
  name: string;
  initialScreen: string;
  screens: Screen[];
  transitions: Transition[];
  stateVariables?: Record<string, unknown>;
}

// Server stores screens/transitions as RawMessage; helpers convert.
export interface AppDocWire {
  id: string;
  name: string;
  initialScreen: string;
  screens: Screen[] | string;
  transitions: Transition[] | string;
  stateVariables?: Record<string, unknown> | string;
}

// ===== DDD domain shapes =====

export type DomainPrimitive =
  | "string" | "text" | "int" | "float" | "bool" | "date" | "datetime";

export interface DomainAttribute {
  name: string;
  // primitive name OR another ValueObject name.
  type: string;
  required?: boolean;
  list?: boolean;
}

export interface DomainReference {
  name: string;
  target: string;          // entity name
  cardinality: "one" | "many";
}

export interface ValueObject {
  name: string;
  isIdentifier?: boolean;
  attributes: DomainAttribute[];
}

export interface DomainEntity {
  name: string;
  identifierName: string;  // e.g. "id"
  identifierType: string;  // VO name
  attributes: DomainAttribute[];
  references?: DomainReference[];
}

export interface Aggregate {
  name: string;
  root: string;            // entity name
  members?: string[];      // additional entity names included in the aggregate
}

export interface DomainPosition { x: number; y: number }

export interface Domain {
  id: string;
  name: string;
  valueObjects: ValueObject[];
  entities: DomainEntity[];
  aggregates: Aggregate[];
  layout?: Record<string, DomainPosition>;
}

export const DOMAIN_PRIMITIVES: DomainPrimitive[] = [
  "string", "text", "int", "float", "bool", "date", "datetime",
];

export function fromWire(a: AppDocWire): AppDoc {
  const parse = <T,>(v: T | string | undefined, fallback: T): T => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === "string") return v ? (JSON.parse(v) as T) : fallback;
    return v;
  };
  return {
    id: a.id,
    name: a.name,
    initialScreen: a.initialScreen,
    screens: parse(a.screens, [] as Screen[]),
    transitions: parse(a.transitions, [] as Transition[]),
    stateVariables: parse(a.stateVariables, {} as Record<string, unknown>),
  };
}
