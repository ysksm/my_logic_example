// Opaque ID types shared across aggregates.

export class OrderId {
  constructor(public readonly value: string) {}
}

export class CustomerId {
  constructor(public readonly value: string) {}
}

export class ProductId {
  constructor(public readonly value: string) {}
}

export type ISO8601 = string;
