export enum Currency {
  JPY = "JPY",
  USD = "USD",
  EUR = "EUR",
}

export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: Currency,
  ) {}

  add(other: Money): Money {
    return new Money(this.amount + other.amount, this.currency);
  }
}
