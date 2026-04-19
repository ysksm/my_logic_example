import { AggregateRoot } from "../shared/base";
import { CustomerId } from "../shared/ids";

export class Email {
  constructor(public readonly value: string) {}
}

export class Address {
  constructor(
    public readonly line1: string,
    public readonly city: string,
    public readonly postalCode: string,
  ) {}
}

export class Customer extends AggregateRoot {
  constructor(
    public readonly id: CustomerId,
    public readonly email: Email,
    public readonly shippingAddress: Address,
  ) {
    super();
  }

  changeEmail(email: Email): Customer {
    return new Customer(this.id, email, this.shippingAddress);
  }
}

export interface CustomerRepository {
  findById(id: CustomerId): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
}
