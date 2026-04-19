export abstract class AggregateRoot {
  abstract readonly id: unknown;
}

export abstract class Entity {
  abstract readonly id: unknown;
}

export abstract class ValueObject {}

export abstract class DomainEvent {
  readonly occurredAt: Date = new Date();
}
