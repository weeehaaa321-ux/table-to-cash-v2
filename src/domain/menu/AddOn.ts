import type { Identifier } from "../shared/Identifier";
import { Money } from "../shared/Money";
import type { MenuItemId } from "./MenuItem";

export type AddOnId = Identifier<"AddOn">;

/**
 * AddOn — an optional extra attached to a MenuItem (e.g. extra shot,
 * gluten-free bun, +cheese). Owned by exactly one MenuItem; deletes
 * cascade in DB.
 */
export class AddOn {
  private constructor(
    public readonly id: AddOnId,
    public readonly menuItemId: MenuItemId,
    public readonly name: string,
    public readonly price: Money,
  ) {}

  static rehydrate(props: {
    id: AddOnId;
    menuItemId: MenuItemId;
    name: string;
    price: Money;
  }): AddOn {
    return new AddOn(props.id, props.menuItemId, props.name, props.price);
  }
}
