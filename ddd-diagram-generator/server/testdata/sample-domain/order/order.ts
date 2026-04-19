import { AggregateRoot, Entity, DomainEvent } from "../shared/base";
import { Money } from "../shared/money";
import { OrderId, CustomerId, ProductId } from "../shared/ids";

export enum OrderStatus {
  Draft = "Draft",
  Placed = "Placed",
  Paid = "Paid",
  Shipped = "Shipped",
  Cancelled = "Cancelled",
}

export class OrderLine extends Entity {
  constructor(
    public readonly id: string,
    public readonly productId: ProductId,
    public readonly quantity: number,
    public readonly unitPrice: Money,
  ) {
    super();
  }

  subtotal(): Money {
    return new Money(this.quantity * this.unitPrice.amount, this.unitPrice.currency);
  }
}

export class Order extends AggregateRoot {
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,
    public readonly lines: OrderLine[],
    public status: OrderStatus,
  ) {
    super();
  }

  total(): Money {
    return this.lines.reduce((m, l) => m.add(l.subtotal()), new Money(0, this.lines[0].unitPrice.currency));
  }

  place(): OrderPlaced {
    this.status = OrderStatus.Placed;
    return new OrderPlaced(this.id, this.customerId);
  }
}

export class OrderPlaced extends DomainEvent {
  constructor(public readonly orderId: OrderId, public readonly customerId: CustomerId) {
    super();
  }
}

export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

export class PlaceOrderCommand {
  constructor(
    public readonly customerId: CustomerId,
    public readonly lines: OrderLine[],
  ) {}
}

export class PlaceOrderService {
  constructor(private readonly orders: OrderRepository) {}

  async execute(cmd: PlaceOrderCommand): Promise<Order> {
    const order = new Order(new OrderId(crypto.randomUUID()), cmd.customerId, cmd.lines, OrderStatus.Draft);
    order.place();
    await this.orders.save(order);
    return order;
  }
}
